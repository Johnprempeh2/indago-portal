"""Build a private SQL data load from the GRE-1681 source attachments.

The output contains client text. Keep it outside Git and apply only after the
0041 migration, a backup check and Flint review. Python standard library only.
"""
import argparse
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "p": "http://schemas.openxmlformats.org/package/2006/relationships",
      "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def xlsx_sheets(path):
    with zipfile.ZipFile(path) as z:
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            strings = ["".join(n.itertext()) for n in root.findall("s:si", NS)]
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        targets = {r.attrib["Id"]: r.attrib["Target"] for r in rels}
        book = ET.fromstring(z.read("xl/workbook.xml"))
        for sheet in book.findall("s:sheets/s:sheet", NS):
            name = sheet.attrib["name"]
            target = targets[sheet.attrib[f"{{{NS['r']}}}id"]].lstrip("/")
            if not target.startswith("xl/"):
                target = "xl/" + target
            root = ET.fromstring(z.read(target))
            rows = []
            for row in root.findall("s:sheetData/s:row", NS):
                cells = {}
                for c in row.findall("s:c", NS):
                    letters = re.match(r"[A-Z]+", c.attrib["r"]).group()
                    index = 0
                    for letter in letters:
                        index = index * 26 + ord(letter) - 64
                    v = c.find("s:v", NS)
                    inline = c.find("s:is", NS)
                    value = v.text if v is not None and v.text is not None else ""
                    if c.attrib.get("t") == "s" and value:
                        value = strings[int(value)]
                    elif inline is not None:
                        value = "".join(inline.itertext())
                    cells[index - 1] = value
                if cells:
                    rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
            if rows:
                width = max(len(row) for row in rows)
                yield name, rows[0] + [""] * (width - len(rows[0])), [r + [""] * (width - len(r)) for r in rows[1:]]


def toolkit_rows(path):
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    for i, paragraph in enumerate(root.findall(".//w:body/w:p", NS), 1):
        value = "".join(t.text or "" for t in paragraph.findall(".//w:t", NS)).strip()
        if value:
            yield [str(i), value]


def sql(value):
    return "'" + str(value).replace("'", "''") + "'"


def portal_toolkit(path):
    # The approved v1 HTML holds the structured Toolkit representation used by
    # its screens. The source DOCX is still read and checked below.
    code = """const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(process.argv[1],'utf8');
const start=html.indexOf('const TK = {'),end=html.indexOf('/* ---------- Register column configuration',start);
if(start<0||end<0) throw Error('Toolkit state missing from approved portal HTML');
const expression=html.slice(start+'const TK = '.length,end).trim().replace(/;$/,'');
const value=vm.runInNewContext('('+expression+')',Object.create(null),{timeout:1000});
console.log(JSON.stringify(value));"""
    result = subprocess.run(["node", "-e", code, str(path)], check=True, capture_output=True, text=True)
    toolkit = json.loads(result.stdout)
    required = {"rules", "authority", "stages", "agenda", "nsq", "interviews", "instruments", "rhythm", "checklist"}
    if not required <= toolkit.keys():
        raise SystemExit("Approved portal HTML lacks required Toolkit sections")
    return toolkit


def main():
    parser = argparse.ArgumentParser()
    for name in ("plan", "register", "toolkit", "portal", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    plan_titles = ("Work Breakdown", "Stage Gates", "Milestones", "Risks & Issues")
    reg_titles = ("Client Findings", "Information Requests", "New Deep Dive Evidence", "Service Processes",
                  "Commercial Baseline", "Findings", "Opportunities", "Decisions", "GDXP Traceability", "Validation Log")
    found = {}
    for path in (args.plan, args.register):
        for title, columns, rows in xlsx_sheets(path):
            if title in plan_titles + reg_titles:
                if title in found:
                    raise SystemExit(f"Duplicate source sheet: {title}")
                found[title] = (columns, rows)
    if set(found) != set(plan_titles + reg_titles):
        raise SystemExit(f"Missing source sheets: {set(plan_titles + reg_titles) - set(found)}")
    sheets = [("plan" if title in plan_titles else "register", title, *found[title])
              for title in plan_titles + reg_titles]
    if len(list(toolkit_rows(args.toolkit))) < 10:
        raise SystemExit("Delivery Toolkit document is empty or incomplete")
    toolkit = portal_toolkit(args.portal)
    sheets.append(("toolkit", "Delivery Toolkit", ["Toolkit JSON"], [[json.dumps(toolkit)]]))
    sheets.append(("portal", "Portal Settings", ["Setting"], [["settings"]]))
    counts = {(source, title): len(rows) for source, title, _, rows in sheets}
    expected = {("plan", "Work Breakdown"): 41, ("plan", "Stage Gates"): 6,
                ("register", "Client Findings"): 140, ("register", "Information Requests"): 31}
    if any(counts.get(key) != count for key, count in expected.items()):
        raise SystemExit(f"Source row counts differ from approved v1: {[(k, counts.get(k)) for k in expected]}")
    lines = ["begin;"]
    for position, (source, title, columns, rows) in enumerate(sheets):
        sheet_id = f"{source}:{title}"
        editable = {"Work Breakdown": {9, 11, 12, 13}, "Stage Gates": {4, 5, 6},
                    "Milestones": {4, 5}, "Risks & Issues": {1, 2, 3, 4, 5, 6}}
        locked = list(range(5)) if title == "Client Findings" else (
            list(range(3)) if title == "Information Requests" else (
            [i for i in range(len(columns)) if i not in editable[title]] if title in editable else (
                list(range(len(columns))) if source in ("toolkit", "portal") else [0])))
        lines.append("insert into indago.sheets (id,title,source_name,columns,locked_columns,position) values ("
                     + ",".join((sql(sheet_id), sql(title), sql(source), sql(json.dumps(columns)),
                               sql(json.dumps(locked)), str(position))) + ");")
        for number, values in enumerate(rows, 1):
            record_id = f"{sheet_id}:{number}"
            lines.append("insert into indago.records (id,sheet_id,position,source_values) values ("
                         + ",".join((sql(record_id), sql(sheet_id), str(number), sql(json.dumps(values)))) + ");")
    lines.append("commit;")
    args.output.write_text("\n".join(lines) + "\n")
    print("Validated source counts: 41 work packages, 6 gates, 140 findings, 31 requests.")
    print(f"Prepared {sum(len(s[3]) for s in sheets)} records in {len(sheets)} sheets: {args.output}")


if __name__ == "__main__":
    main()
