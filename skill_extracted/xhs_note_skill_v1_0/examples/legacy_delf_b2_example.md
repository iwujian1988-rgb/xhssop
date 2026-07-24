# 示例：DELF B2 写作资料包

## 输入

```yaml
product: delf_b2_writing
content_source_type: knowledge_point
knowledge_point:
  title: "important 的 B2 替换词"
  content:
    - "important → essentiel / primordial"
    - "problème → enjeu / difficulté"
    - "je pense que → il me semble que"
cover_template: table_compare
title_template: dont_only
```

## 生成封面标题阶段

```yaml
locked_context:
  product: "DELF B2 写作资料包"
  content_source: "知识库知识点"
  content_core: "important 的 B2 替换词"
  cover_template: "表格对照型"
  title_template: "别再型"

variants:
  - id: 1
    version_type: "最贴近竞品标题"
    cover_title: "B2 写作\n别再只会 important"
    cover_title_line_break: "B2 写作\n别再只会 important"
    xhs_title: "DELF B2 写作替换词：别再只会 important，这些表达更像 B2"
    title_source: "标题母版：别再型"
    migration_logic: "低级表达 important → 别再只会 important"
    seo_keywords:
      - "DELF B2 写作"
      - "法语 B2"
      - "法语写作替换词"
    cover_layout_note: "使用已选表格对照型母版，顶部标题，下方普通表达 vs B2 替换表格。"

  - id: 2
    version_type: "更短、更适合封面大字"
    cover_title: "别再只写\nimportant 了"
    cover_title_line_break: "别再只写\nimportant 了"
    xhs_title: "法语 B2 写作：important 别再反复写，可以这样替换"
    title_source: "同一标题母版压缩版"
    migration_logic: "保留‘别再’结构，缩短封面大字。"
    seo_keywords:
      - "法语 B2"
      - "法语写作"
      - "B2 替换词"
    cover_layout_note: "仍使用表格对照型母版，不更换样式。"

  - id: 3
    version_type: "同骨架强化版"
    cover_title: "别再把\nimportant 写到底"
    cover_title_line_break: "别再把\nimportant 写到底"
    xhs_title: "DELF B2 写作：别再把 important 反复写到底，这些表达更像 B2"
    title_source: "同一标题母版：别再型"
    migration_logic: "保留‘别再 + 低效/低级表达’骨架，只调整具体措辞和 SEO 长尾词。"
    seo_keywords:
      - "DELF B2 写作"
      - "法语作文"
      - "法语写作替换词"
    cover_layout_note: "仍使用表格对照型母版，不更换样式。"
```

## 选定版本 1 后的内页脚本

```yaml
selected_variant_id: 1
page_template: "表格对照型"
pages:
  - page: 1
    type: "cover"
    title: "B2 写作\n别再只会 important"

  - page: 2
    page_title: "先说结论"
    core_point: "B2 写作不是越复杂越好，但一些太基础的词会让文章等级感停在 B1。"
    support:
      - "important 用得太多，表达会显得单一"
      - "problème 可以换成更具体的名词"
      - "观点句不要总从 je pense que 开始"
    copy_format: "结论 + 3 条 bullet"
    layout_note: "大标题 + 3 条 bullet"

  - page: 3
    page_title: "普通词换法"
    core_point: "先从最常见的几个词开始换，不要一上来堆冷门词。"
    support:
      - "important → essentiel / primordial"
      - "problème → enjeu / difficulté"
      - "je pense que → il me semble que"
    copy_format: "表格型"
    layout_note: "两列表格：普通表达 / B2 替换"

  - page: 4
    page_title: "不要只换词"
    core_point: "替换词只有放进完整句子里，才会真的改变作文质感。"
    support:
      - "Il est essentiel de..."
      - "Il convient de souligner que..."
      - "Cet enjeu mérite d'être pris en compte."
    copy_format: "错误 / 正确对照"
    layout_note: "普通句 vs B2 句"

  - page: 5
    page_title: "怎么用这些词"
    core_point: "不要把替换词孤立背，要把它们放进观点句、原因句和让步句里。"
    support:
      - "先换高频普通词"
      - "再配固定句法"
      - "最后放回范文段落"
    copy_format: "步骤型"
    layout_note: "三步使用法"

  - page: 6
    page_title: "资料里怎么整理"
    core_point: "我不是只堆单词，而是把替换词、句法和范文放在一起，方便迁移。"
    support:
      - "240 条 B2 替换词"
      - "100 条实用句法"
      - "20 篇多主题范文"
      - "写作检查清单"
    copy_format: "结论 + 3 条 bullet"
    layout_note: "资料卡片展示"

  - page: 7
    page_title: "适合谁"
    core_point: "适合能写一点，但写出来不够 B2、临考前想系统整理表达的人。"
    support:
      - "B1-B2 过渡"
      - "词汇总停在基础层"
      - "想把范文拆开用"
    copy_format: "结论 + 3 条 bullet"
    layout_note: "收口页"
```

## 正文 caption

```text
很多人准备 DELF B2 写作时，会先去背范文、背句子。

但写出来不像 B2，有时不是因为不会写，而是常用词一直停在 important / problème / je pense que 这一层。

所以我整理资料时，把替换词、句法和范文放在一起看，不是让你硬背高级词，而是知道每类表达该放到哪种句子里。

适合 B1-B2 之间、能写一点但写不出 B2 感、临考前想集中整理写作表达的人。

#DELFB2 #法语B2 #法语写作 #法语作文 #法语考试 #DELF备考
```
