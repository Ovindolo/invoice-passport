#!/usr/bin/env bash
# Checks every XML in vectors/ against the UBL 2.1 XSD and the official schematron rules:
# CEN EN 16931 (all invoices) and OpenPeppol BIS Billing 3.0 (peppol-* invoices).
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
if [ ! -d "$CACHE/schxslt" ]; then
  mkdir -p "$CACHE/schxslt"
  curl -sfL -o "$CACHE/schxslt/s.jar" \
    "https://repo1.maven.org/maven2/name/dmaus/schxslt/schxslt/$SCHXSLT_VERSION/schxslt-$SCHXSLT_VERSION.jar"
  (cd "$CACHE/schxslt" && unzip -q -o s.jar)
fi
if [ ! -x "$CACHE/venv/bin/python" ]; then
  python3 -m venv "$CACHE/venv"
  "$CACHE/venv/bin/pip" -q install saxonche
fi

status=0
for f in ../vectors/*.xml; do
  xmllint --noout --schema "$CACHE/ubl/xsd/maindoc/UBL-Invoice-2.1.xsd" "$f" 2>/dev/null || { echo "XSD FAIL $f"; status=1; }
done
"$CACHE/venv/bin/python" schematron.py "$CACHE" "$PEPPOL_VERSION" ../vectors/*.xml || status=1
exit $status
