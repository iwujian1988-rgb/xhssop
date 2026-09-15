"""Offline synthetic fixtures only; no real product PDF or provider call."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

import pymupdf as fitz

spec = importlib.util.spec_from_file_location("assets", Path(__file__).with_name("init-product-assets.py"))
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)

with tempfile.TemporaryDirectory(prefix="product-assets-offline-") as temp:
    root = Path(temp)
    source = root / "fixture.pdf"
    doc = fitz.open()
    doc.new_page()
    page = doc.new_page()
    page.insert_text((50, 60), "Arguments: examples of two opinions", fontsize=18)
    doc.fullcopy_page(1)
    page = doc.new_page()
    page.draw_rect(fitz.Rect(40, 40, 200, 200), fill=(0, .4, 0))
    doc.save(source)
    doc.close()
    original = source.read_bytes()
    pdf_hash = hashlib.sha256(original).hexdigest()
    directory = root / pdf_hash
    directory.mkdir()
    pages = assets.prepare(source, directory, pdf_hash)
    assert [p["status"] for p in pages] == ["blank", "candidate", "duplicate", "candidate"]
    assert pages[2]["duplicateOf"] == 2
    assert "Arguments" in (directory / pages[1]["textPath"]).read_text()
    thumbnail = directory / pages[1]["thumbnailPath"]
    stamp = thumbnail.stat().st_mtime_ns
    assert assets.prepare(source, directory, pdf_hash) == pages
    assert thumbnail.stat().st_mtime_ns == stamp
    classification = {"sourcePage": 2, "keep": True, "moduleTag": "fixture", "buyerNeedTags": ["fixture need"], "sellingAngleTags": ["fixture proof"], "supportedClaims": [{"claim": "Visible opinions example", "sourceFactIds": []}], "proofStrength": "strong", "coverReady": True, "notes": "OFFLINE SYNTHETIC DATA NOT AI"}
    assets.validate_classification({"pages": [classification]}, [pages[1]], set())
    try:
        invalid = {**classification, "supportedClaims": [{"claim": "test", "sourceFactIds": ["invented"]}]}
        assets.validate_classification({"pages": [invalid]}, [pages[1]], set())
        raise AssertionError("Invented sourceFactId was accepted")
    except ValueError:
        pass
    assets.save_json(directory / "classified-pages.json", {"pages": [classification]})
    assets.materialize(source, directory, pdf_hash, 25, True)
    manifest_path = directory / "asset-manifest.json"
    manifest = assets.read_json(manifest_path)
    assert len(manifest["assets"]) == 1  # Never invent 24 extra assets.
    assert (directory / manifest["assets"][0]["selectedPath"]).is_file()
    assert len(list((directory / "selected").glob("*.png"))) == 1
    manifest["assets"][0]["reviewStatus"] = "kept"
    assets.save_json(manifest_path, manifest)
    assets.materialize(source, directory, pdf_hash, 25, True)
    assert assets.read_json(manifest_path)["assets"][0]["reviewStatus"] == "kept"
    assert source.read_bytes() == original
    print("PASS: blank/duplicate filtering, image-only page retained, text pairing, hash caching, fact IDs, selected-only HD, human review preserved, source unchanged")
