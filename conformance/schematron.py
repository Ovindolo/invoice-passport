"""Runs the CEN EN 16931 UBL rules on every invoice and the OpenPeppol rules on peppol-* invoices."""
import os
import re
import sys

from saxonche import PySaxonProcessor

cache, version, files = sys.argv[1], sys.argv[2], sys.argv[3:]
sch_dir = os.path.join(cache, f"peppol-bis-invoice-3-{version}", "rules", "sch")
pipeline = os.path.join(cache, "schxslt", "xslt", "2.0", "pipeline-for-svrl.xsl")
compiled = os.path.join(cache, "compiled")
os.makedirs(compiled, exist_ok=True)

failed = 0
with PySaxonProcessor(license=False) as proc:
    xslt = proc.new_xslt30_processor()
    executables = {}
    for rules in ("CEN-EN16931-UBL", "PEPPOL-EN16931-UBL"):
        target = os.path.join(compiled, rules + ".xsl")
        if not os.path.exists(target):
            xslt.compile_stylesheet(stylesheet_file=pipeline).transform_to_file(
                source_file=os.path.join(sch_dir, rules + ".sch"), output_file=target)
        executables[rules] = xslt.compile_stylesheet(stylesheet_file=target)
    for f in files:
        name = os.path.basename(f)
        rule_sets = ["CEN-EN16931-UBL"] + (["PEPPOL-EN16931-UBL"] if name.startswith("peppol-") else [])
        for rules in rule_sets:
            svrl = executables[rules].transform_to_string(source_file=os.path.abspath(f))
            asserts = re.findall(r"<svrl:failed-assert(.*?)</svrl:failed-assert>", svrl, re.S)
            print(f"{'ok  ' if not asserts else 'FAIL'} {name} {rules} ({len(asserts)} failed asserts)")
            for a in asserts:
                flag = re.search(r'flag="(\w+)"', a)
                text = re.search(r"<svrl:text>(.*?)</svrl:text>", a, re.S)
                print(f"     [{flag.group(1) if flag else '?'}] {text.group(1).strip() if text else a[:200]}")
            failed += len(asserts)
sys.exit(1 if failed else 0)
