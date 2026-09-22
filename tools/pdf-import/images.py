"""Wyciąga zdjęcia potraw z PDF-ów Respo i zapisuje je pod slugiem przepisu.

Użycie:  python images.py <katalog-z-pdf> <katalog-wyjściowy> [recipes.json]

Na stronie z posiłkiem zdjęcie 412×412 stoi tuż przy nazwie dania, więc łączymy
je po pozycji w pionie, a potem dopasowujemy nazwę do przepisu z recipes.json.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import pymupdf
from PIL import Image

HDR = re.compile(r"^Posiłek (\d) / ")
SIZE = 640
QUALITY = 72


def norm(s: str) -> str:
    s = s.lower().replace("ł", "l")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


SKIP = re.compile(r"^(\d+([.,]\d+)?\s*(g|ml|kcal|min)?|kcal|b|w|t|węglowodany|białko|tłuszcz(e)?)$", re.I)


def dish_names(page) -> list[tuple[float, str]]:
    """[(y, nazwa dania)] – pierwsza sensowna linia pod nagłówkiem „Posiłek N / …”
    w tej samej kolumnie (strona ma dwie kolumny, więc x ma znaczenie)."""
    lines = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(s["text"] for s in line["spans"]).strip()
            if text:
                lines.append((line["bbox"][1], line["bbox"][0], text))
    lines.sort()
    out = []
    for y, x, text in lines:
        if not HDR.match(text):
            continue
        below = [l for l in lines if l[0] > y + 1 and abs(l[1] - x) < 20]
        name = next((t for _, _, t in below if len(t) > 3 and not SKIP.match(t)), None)
        if name:
            out.append((y, name))
    return out


def main(pdf_dir: str, out_dir: str, recipes_json: str) -> None:
    recipes = json.load(open(recipes_json, encoding="utf-8"))["recipes"]
    by_name: dict[str, list[dict]] = {}
    for r in recipes:
        by_name.setdefault(norm(r["name"]), []).append(r)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    found = matched = 0

    for pdf in sorted(Path(pdf_dir).glob("*.pdf")):
        doc = pymupdf.open(pdf)
        for page in doc:
            names = dish_names(page)
            if not names:
                continue
            images = [i for i in page.get_image_info(xrefs=True) if i["width"] >= 300 and i["height"] >= 300]
            for info in images:
                found += 1
                y = info["bbox"][1]
                name = min(names, key=lambda n: abs(n[0] - y))[1]
                hits = by_name.get(norm(name))
                if not hits:
                    continue
                target = out / f"{hits[0]['id']}.jpg"
                if target.exists():
                    continue
                pix = pymupdf.Pixmap(doc, info["xref"])
                if pix.n > 3:
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                img.thumbnail((SIZE, SIZE))
                img.save(target, "JPEG", quality=QUALITY, optimize=True, progressive=True)
                matched += 1

    total = sum(1 for _ in out.glob("*.jpg"))
    print(f"zdjęć w PDF-ach: {found}, zapisanych: {matched}, plików łącznie: {total}, przepisów: {len(recipes)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "../../data/recipes.json")
