import sys, json, re, collections, pdfplumber
import parse_respo as P
f = sys.argv[1]
path = "/mnt/user-data/uploads/dieta/" + f
r = P.parse_file(path)
txt = "\n".join(l[2] for pg in pdfplumber.open(path).pages[:17] for l in P.lines_of(pg.dedupe_chars().chars))
days = {int(m.group(1)): int(m.group(2)) for m in re.finditer(r"Dzień (\d+) B: \d+ ?g T: \d+ ?g W: \d+ ?g (\d+) kcal", txt)}
sums = collections.Counter()
for x in r: sums[x["day"]] += x["kcal"]
json.dump({"file": f, "recipes": r, "day_totals_pdf": days, "day_totals_parsed": sums}, open("out/" + f + ".json", "w"), ensure_ascii=False, indent=1)
