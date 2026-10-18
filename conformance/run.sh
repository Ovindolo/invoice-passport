#!/usr/bin/env bash
# Checks every XML in vectors/ against the UBL 2.1 XSD and the official schematron rules:
# CEN EN 16931 (UBL and CII invoices, cii-* against the D16B XSD), OpenPeppol BIS Billing 3.0 (peppol-*) and KoSIT XRechnung 3.0 (xrechnung-*).
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
CEN_VERSION=1.3.17
if [ ! -d "$CACHE/cii/xslt" ]; then
  mkdir -p "$CACHE/cii"
  curl -sfL -o "$CACHE/cii/cii.zip" \
    "https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/download/validation-$CEN_VERSION/en16931-cii-$CEN_VERSION.zip"
  (cd "$CACHE/cii" && unzip -q -o cii.zip)
  curl -sfL "https://github.com/ConnectingEurope/eInvoicing-EN16931/archive/refs/tags/validation-$CEN_VERSION.tar.gz" |
    tar xz -C "$CACHE/cii" --include='*/cii/schema/*' 2>/dev/null ||
    curl -sfL "https://github.com/ConnectingEurope/eInvoicing-EN16931/archive/refs/tags/validation-$CEN_VERSION.tar.gz" |
    tar xz -C "$CACHE/cii" --wildcards '*/cii/schema/*'
fi
CII_XSD="$(find "$CACHE/cii" -path '*uncoupled clm*' -name CrossIndustryInvoice_100pD16B.xsd | head -1)"
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
for f in ../vectors/cii-*.xml; do
  xmllint --noout --schema "$CII_XSD" "$f" 2>/dev/null || { echo "XSD FAIL $f"; status=1; }
done
"$CACHE/venv/bin/python" schematron.py "$CACHE" "$PEPPOL_VERSION" ../vectors/ubl-*.xml ../vectors/peppol-*.xml \
  ../vectors/xrechnung-*.xml ../vectors/cii-*.xml || status=1
# DejaVu fonts for scripts/facturx-sample.ts (PDF/A needs embedded fonts).
mkdir -p "$CACHE/fonts"
for font in DejaVuSans DejaVuSans-Bold; do
  [ -f "$CACHE/fonts/$font.ttf" ] || curl -sfL -o "$CACHE/fonts/$font.ttf" \
    "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/$font.ttf"
done
# Factur-X PDFs: PDF/A-3 (veraPDF) and the XML rules, including the French BR-FR ones, via Mustang.
MUSTANG_VERSION=2.26.0
JAVA="$(command -v java || true)"
if [ -z "$JAVA" ] || ! "$JAVA" -version >/dev/null 2>&1; then
  if [ ! -d "$CACHE/jre" ]; then
    os=$(uname -s | sed 's/Darwin/mac/;s/Linux/linux/'); arch=$(uname -m | sed 's/x86_64/x64/;s/arm64/aarch64/')
    mkdir -p "$CACHE/jre"
    curl -sfL "https://api.adoptium.net/v3/binary/latest/21/ga/$os/$arch/jre/hotspot/normal/eclipse" | tar xz -C "$CACHE/jre"
  fi
  JAVA="$(find "$CACHE/jre" -type f -path '*/bin/java' | head -1)"
fi
[ -f "$CACHE/mustang/Mustang-CLI.jar" ] || { mkdir -p "$CACHE/mustang"; curl -sfL -o "$CACHE/mustang/Mustang-CLI.jar" \
  "https://github.com/ZUGFeRD/mustangproject/releases/download/core-$MUSTANG_VERSION/Mustang-CLI-$MUSTANG_VERSION.jar"; }
for f in ../vectors/facturx-*.pdf; do
  out=$("$JAVA" -jar "$CACHE/mustang/Mustang-CLI.jar" --action validate --source "$f" --no-notices 2>&1)
  if echo "$out" | grep -q 'ErrorIDs: \[\]' && echo "$out" | grep -q 'isCompliant=true'; then
    echo "ok   $(basename "$f") PDF/A-3b + Factur-X (Mustang $MUSTANG_VERSION, 0 errors)"
  else
    echo "FAIL $(basename "$f")"; echo "$out" | grep -E 'ErrorIDs|isCompliant|<error|<warning' | cut -c1-300; status=1
  fi
done
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
