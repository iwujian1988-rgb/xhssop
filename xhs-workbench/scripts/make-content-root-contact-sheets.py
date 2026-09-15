from pathlib import Path
from PIL import Image, ImageDraw

root = Path(r"D:\claude_work\waiyuxhssop\xhs-workbench\outputs\content-root-fix-final-1788509427068")
thumb_w, thumb_h = 270, 360
gap, label_h = 18, 28

for note_index in (1, 2, 3):
    final_dir = root / f"note-{note_index}-final"
    note_dir = final_dir if final_dir.exists() else root / f"note-{note_index}"
    files = sorted(note_dir.glob("*.png"))
    cols = 3 if len(files) <= 6 else 4
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb_w + (cols + 1) * gap, rows * (thumb_h + label_h) + (rows + 1) * gap), "#ececec")
    draw = ImageDraw.Draw(sheet)
    dimensions = []
    for index, file in enumerate(files):
        with Image.open(file) as source:
            dimensions.append((file.name, source.width, source.height))
            image = source.convert("RGB")
            image.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            col, row = index % cols, index // cols
            x = gap + col * thumb_w + (thumb_w - image.width) // 2
            y = gap + row * (thumb_h + label_h)
            sheet.paste(image, (x, y))
            draw.text((gap + col * thumb_w, y + thumb_h + 5), f"P{index + 1}  {file.name}", fill="#111111")
    out = root / f"note-{note_index}-contact-sheet.jpg"
    sheet.save(out, quality=92)
    print(f"NOTE {note_index}: {out}")
    for name, width, height in dimensions:
        print(f"  {name}: {width}x{height}")
