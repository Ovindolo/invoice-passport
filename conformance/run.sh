#!/usr/bin/env bash
# Checks every XML in vectors/ against the UBL 2.1 XSD and the official schematron rules:
# CEN EN 16931 (all invoices), OpenPeppol BIS Billing 3.0 (peppol-*) and KoSIT XRechnung 3.0 (xrechnung-*).
# Also validates the UNVTD PaymentConfirmation vector against the UN/CEFACT JSON Schema.
# Needs curl, unzip, xmllint and Python 3; downloads the rules into conformance/.cache.
set -euo pipefail
cd "$(dirname "$0")"
PEPPOL_VERSION=3.0.20
SCHXSLT_VERSION=1.10.1
CACHE=.cache
mkdir -p "$CACHE"

if [ ! -d "$CACHE/ubl" ]; then
  curl -sfL -o "$CACHE/ubl.zip" https://docs.oasis-open.org/ubl/os-UBL-2.1/UBL-2.1.zip
  unzip -q -o "$CACHE/ubl.zip" 'xsd/*' -d "$CACHE/ubl"
fi
if [ ! -d "$CACHE/peppol-bis-invoice-3-$PEPPOL_VERSION" ]; then
  curl -sfL "https://github.com/OpenPEPPOL/peppol-bis-invoice-3/archive/refs/tags/v$PEPPOL_VERSION.tar.gz" | tar xz -C "$CACHE"
fi
if [ ! -d "$CACHE/xrechnung" ]; then
  mkdir -p "$CACHE/xrechnung"
  curl -sfL -o "$CACHE/xrechnung/xr.zip" \
    "https://github.com/itplr-kosit/xrechnung-schematron/releases/download/v2.6.0/xrechnung-3.0.2-schematron-2.6.0.zip"
  (cd "$CACHE/xrechnung" && unzip -q -o xr.zip)
fi
if [ ! -d "$CACHE/schxslt" ]; then
  mkdir -p "$CACHE/schxslt"
  curl -sfL -o "$CACHE/schxslt/s.jar" \
    "https://repo1.maven.org/maven2/name/dmaus/schxslt/schxslt/$SCHXSLT_VERSION/schxslt-$SCHXSLT_VERSION.jar"
  (cd "$CACHE/schxslt" && unzip -q -o s.jar)
fi
if [ ! -x "$CACHE/venv/bin/python" ]; then
  python3 -m venv "$CACHE/venv"
  "$CACHE/venv/bin/pip" -q install saxonche jsonschema pyyaml
fi
"$CACHE/venv/bin/python" -c "import jsonschema, yaml" 2>/dev/null || "$CACHE/venv/bin/pip" -q install jsonschema pyyaml
curl -sfL -o "$CACHE/unvtd-payment-confirmation-schema.yaml" https://unvtd.unece.org/payment-confirmation-schema.yaml

status=0
for f in ../vectors/ubl-*.xml ../vectors/peppol-*.xml ../vectors/xrechnung-*.xml; do
  xmllint --noout --schema "$CACHE/ubl/xsd/maindoc/UBL-Invoice-2.1.xsd" "$f" 2>/dev/null || { echo "XSD FAIL $f"; status=1; }
done
"$CACHE/venv/bin/python" schematron.py "$CACHE" "$PEPPOL_VERSION" ../vectors/ubl-*.xml ../vectors/peppol-*.xml ../vectors/xrechnung-*.xml || status=1
"$CACHE/venv/bin/python" - "$CACHE/unvtd-payment-confirmation-schema.yaml" ../vectors/unvtd-payment-confirmation.json <<'PY' || status=1
import json, sys, yaml, jsonschema
schema = yaml.safe_load(open(sys.argv[1]))
errors = list(jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).iter_errors(json.load(open(sys.argv[2]))))
for e in errors:
    print("     ", list(e.path), e.message)
print(("ok  " if not errors else "FAIL") + " unvtd-payment-confirmation.json UNVTD PaymentConfirmation schema")
sys.exit(1 if errors else 0)
PY
exit $status
