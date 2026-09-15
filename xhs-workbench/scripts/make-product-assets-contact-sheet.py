import hashlib, json, zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "data/product-assets/delf_b2_writing/0fb6ee6fe985fd7cbb2e43276e1bdfdaada2cc86ea493473e9f300aad4ad6f99"
OUT = ROOT / "qa-artifacts/product-assets"
OUT.mkdir(parents=True, exist_ok=True)
MANIFEST = LIB / "asset-manifest.json"
before = hashlib.sha256(MANIFEST.read_bytes()).hexdigest()
manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
assets = sorted(manifest["assets"], key=lambda a: (0 if a.get("curationTier") == "A" else 1, a["sourcePage"]))
assert len(assets) == 18

def font(size):
    for name in ("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/arial.ttf"):
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()

label_font = font(28)
small_font = font(23)
bg = (247, 247, 245)
cols, rows = 3, 3
cell_w, cell_h = 720, 980
pad = 36
header_h = 108

for batch_no, batch in enumerate((assets[:9], assets[9:]), 1):
    sheet = Image.new("RGB", (cols * cell_w + (cols + 1) * pad, rows * cell_h + (rows + 1) * pad + header_h), bg)
    draw = ImageDraw.Draw(sheet)
    draw.text((pad, 24), f"DELF B2 商品素材人工验收表 {batch_no}/2 · 原图等比例缩略", fill=(25, 25, 25), font=label_font)
    for i, asset in enumerate(batch):
        image_path = LIB / asset["selectedPath"]
        with Image.open(image_path) as source:
            source = source.convert("RGB")
            source.thumbnail((cell_w - 2 * pad, cell_h - 150), Image.Resampling.LANCZOS)
            x = pad + (i % cols) * cell_w + (cell_w - source.width) // 2
            y = header_h + pad + (i // cols) * cell_h + 92
            sheet.paste(source, (x, y))
        left = pad + (i % cols) * cell_w
        top = header_h + pad + (i // cols) * cell_h
        tier = asset.get("curationTier", "?")
        short_id = asset["assetId"].split("-")[-1]
        draw.text((left, top), f"{tier}档 · P{asset['sourcePage']:03d} · {short_id}", fill=(18, 18, 18), font=label_font)
        draw.text((left, top + 38), asset["moduleTag"], fill=(35, 82, 145), font=small_font)
    sheet.save(OUT / f"product-assets-contact-sheet-{batch_no}.png", optimize=True)

zip_path = OUT / "delf-b2-selected-assets-18.zip"
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for asset in assets:
        p = LIB / asset["selectedPath"]
        z.write(p, arcname=p.name)
assert hashlib.sha256(MANIFEST.read_bytes()).hexdigest() == before
print(json.dumps({"sheets": 2, "assets": len(assets), "zip": str(zip_path), "manifestUnchanged": True}, ensure_ascii=False))
