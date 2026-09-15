"""Lightweight local curation of the already classified Product 1 asset pool.

This deliberately does not call a model. It keeps only representative pages,
cleans buyer-need labels, and adds four targeted pages already present in the
prepared PDF page cache.
"""
import json, shutil
from pathlib import Path
import pymupdf as fitz

PDF = Path(r"D:\claude_work\xunixiangmu\pdf_build\output\DELF_B2_写作三库.pdf")
ROOT = Path(__file__).resolve().parents[1]
HASH = "0fb6ee6fe985fd7cbb2e43276e1bdfdaada2cc86ea493473e9f300aad4ad6f99"
DIR = ROOT / "data" / "product-assets" / "delf_b2_writing" / HASH

A = {
    5: ("商品全貌", ["不知道商品里到底有什么", "想先判断资料是否完整"], ["PRODUCT_OVERVIEW", "VALUE_PROOF"]),
    42: ("评分与任务导览", ["不知道评分到底看什么", "怕写错任务方向"], ["PRODUCT_OVERVIEW", "PAIN_CHECK"]),
    50: ("文体格式", ["正式信格式不会写", "不知道卷面怎么组织"], ["FORMAT_TASK", "VALUE_PROOF"]),
    57: ("词汇库总览", ["词汇背了不会用", "考前不知道先背什么"], ["VOCAB_SYNTAX", "EXAM_PREP"]),
    58: ("考前复习", ["考前不知道先复习什么", "时间不够不知如何取舍"], ["EXAM_PREP", "PRODUCT_OVERVIEW"]),
    129: ("句法库", ["表达普通不会升级", "易混句式不会用"], ["VOCAB_SYNTAX", "PAIN_EXPRESSION"]),
    183: ("论证组合示例", ["不会展开观点", "论据和句子接不起来"], ["PAIN_IDEA", "VALUE_PROOF"]),
    219: ("考前冲刺", ["考前资料太多不知道看什么", "需要最后一周复习顺序"], ["EXAM_PREP", "PRODUCT_OVERVIEW"]),
    225: ("跨主题表达与考场规则", ["临场想不起能用的表达", "担心考场规则踩坑"], ["EXAM_PREP", "VOCAB_SYNTAX"]),
    226: ("考场规则清单", ["不知道考试当天要准备什么", "怕因为流程细节出问题"], ["EXAM_PREP", "PAIN_CHECK"]),
}
B = {
    6: ("低频文体范文", ["遇到低频文体不会写", "不知道特殊文体长什么样"], ["FORMAT_TASK", "VALUE_PROOF"]),
    7: ("完整议论文样张", ["论证结构散乱", "不会展开观点"], ["PAIN_IDEA", "VALUE_PROOF"]),
    16: ("正式信代表范文", ["正式信开头和称呼不会写", "正式语气拿不准"], ["FORMAT_TASK", "PAIN_EXPRESSION"]),
    18: ("论坛投稿代表范文", ["论坛投稿不知道怎么写", "不会做让步和回应"], ["FORMAT_TASK", "PAIN_IDEA"]),
    37: ("正式信结尾样张", ["正式信结尾没思路", "缺少可用句型"], ["FORMAT_TASK", "PAIN_EXPRESSION"]),
    54: ("文体识别样张", ["拿到题不知道是哪种文体", "怕审题方向错"], ["FORMAT_TASK", "PAIN_CHECK"]),
    99: ("正式信开头模板", ["正式信开头不会写", "面对不同场景不会起笔"], ["FORMAT_TASK", "PAIN_EXPRESSION"]),
    102: ("正式信结尾模板", ["正式信不知道怎么礼貌收尾", "结尾表达太单一"], ["FORMAT_TASK", "PAIN_EXPRESSION"]),
}
SUPPLEMENT_CLAIMS = {
    58: ["本页展示按考前1周、2周、1月等时间窗口安排词汇复习的表格。"],
    219: ["本页展示考前冲刺模块的内容总览，包括词汇优先级和考场规矩清单。"],
    225: ["本页展示跨主题法语表达及其在论证、转折、让步、结尾等场景中的用途。"],
    226: ["本页展示考前物资、到场、设备和答卷过程等考场事项的清单。"],
}
C_EXCLUDED = [10, 14, 15, 26, 49, 53, 67, 184, 185, 186, 187]
RISK = ("官方", "必须", "归零", "扣分", "高频", "频率", "提分", "考官", "硬规", "直接", "≥", "一票否决")

def main():
    manifest = json.loads((DIR / "asset-manifest.json").read_text(encoding="utf-8"))
    by_page = {a["sourcePage"]: a for a in manifest["assets"]}
    selected = []
    with fitz.open(PDF) as doc:
        for page_no, (module, needs, angles) in {**A, **B}.items():
            asset = dict(by_page.get(page_no, {}))
            if not asset:
                page = doc[page_no - 1]
                selected_path = f"selected/page-{page_no:04d}.png"
                (DIR / "selected").mkdir(exist_ok=True)
                page.get_pixmap(matrix=fitz.Matrix(1600 / page.rect.width, 1600 / page.rect.width), colorspace=fitz.csRGB, alpha=False).save(str(DIR / selected_path))
                asset = {"assetId": f"delf-{HASH[:12]}-p{page_no:04d}", "productId": "delf_b2_writing", "pdfHash": HASH, "sourcePage": page_no, "selectedPath": selected_path, "supportedClaims": [{"claim": c, "sourceFactIds": []} for c in SUPPLEMENT_CLAIMS[page_no]], "proofStrength": "strong", "coverReady": False, "notes": "定向补充页面；基于原PDF页面文字和截图，不调用模型。"}
            claims = asset.get("supportedClaims", [])
            if page_no in SUPPLEMENT_CLAIMS:
                claims = [{"claim": c, "sourceFactIds": []} for c in SUPPLEMENT_CLAIMS[page_no]]
            safe_claims = []
            for claim in claims:
                c = claim.get("claim", "") if isinstance(claim, dict) else str(claim)
                item = {"claim": c, "sourceFactIds": claim.get("sourceFactIds", []) if isinstance(claim, dict) else []}
                if any(word in c for word in RISK): item["claimSafety"] = "restricted"
                safe_claims.append(item)
            asset.update({"moduleTag": module, "buyerNeedTags": needs, "sellingAngleTags": angles, "supportedClaims": safe_claims, "curationTier": "A" if page_no in A else "B", "reviewStatus": "pending"})
            selected.append(asset)
    selected.sort(key=lambda a: a["sourcePage"])
    out = dict(manifest)
    out["schemaVersion"] = 2
    out["assets"] = selected
    out["curation"] = {"method": "local_lightweight_curation", "sourceCandidateCount": 25, "targetCount": len(selected), "humanReviewRequired": True, "excludedPages": C_EXCLUDED, "excludedReason": "同类范文/模板重复或购买理由覆盖弱"}
    (DIR / "asset-manifest.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "data" / "product-assets" / "delf_b2_writing" / "current.json").write_text(json.dumps({"pdfHash": HASH}, indent=2), encoding="utf-8")
    report = {"sourceCandidateCount": 25, "aCount": len(A), "bCount": len(B), "cCount": len(C_EXCLUDED), "targetCount": len(selected), "supplementedPages": sorted(SUPPLEMENT_CLAIMS), "excludedPages": C_EXCLUDED, "sellingAngles": sorted({angle for a in selected for angle in a["sellingAngleTags"]})}
    (DIR / "refinement-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
if __name__ == "__main__": main()
