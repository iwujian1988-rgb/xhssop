# 示例：TEF/TCF Canada 备考资料包

## 输入

```yaml
product: tef_tcf_canada
content_source_type: preset_selling_point
selling_point_id: exam_comparison
cover_template: table_compare
title_template: compare_choice
```

## 封面标题候选

```yaml
locked_context:
  product: "TEF/TCF Canada 备考资料包"
  content_source: "预设卖点"
  content_core: "TEF/TCF 选考对比"
  cover_template: "表格对照型"
  title_template: "对比选择型"

variants:
  - id: 1
    version_type: "最贴近竞品标题"
    cover_title: "TEF 还是 TCF？\n先看这 5 点"
    xhs_title: "TEF Canada 还是 TCF Canada？目标 CLB7 前先看这 5 个差异"
    title_source: "标题母版：对比选择型"
    migration_logic: "A 还是 B？先看 N 个差异 → TEF 还是 TCF？先看 5 点"
    seo_keywords:
      - "TEF Canada"
      - "TCF Canada"
      - "CLB7"
    cover_layout_note: "使用表格对照型母版，顶部标题，下方 TEF/TCF 对照表。"

  - id: 2
    version_type: "更短、更适合封面大字"
    cover_title: "TEF / TCF\n到底选哪个？"
    xhs_title: "TEF Canada 和 TCF Canada 区别：法语移民考试到底选哪个？"
    title_source: "同一对比选择骨架压缩版"
    migration_logic: "保留选择焦虑，缩短标题"
    seo_keywords:
      - "TEF Canada 和 TCF Canada 区别"
      - "法语移民"
    cover_layout_note: "仍使用表格对照型母版。"

  - id: 3
    version_type: "同骨架强化版"
    cover_title: "冲 CLB7\nTEF 还是 TCF？"
    xhs_title: "冲 CLB7 选 TEF Canada 还是 TCF Canada？先看这几个差异"
    title_source: "同一标题母版：对比选择型"
    migration_logic: "保留‘A 还是 B？先看差异’骨架，只把目标用户的 CLB7 焦虑前置。"
    seo_keywords:
      - "CLB7"
      - "TEF Canada"
      - "TCF Canada"
    cover_layout_note: "仍使用表格对照型母版。"
```
