"""Parser jadłospisów Active Zone -> lista przepisów (tylko kcal, bez makro)."""
import re
import pdfplumber
from parse_respo import rows_of, line_text

DAYS = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"]
HDR = re.compile(r"^(II Śniadanie|Śniadanie|Obiad|Kolacja|Podwieczorek|Przekąska) - (\d{1,2}:\d{2})$")
KCAL = re.compile(r"Kcal: (\d+)")
MEAS = re.compile(r"^([\d.,]+) x (.+?) \(([\d.,]+) (g|ml)\)$")
SLOT = {"Śniadanie": "breakfast", "II Śniadanie": "snack", "Podwieczorek": "snack",
        "Przekąska": "snack", "Obiad": "lunch", "Kolacja": "dinner"}
MID_X = 262   # granica opis | składniki
MEAS_X = 425  # granica nazwa składnika | miara


def parse_file(path):
    pdf = pdfplumber.open(path)
    recipes, cur, day, day_totals = [], None, None, {}
    week_totals = []

    def flush():
        nonlocal cur
        if cur:
            cur["description"] = re.sub(r"\s+", " ", " ".join(cur.pop("_desc"))).strip()
            ings = []
            for name, meas in cur.pop("_ings"):
                if meas is None and ings and ings[-1]["_open"]:
                    ings[-1]["name"] += " " + name
                    continue
                if meas is None and ings:
                    ings[-1]["name"] += " " + name
                    continue
                item = {"name": name, "amount": None, "unit": "g", "household": None, "_open": False}
                m = MEAS.match(meas or "")
                if m:
                    item["amount"] = float(m.group(3))
                    item["unit"] = m.group(4)
                    q = float(m.group(1))
                    item["household"] = f"{q:g} × {m.group(2).lower()}"
                ings.append(item)
            for i in ings:
                i.pop("_open")
            cur["ingredients"] = ings
            recipes.append(cur)
        cur = None

    for page in pdf.pages:
        p = page.dedupe_chars()
        rows = rows_of(p.chars)
        texts = [line_text(r)[2] for r in rows]
        if texts and texts[0] in DAYS:
            flush()
            day = DAYS.index(texts[0]) + 1
        elif texts and texts[0].startswith("Lista zakupów"):
            flush()
            break
        elif day is None:
            continue
        for r in rows:
            left = [c for c in r if c["x0"] < MID_X]
            right = [c for c in r if c["x0"] >= MID_X]
            lt = line_text(left) if left else None
            rt = line_text(right)[2] if right else ""
            if lt and lt[2] in DAYS:
                continue
            if lt and (m := HDR.match(lt[2])):
                flush()
                k = KCAL.search(rt)
                cur = {"source_meal": m.group(1), "slot": SLOT[m.group(1)], "time_hint": m.group(2),
                       "day": day, "kcal": int(k.group(1)) if k else None,
                       "protein": None, "carbs": None, "fat": None,
                       "name": "", "_desc": [], "_ings": []}
                continue
            if lt and lt[2].startswith("Suma dnia"):
                flush()
                k = KCAL.search(lt[2] + " " + rt)
                if k:
                    day_totals[day] = int(k.group(1))
                continue
            if cur is None:
                continue
            if lt:
                if lt[4] or "Bold" in left[0]["fontname"]:
                    if not cur["_desc"]:
                        cur["name"] = (cur["name"] + " " + lt[2]).strip()
                    else:
                        cur["_desc"].append(lt[2])
                else:
                    cur["_desc"].append(lt[2])
            if right:
                full_r = line_text(right)[2]
                mm = re.match(r"^(.*?)\s*([\d.,]+ x .+\([\d.,]+ (g|ml)\))$", full_r)
                if mm:
                    name, meas = mm.group(1).strip(), mm.group(2)
                else:
                    name, meas = full_r, None
                if name or meas:
                    cur["_ings"].append((name, meas))
    flush()
    return recipes, day_totals


if __name__ == "__main__":
    import json, sys
    r, t = parse_file(sys.argv[1])
    print(json.dumps(r[:2], ensure_ascii=False, indent=1))
    print(len(r), t)
