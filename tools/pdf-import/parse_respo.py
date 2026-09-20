"""Parser jadłospisów Respo (Centrum Respo) -> lista przepisów."""
import re
import pdfplumber

HDR = re.compile(r"^Posiłek (\d) / (.+?) (\d+) (\d+) ?g (\d+) ?g (\d+) ?g$")
DAY = re.compile(r"^Dzień (\d+)$")
ING = re.compile(r"^(?P<name>.+?) – (?P<measure>.+?)$")
GRAMS = re.compile(r"\(([\d.,]+) ?(g|ml)\)\s*$|^([\d.,]+) ?(g|ml)$")
STEP_X = 350  # kroki przepisu zaczynają się w prawej kolumnie

# Posiłek Respo -> slot aplikacji (posiłek 2 jem na kolację, 3 na obiad)
SLOT = {1: "breakfast", 2: "dinner", 3: "lunch", 4: "snack"}


def rows_of(chars, tol=2.5):
    chars = sorted(chars, key=lambda c: (c["top"], c["x0"]))
    rows = []
    for c in chars:
        if rows and abs(rows[-1][0]["top"] - c["top"]) <= tol:
            rows[-1].append(c)
        else:
            rows.append([c])
    for r in rows:
        r.sort(key=lambda c: c["x0"])
    return rows


def line_text(r):
    text, prev = "", None
    for c in r:
        if prev is not None and c["x0"] - prev["x1"] > c["size"] * 0.2:
            text += " "
        text += c["text"]
        prev = c
    return (r[0]["top"], r[0]["x0"], re.sub(r"\s+", " ", text).strip(),
            round(r[0]["size"], 1), "SemiBold" in r[0]["fontname"])


def lines_of(chars, tol=2.5):
    """[(top, x0, text, size, bold)] dla linii tekstu."""
    return [line_text(r) for r in rows_of(chars, tol)]


def parse_grams(measure):
    m = re.search(r"\(([\d.,]+) ?(g|ml)\)", measure)
    if m:
        return float(m.group(1).replace(",", ".")), m.group(2)
    m = re.match(r"^([\d.,]+) ?(g|ml)$", measure.strip())
    if m:
        return float(m.group(1).replace(",", ".")), m.group(2)
    return None, None


def parse_file(path):
    """Druga, prostsza pętla: wszystko w jednej sekwencji po top na stronie."""
    pdf = pdfplumber.open(path)
    recipes, cur, day, started = [], None, None, False
    ing_lines, step_lines = [], []

    def flush():
        nonlocal cur, ing_lines, step_lines
        if cur:
            cur.update(build(ing_lines, step_lines))
            cur.pop("_name_done", None)
            recipes.append(cur)
        cur, ing_lines, step_lines = None, [], []

    for page in pdf.pages:
        p = page.dedupe_chars()
        chars = p.chars
        full = lines_of(chars)
        if not started:
            texts = [t for _, _, t, _, _ in full]
            if "Plan diety" in texts and any(DAY.match(t) for t in texts):
                started = True
            else:
                continue
        events = []
        for row in rows_of(chars):
            first = row[0]
            if round(first["size"], 1) > 9.1:
                top, x0, t, size, bold = line_text(row)
                events.append((top, 0, "big", t, size, bold))
                continue
            left = [c for c in row if c["x0"] < STEP_X]
            right = [c for c in row if c["x0"] >= STEP_X]
            if left:
                top, x0, t, size, bold = line_text(left)
                events.append((top, 1, "ing", t, size, bold))
            if right:
                top, x0, t, size, bold = line_text(right)
                events.append((top, 2, "step", t, size, bold))
        events.sort()
        for top, _, kind, t, size, bold in events:
            if kind == "big":
                m = DAY.match(t)
                if m and size > 12:
                    flush()
                    day = int(m.group(1))
                    continue
                m = HDR.match(t)
                if m:
                    flush()
                    n = int(m.group(1))
                    cur = {"source_meal": n, "slot": SLOT[n], "time_hint": m.group(2),
                           "day": day, "kcal": int(m.group(3)), "protein": int(m.group(4)),
                           "carbs": int(m.group(5)), "fat": int(m.group(6)), "name": ""}
                    continue
                if cur is not None and bold and not ing_lines and not step_lines:
                    cur["name"] = (cur["name"] + " " + t).strip()
                continue
            if cur is None:
                continue
            if t.startswith("Kcal B W T") or re.match(r"^\(\d+ g błonnika", t):
                continue
            (ing_lines if kind == "ing" else step_lines).append(t)
    flush()
    return recipes


def build(ing_lines, step_lines):
    ings = []
    group = None
    grouped = []
    for t in ing_lines:
        if re.fullmatch(r"[^–\d]{2,40}:", t):
            group = t.rstrip(":").strip()
            continue
        grouped.append((group, t))
    ing_lines = [t for _, t in grouped]
    groups = {t: g for g, t in grouped}
    for t in ing_lines:
        if " – " in t or not ings or re.fullmatch(r"[^–]+ – .*", t):
            ings.append(t)
        else:
            ings[-1] += " " + t
    # złącz linie bez " – " które nie wyglądają na nowy składnik
    merged = []
    for t in ings:
        if merged and " – " not in t and not re.search(r"\d ?(g|ml)\)?$", merged[-1]):
            merged[-1] += " " + t
        else:
            merged.append(t)
    parsed = []
    for t in merged:
        m = ING.match(t)
        name, measure = (m.group("name"), m.group("measure")) if m else (t, "")
        g, unit = parse_grams(measure)
        household = re.sub(r"\s*\([\d.,]+ ?(g|ml)\)\s*$", "", measure).strip()
        if re.fullmatch(r"[\d.,]+ ?(g|ml)", household or "x"):
            household = ""
        item = {"name": name.strip(), "amount": g, "unit": unit or "g",
                "household": household or None}
        first_line = next((k for k in groups if t.startswith(k)), None)
        if first_line and groups[first_line]:
            item["group"] = groups[first_line]
        parsed.append(item)
    steps = []
    for t in step_lines:
        m = re.match(r"^(\d+)\.\s*(.*)$", t)
        if m:
            steps.append(m.group(2))
        elif steps:
            steps[-1] += " " + t
        else:
            steps.append(t)
    steps = [re.sub(r"\s+([,.!])", r"\1", s).strip() for s in steps]
    return {"ingredients": parsed, "steps": steps}


if __name__ == "__main__":
    import json, sys
    r = parse_file(sys.argv[1])
    print(json.dumps(r[:3], ensure_ascii=False, indent=1))
    print(len(r))
