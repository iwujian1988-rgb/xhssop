# xhs_note_skill v1.0

这是小红书资料带货笔记生成 Skill 的第一正式版本。

## v1.0 核心变化

相对 v0.2，v1.0 做了 4 个关键收敛：

1. 从自由组合改成 **6 条固定主链路**；
2. 增加 `data/chains.yml` 和 `data/compatibility_matrix.yml`；
3. 明确状态机，防止 AI 注意力丢失；
4. 把未来规划写入 `SKILL.md`，并单独放到 `FUTURE_PLAN.md`。

## 文件结构

```text
xhs_note_skill_v1_0/
├── SKILL.md
├── DEV_SPEC.md
├── FUTURE_PLAN.md
├── SKILL_FUTURE.md
├── README.md
├── data/
│   ├── products.yml
│   ├── chains.yml
│   ├── compatibility_matrix.yml
│   ├── cover_templates.yml
│   ├── title_templates.yml
│   ├── page_templates.yml
│   ├── copy_formats.yml
│   ├── seo_tags.yml
│   └── hot_titles.yml
└── examples/
    ├── 01_delf_formula_migration.md
    ├── 02_delf_expression_upgrade.md
    ├── 03_delf_sentence_patterns.md
    ├── 04_delf_mistake_contrast.md
    ├── 05_tef_tcf_exam_choice.md
    └── 06_tef_tcf_30_day_clb7.md
```

## 给开发 AI 的第一句话

```text
先不要写代码。先完整阅读 SKILL.md、DEV_SPEC.md、data/chains.yml、data/compatibility_matrix.yml，然后复述你理解的 v1.0 业务流程、状态机、6 条主链路、兼容性校验和不允许开发的功能。我确认后你再开发。
```
