import json, re, pdfplumber
from parse_respo import rows_of, line_text

def respo():
    t = json.load(open("subs_raw.json"))["dieta.pdf"].split("\n")
    groups, section, entries = [], None, []
    for line in t:
        if re.fullmatch(r"[^=]{3,40}:", line):
            section = line.rstrip(":"); continue
        if entries and (not (line[0].isupper() or line[0].isdigit())):
            entries[-1][1] += " " + line
        else:
            entries.append([section, line])
    for sec, e in entries:
        e = re.sub(r"\s+", " ", e.replace(" =", " =").replace("=", " = ")).strip()
        e = re.sub(r"\s+", " ", e)
        head = None
        m = re.match(r"^(Owoce świeże[^:]*):\s*(.*)$", e)
        if m:
            head, e = m.group(1), m.group(2)
        items = [x.strip() for x in e.split(" = ") if x.strip()]
        groups.append({"section": sec, "note": head, "items": items})
    return groups

def activezone():
    pdf = pdfplumber.open("/mnt/user-data/uploads/dieta/dieta (3).pdf")
    groups = []
    on = False
    for pg in pdf.pages:
        for r in rows_of(pg.dedupe_chars().chars):
            t = line_text(r)[2]
            if t == "Wymienniki": on = True; continue
            if not on: continue
            m = re.match(r"^(.+?) ([\d.]+) x (\S+) ([\d.]+) g$", t)
            if not m: continue
            item = {"name": m.group(1), "portion": f"{float(m.group(2)):g} × {m.group(3)}", "grams": float(m.group(4))}
            if round(r[0]["size"]) >= 12:
                groups.append({"section": "Active Zone", "note": "Zamienniki w podanych ilościach", "items": [item]})
            elif groups:
                groups[-1]["items"].append(item)
    return groups

if __name__ == "__main__":
    g = respo() + activezone()
    json.dump(g, open("substitutions.json", "w"), ensure_ascii=False, indent=1)
    for x in g: print(x["section"], "|", x["note"], "|", x["items"][:4], len(x["items"]))
