"""Scala przepisy z out/*.json w jedną bazę recipes.json (+ raport)."""
import json, glob, re, collections, unicodedata
from nutrition_az import N

SLOT_PL = {"breakfast": "śniadanie", "snack": "przekąska", "lunch": "obiad", "dinner": "kolacja"}

CATS = [
    ("Suplementy", r"odżywka"),
    ("Orzechy i nasiona", r"orzech|migdał|pestk|nasion|siemi|chia|sezam|słonecznik|masło orzechowe|kokos|tahini"),
    ("Przyprawy i sosy", r"sól|pieprz|kumin|kmin|oregano|papryka (ostra|słodka|wędzona) w proszku|curry|kurkum|cynamon|przypraw|zioł|sos|ocet|musztard|ketchup|koncentrat|bulion|tymianek|majeranek|chili|wanili|kakao|miód|syrop|ksylitol|erytrol|słodzik|cukier|pesto|drożdż|proszek do pieczenia|żelatyn|chrzan|czarnuszk|gałka|kardamon|liść laurow|rozmaryn|ziele angiel"),
    ("Tłuszcze", r"oliwa|oliwy|olej|margaryn"),
    ("Strączki i roślinne", r"ciecierzyc|soczewic|fasol|groch|tofu|hummus|napój (sojowy|migdał|owsian|roślin)|edamame|tempeh"),
    ("Mięso i ryby", r"kurczak|indyk|wołow|wieprz|schab|szynk|wędlin|mięso|polędwic|dorsz|łosoś|tuńczyk|pstrąg|makrel|śledź|krewet|mintaj|ryb|boczek|kiełbas"),
    ("Nabiał i jaja", r"jaj|mlek|mleko|jogurt|skyr|kefir|maślank|twaróg|twarog|serek|ser |ser$|mozzarell|feta|parmezan|śmietan|masło(?! orzech)|ricotta|halloumi|twarożek|budyń"),
    ("Pieczywo i zboża", r"chleb|bułk|tortill|wafl|wafel|płatki|kasz|ryż|makaron|mąk|musli|granol|otręb|pieczyw|tost|bagiet|kuskus|bulgur|komos|grahamk|pita|gnocchi|ciasto do naleśn|amarant|tapiok"),
    ("Owoce", r"banan|jabł|grusz|mango|borów|malin|truskaw|wiśni|czereśni|pomarańcz|mandaryn|cytryn|limonk|kiwi|brzoskw|ananas|winogron|śliw|jagod|porzecz|żurawin|rodzyn|daktyl|morel|figi|granat|arbuz|owoc|grejpfrut|marakuj|melon|nektaryn"),
    ("Warzywa", r"pomidor|ogór|papryk|cebul|czosn|marchew|cukini|bakłaż|brokuł|kalafior|szpinak|jarmuż|rukol|sałat|roszponk|rzodkiew|por\b|seler|kapust|dyni|burak|pieczark|szczypior|natk|koper|bazyli|kolendr|pietruszk|ziemniak|batat|fasolka|groszek|kukurydz|awokado|oliwk|mięt|imbir|boczniak|kurki|papryczk|mieszanka meksyk|ziemniaczki"),
]


OVERRIDES = {
    "Bajgiel z sezamem": "Pieczywo i zboża",
    "Płatki chilli": "Przyprawy i sosy",
    "Serek waniliowy High Protein Pilos": "Nabiał i jaja",
    "Pomidory suszone w oleju (odsączone)": "Warzywa",
    "Mleko migdałowe": "Strączki i roślinne",
    "Mleko roślinne niesłodzone": "Strączki i roślinne",
    "Jogurt roślinny": "Strączki i roślinne",
    "Mleczko kokosowe 12%": "Strączki i roślinne",
    "Woda kokosowa": "Inne",
    "Woda": "Inne",
    "Lód, kostki": "Inne",
}


def category(name):
    if name in OVERRIDES:
        return OVERRIDES[name]
    n = name.lower()
    if re.search(r"(suszon|mielon|granulowan)", n) and re.search(r"bazyli|kolendr|czosnek|imbir|pietruszk|koper", n):
        return "Przyprawy i sosy"
    for cat, rx in CATS:
        if re.search(rx, n):
            return cat
    return "Inne"


