"""DELF B2 Phase 1A: prepare -> classify -> materialize, never generate notes.

python scripts/init-product-assets.py prepare --pdf PATH
python scripts/init-product-assets.py classify --pdf PATH --facts PATH
python scripts/init-product-assets.py materialize --pdf PATH --activate

prepare is local-only. classify sends thumbnails, their text and product facts
to the configured OpenAI-compatible multimodal endpoint, once per cached batch.
No OCR, model retries, source PDF writes or production job mutations.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.request

import pymupdf as fitz

PRODUCT = "delf_b2_writing"
ROOT = Path(__file__).resolve().parents[1]
PROMPT_VERSION = "asset-understanding-1"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + f".{os.getpid()}.tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def prepare(pdf, directory, pdf_hash):
    source_file = directory / "source.json"
    index_file = directory / "pages.json"
    if source_file.exists() and index_file.exists():
        index = read_json(index_file)
        if all((directory / p["thumbnailPath"]).is_file() and (directory / p["textPath"]).is_file() for p in index):
            print(json.dumps({"cached": True, "pages": len(index), "candidates": sum(p["status"] == "candidate" for p in index)}))
            return index
    (directory / "thumbnails").mkdir(parents=True, exist_ok=True)
    (directory / "text").mkdir(exist_ok=True)
    seen = {}
    index = []
    with fitz.open(pdf) as doc:
        if doc.needs_pass:
            raise ValueError("PDF requires a password")
        for i, page in enumerate(doc):
            number = i + 1
            text = page.get_text("text")
            thumb = f"thumbnails/page-{number:04d}.jpg"
            text_path = f"text/page-{number:04d}.txt"
            # A 720px thumbnail is readable enough for classification, not a HD archive.
            pix = page.get_pixmap(matrix=fitz.Matrix(720 / page.rect.width, 720 / page.rect.width), colorspace=fitz.csRGB, alpha=False)
            pix.save(str(directory / thumb))
            (directory / text_path).write_text(text, encoding="utf-8")
            fingerprint = digest(pix.samples)
            probe = page.get_pixmap(matrix=fitz.Matrix(100 / page.rect.width, 100 / page.rect.width), colorspace=fitz.csGRAY, alpha=False)
            ink = sum(v < 245 for v in probe.samples) / len(probe.samples)
            # Conservative: no textual content and virtually no visible ink.
            blank = not text.strip() and ink < .001
            duplicate = seen.get(fingerprint)
            status = "blank" if blank else "duplicate" if duplicate else "candidate"
            if status == "candidate":
                seen[fingerprint] = number
            index.append({"sourcePage": number, "printedPageLabel": page.get_label(), "thumbnailPath": thumb, "textPath": text_path, "status": status, "duplicateOf": duplicate})
        save_json(source_file, {"productId": PRODUCT, "pdfHash": pdf_hash, "sourcePath": str(pdf), "sourceName": pdf.name, "pageCount": len(doc), "visualRoute": "pdf_screenshot", "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    save_json(index_file, index)
    print(json.dumps({"pages": len(index), "candidates": sum(p["status"] == "candidate" for p in index), "blank": sum(p["status"] == "blank" for p in index), "duplicates": sum(p["status"] == "duplicate" for p in index)}))
    return index


def load_env():
    env_path = ROOT / ".env.local"
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8-sig").splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


SYSTEM = """你只做DELF B2商品PDF页面理解，不生成标题、Caption或笔记，也不改截图。
逐张查看缩略图与对应原文。优先找有具体商品内容、清楚可读、能证明购买理由的页面。
区分章节moduleTag与购买理由buyerNeedTags/sellingAngleTags。目录也可以有展示价值。
supportedClaims只记录图中真实可见的内容：一页样张不能证明覆盖所有题目、整套数量或提分效果。
sourceFactIds只能选择给定商品事实中确实被本页支持的ID。没有对应事实就传[]，绝不轮转或猜ID。
proofStrength为strong/medium/weak；coverReady只在页面缩小后仍有可辨认的主视觉时为true。
空白、版权声明、纯过渡、无法辨认或内容不完整的页面keep=false；不要为了每组凑数保留。
每个sourcePage恰好返回一次，严格JSON：
{"pages":[{"sourcePage":1,"keep":true,"moduleTag":"论据","buyerNeedTags":["不会展开观点"],"sellingAngleTags":["真实论据展示"],"supportedClaims":[{"claim":"本页展示某社会话题的正反观点","sourceFactIds":[]}],"proofStrength":"strong","coverReady":false,"notes":"具体说明为什么值得展示或淘汰"}]}"""


def validate_classification(raw, pages, allowed_ids):
    items = raw.get("pages") if isinstance(raw, dict) else None
    expected = {p["sourcePage"] for p in pages}
    if not isinstance(items, list) or len(items) != len(expected) or {p.get("sourcePage") for p in items} != expected:
        raise ValueError("Classification must return every requested page exactly once; raw output retained")
    for item in items:
        if type(item.get("keep")) is not bool or type(item.get("coverReady")) is not bool or item.get("proofStrength") not in ("strong", "medium", "weak"):
            raise ValueError("Invalid classification flags")
        for key in ("moduleTag", "notes"):
            if not isinstance(item.get(key), str):
                raise ValueError(f"Invalid {key}")
        for key in ("buyerNeedTags", "sellingAngleTags"):
            if not isinstance(item.get(key), list) or not all(isinstance(v, str) and v.strip() for v in item[key]):
                raise ValueError(f"Invalid {key}")
        claims = item.get("supportedClaims")
        if not isinstance(claims, list) or (item["keep"] and not claims):
            raise ValueError("Kept pages need visible supportedClaims")
        for claim in claims:
            ids = claim.get("sourceFactIds")
            if not isinstance(claim.get("claim"), str) or not claim["claim"].strip() or not isinstance(ids, list) or not all(v in allowed_ids for v in ids):
                raise ValueError("Invalid claim or unsupported sourceFactId; no automatic repair")
    return items


def classify(directory, pages, facts_path, batch_size):
    load_env()
    model = os.environ.get("PRODUCT_ASSET_MODEL") or os.environ.get("OPENAI_MODEL", "deepseek-flash")
    base = os.environ.get("OPENAI_BASE_URL", "https://api.deepseek.com").rstrip("/")
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise ValueError("Missing OPENAI_API_KEY")
    facts = read_json(facts_path)
    fact_items = [item for values in facts.values() if isinstance(values, list) for item in values if isinstance(item, dict) and isinstance(item.get("id"), str)]
    allowed_ids = {item["id"] for item in fact_items}
    inventory = [{k: item.get(k, "") for k in ("id", "text")} for item in fact_items]
    failed_file = directory / "failed-pages.json"
    failed_pages = set(read_json(failed_file)) if failed_file.exists() else set()
    candidates = [p for p in pages if p["status"] == "candidate" and p["sourcePage"] not in failed_pages]
    cache = directory / "classification"
    cache.mkdir(exist_ok=True)
    output = []
    usage = []
    for offset in range(0, len(candidates), batch_size):
        batch = candidates[offset:offset + batch_size]
        content = [{"type": "text", "text": "商品事实（只用于核对ID，不得替代图片事实）：" + json.dumps(inventory, ensure_ascii=False)}]
        for page in batch:
            content.append({"type": "text", "text": f"物理页码 sourcePage={page['sourcePage']}\n本页提取全文：\n" + (directory / page["textPath"]).read_text(encoding="utf-8")})
            encoded = base64.b64encode((directory / page["thumbnailPath"]).read_bytes()).decode()
            content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + encoded}})
        body = {"model": model, "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": content}], "temperature": .2, "max_tokens": 12000, "response_format": {"type": "json_object"}}
        request_hash = digest(json.dumps(body, ensure_ascii=False, sort_keys=True).encode())
        prefix = cache / request_hash
        raw_file = prefix.with_suffix(".json")
        started = prefix.with_suffix(".started")
        if raw_file.exists():
            response = read_json(raw_file)
        else:
            # Unknown network outcome is not silently resubmitted on the next run.
            with started.open("x", encoding="utf-8") as handle:
                handle.write(json.dumps({"model": model, "pages": [p["sourcePage"] for p in batch], "requestHash": request_hash}))
            request = urllib.request.Request(base + "/chat/completions", data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}, method="POST")
            print(f"classifying {offset + 1}-{offset + len(batch)}/{len(candidates)} model={model}", flush=True)
            try:
                with urllib.request.urlopen(request, timeout=180) as response_stream:
                    response = json.load(response_stream)
            except Exception as exc:
                # Never dump request headers or image/base64 payloads to the terminal.
                raise RuntimeError(f"Classification stopped ({type(exc).__name__}); no automatic retry. Request marker: {started.name}") from None
            save_json(raw_file, response)
        content_text = response.get("choices", [{}])[0].get("message", {}).get("content", "")
        try:
            parsed = json.loads(content_text)
            output.extend(validate_classification(parsed, batch, allowed_ids))
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            # This request has already happened. Preserve it as unusable and
            # continue with later, never-before-sent groups; never retry it.
            output.extend({"sourcePage": p["sourcePage"], "keep": False, "moduleTag": "分类失败", "buyerNeedTags": [], "sellingAngleTags": [], "supportedClaims": [], "proofStrength": "weak", "coverReady": False, "notes": f"本次AI返回不可解析，未自动重试：{type(exc).__name__}"} for p in batch)
            print(f"unusable response for pages {batch[0]['sourcePage']}-{batch[-1]['sourcePage']}; skipped without retry", flush=True)
        usage.append({"requestHash": request_hash, "model": model, "usage": response.get("usage"), "pages": [p["sourcePage"] for p in batch]})
        save_json(directory / "classification-usage.json", usage)
    save_json(directory / "classified-pages.json", {"promptVersion": PROMPT_VERSION, "model": model, "pages": output})
    print(json.dumps({"classified": len(output), "aiRetained": sum(p["keep"] for p in output), "cachedRequests": len(usage)}))


def materialize(pdf, directory, pdf_hash, target, activate):
    manifest_file = directory / "asset-manifest.json"
    if manifest_file.exists():
        # Human reviews are never overwritten by a rerun.
        manifest = read_json(manifest_file)
    else:
        classified = read_json(directory / "classified-pages.json")["pages"]
        pool = [p for p in classified if p["keep"] and p["proofStrength"] != "weak"]
        pool.sort(key=lambda p: (p["proofStrength"] != "strong", p["sourcePage"]))
        chosen = []
        need_usage = {}
        while pool and len(chosen) < target:
            # Buyer's reason diversity first. Never invent scores or claim associations.
            best = min(pool, key=lambda p: (sum(need_usage.get(t, 0) for t in p["buyerNeedTags"]), p["proofStrength"] != "strong", p["sourcePage"]))
            pool.remove(best)
            chosen.append(best)
            for tag in best["buyerNeedTags"]:
                need_usage[tag] = need_usage.get(tag, 0) + 1
        if not chosen:
            raise ValueError("No sufficiently supported pages; do not fabricate assets")
        (directory / "selected").mkdir(exist_ok=True)
        assets = []
        with fitz.open(pdf) as doc:
            for candidate in sorted(chosen, key=lambda p: p["sourcePage"]):
                number = candidate["sourcePage"]
                selected = f"selected/page-{number:04d}.png"
                page = doc[number - 1]
                page.get_pixmap(matrix=fitz.Matrix(1600 / page.rect.width, 1600 / page.rect.width), colorspace=fitz.csRGB, alpha=False).save(str(directory / selected))
                assets.append({"assetId": f"delf-{pdf_hash[:12]}-p{number:04d}", "productId": PRODUCT, "pdfHash": pdf_hash, "sourcePage": number, "selectedPath": selected, **{k: candidate[k] for k in ("moduleTag", "buyerNeedTags", "sellingAngleTags", "supportedClaims", "proofStrength", "coverReady", "notes")}, "reviewStatus": "pending"})
        manifest = {"schemaVersion": 1, "productId": PRODUCT, "pdfHash": pdf_hash, "visualRoute": "pdf_screenshot", "assets": assets}
        save_json(manifest_file, manifest)
    if activate:
        save_json(directory.parent / "current.json", {"pdfHash": pdf_hash})
    print(json.dumps({"manifest": str(manifest_file), "candidates": len(manifest["assets"]), "reviewed": sum(p["reviewStatus"] == "kept" for p in manifest["assets"]), "active": activate}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "classify", "materialize"))
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--facts", type=Path)
    parser.add_argument("--root", type=Path, default=ROOT / "data" / "product-assets" / PRODUCT)
    parser.add_argument("--batch-size", type=int, default=6)
    parser.add_argument("--target", type=int, default=25)
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()
    pdf = args.pdf.resolve(strict=True)
    pdf_hash = digest(pdf.read_bytes())
    directory = args.root.resolve() / pdf_hash
    directory.mkdir(parents=True, exist_ok=True)
    lock = directory / ".init.lock"
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
        if args.command == "prepare":
            prepare(pdf, directory, pdf_hash)
        elif args.command == "classify":
            if not args.facts or not 1 <= args.batch_size <= 10:
                parser.error("classify requires --facts and batch-size 1..10")
            classify(directory, read_json(directory / "pages.json"), args.facts, args.batch_size)
        else:
            if not 20 <= args.target <= 30:
                parser.error("target must be 20..30")
            materialize(pdf, directory, pdf_hash, args.target, args.activate)
        if digest(pdf.read_bytes()) != pdf_hash:
            raise RuntimeError("Source PDF changed during processing")
    finally:
        os.close(fd)
        lock.unlink()


if __name__ == "__main__":
    main()