def slug(s):
    s = unicodedata.normalize("NFKD", s.lower().replace("ł", "l"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:60]


def clean_name(name):
    m = re.search(r"\s*\(liczba porcji: (\d+)\)", name)
    servings = int(m.group(1)) if m else 1
    name = re.sub(r"\s*\(liczba porcji: \d+\)", "", name).strip().rstrip(".")
    return name, servings


def az_macros(r):
    p = c = f = kcal = 0.0
    missing = []
    for i in r["ingredients"]:
        v = N.get(i["name"])
        if v is None or i["amount"] is None:
            missing.append(i["name"])
            continue
        k = i["amount"] / 100
        kcal += v[0] * k; p += v[1] * k; c += v[2] * k; f += v[3] * k
    return kcal, p, c, f, missing


def main():
    recs = []
    for fn in sorted(glob.glob("out/*.json")):
        d = json.load(open(fn))
        for x in d["recipes"]:
            x["file"] = d["file"]
            recs.append(x)

    report = {"raw_count": len(recs), "az_calc": [], "merged": []}
    out = {}
    for x in recs:
        name, servings = clean_name(x["name"])
        ings = []
        for i in x["ingredients"]:
            item = {"name": i["name"], "amount": i["amount"], "unit": i["unit"],
                    "household": i["household"], "category": category(i["name"])}
            if i.get("group"):
                item["group"] = i["group"]
            ings.append(item)
        estimated = x["protein"] is None
        kcal = x["kcal"]
        if estimated:
            ck, p, c, f, missing = az_macros(x)
            # skalujemy makro tak, żeby zgadzało się z kcal podanym przez dietetyczkę
            calc = 4 * p + 4 * c + 9 * f
            s = kcal / calc if calc else 1
            p, c, f = round(p * s), round(c * s), round(f * s)
            report["az_calc"].append({"name": name, "pdf_kcal": kcal, "calc_kcal": round(ck),
                                      "diff_pct": round((ck - kcal) / kcal * 100, 1), "missing": missing})
        else:
            p, c, f = x["protein"], x["carbs"], x["fat"]
        steps = x.get("steps") or ([x["description"]] if x.get("description") else [])
        if not steps and re.search(r"shake|koktajl|smoothie", name, re.I):
            steps = ["Wszystkie składniki zblenduj na gładki koktajl."]  # brak opisu w PDF
        sig = (name.lower(), tuple(sorted((i["name"].lower(), i["amount"]) for i in ings)))
        src = {"file": x["file"], "day": x["day"], "meal": x["source_meal"]}
        key = sig
        if key in out:
            out[key]["sources"].append(src)
            continue
        out[key] = {
            "name": name,
            "slot": x["slot"],
            "servings": servings,
            "per_serving": {"kcal": kcal, "protein": p, "carbs": c, "fat": f},
            "macros_estimated": estimated,
            "ingredients": ings,
            "steps": steps,
            "origin": "dietitian_respo" if not estimated else "dietitian_activezone",
            "sources": [src],
        }

    recipes = list(out.values())
    # unikalne id; te same nazwy z różną gramaturą dostają sufiks
    seen = collections.Counter()
    for r in recipes:
        base = slug(r["name"])
        seen[base] += 1
        r["id"] = base if seen[base] == 1 else f"{base}-{seen[base]}"
        r["tags"] = []
    recipes.sort(key=lambda r: (list(SLOT_PL).index(r["slot"]), r["name"]))
    report["unique_count"] = len(recipes)
    report["per_slot"] = collections.Counter(r["slot"] for r in recipes)
    report["kcal_range_per_slot"] = {
        s: [min(r["per_serving"]["kcal"] for r in recipes if r["slot"] == s),
            max(r["per_serving"]["kcal"] for r in recipes if r["slot"] == s)] for s in SLOT_PL}
    report["categories"] = collections.Counter(i["category"] for r in recipes for i in r["ingredients"])
    report["uncategorized"] = sorted({i["name"] for r in recipes for i in r["ingredients"] if i["category"] == "Inne"})
    report["no_amount"] = sorted({(r["name"], i["name"]) for r in recipes for i in r["ingredients"] if i["amount"] is None})

    data = {"version": 1, "generated": "2026-09-19", "slots": SLOT_PL, "recipes": recipes,
            "substitutions": json.load(open("substitutions.json"))}
    json.dump(data, open("recipes.json", "w"), ensure_ascii=False, indent=1)
    json.dump(report, open("report.json", "w"), ensure_ascii=False, indent=1, default=list)
    return data, report


if __name__ == "__main__":
    d, r = main()
    print(r["raw_count"], "->", r["unique_count"], dict(r["per_slot"]), r["kcal_range_per_slot"])
    print("AZ calc diffs:", sorted((a["diff_pct"], a["name"]) for a in r["az_calc"])[:3], "...",
          sorted((a["diff_pct"], a["name"]) for a in r["az_calc"])[-3:])
    print("missing:", {m for a in r["az_calc"] for m in a["missing"]})
    print("no amount:", r["no_amount"])
    print("Inne:", len(r["uncategorized"]), r["uncategorized"][:80])
