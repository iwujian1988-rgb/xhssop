# DEV_SPEC.md：小红书资料带货笔记生成工作台 v1.0 开发说明

## 1. 开发目标

开发一个本地 Web 端小红书资料带货笔记生成工作台。

v1.0 只实现：

> 6 条固定主链路 + 状态机 + 兼容性校验 + 同母版 3 张封面候选 + 选 1 张生成内页 + caption/tag + 导出。

开发 AI 只负责实现 `SKILL.md`，不得重新设计业务流程。

---

## 2. 推荐技术栈

- Next.js + React + TypeScript；
- 画布：Konva.js 或 Fabric.js；
- 配置：本地 YAML/JSON；
- 图片导出：Canvas 导出 PNG，或 html-to-image / Playwright；
- v1.0 不接真实生图 AI。

---

## 3. v1.0 页面结构

### 左侧：状态输入区

1. 商品选择；
2. 主链路选择；
3. 内容来源选择；
4. 内容输入/补充区；
5. 封面母版选择；
6. 标题母版/爆款标题选择；
7. 生成封面按钮。

### 中间：封面预览区

1. 展示 3 张封面候选；
2. 3 张封面必须同母版；
3. 3 个标题必须同标题骨架；
4. 用户点选其中 1 张。

### 右侧：候选信息区

展示当前候选：

- 封面标题；
- 小红书标题；
- 标题来源；
- 标题迁移逻辑；
- SEO 词；
- chain_id；
- cover_template_id；
- title_template_id；
- 校验状态。

### 下方：内页 + 正文区

用户选定封面后生成：

- P1-P7 图片脚本；
- 正文 caption；
- tags；
- 一键导出。

---

## 4. 状态机字段

```ts
export type WorkflowState = {
  product_id: string | null;
  chain_id: string | null;
  content_source_type: 'preset_selling_point' | 'knowledge_point' | 'third_party_post' | null;
  content_core: string | null;
  selected_product_point_id?: string | null;
  cover_template_id: string | null;
  title_template_id: string | null;
  hot_title_id?: string | null;
  variants: CoverVariant[];
  selected_variant_id: string | null;
  page_template_id: string | null;
  page_scripts: PageScript[] | null;
  caption: string | null;
  tags: string[];
};
```

---

## 5. 必须实现的校验

### 5.1 商品与 chain 校验

`state.product_id` 必须等于 `chains[chain_id].product_id`。

### 5.2 内容来源校验

`content_source_type` 必须存在于 `chains[chain_id].allowed_content_source_types`。

### 5.3 封面母版校验

`cover_template_id` 必须存在于 `chains[chain_id].allowed_cover_templates`。

### 5.4 标题母版校验

`title_template_id` 必须存在于 `chains[chain_id].allowed_title_templates`。

若用户选择 hot title，则先读取 `hot_titles.yml` 中的 `suitable_title_template`，并确认该模板在当前 chain 允许范围内。

### 5.5 禁用词校验

生成结果中不得出现当前 chain 的 `forbidden_terms`。

### 5.6 内容量校验

知识点模式至少需要具体对照/例句/清单/样张。只有标签时禁止生成。

---

## 6. 封面候选生成规则

生成 `variants: CoverVariant[]`，长度固定为 3。

```ts
export type CoverVariant = {
  id: string;
  cover_title: string;
  cover_title_lines: string[];
  xhs_title: string;
  title_source: string;
  migration_logic: string;
  seo_keywords: string[];
  cover_template_id: string;
  title_template_id: string;
  layout_notes: string;
};
```

强制规则：

- 3 个 variant 的 `cover_template_id` 必须完全一致；
- 3 个 variant 的 `title_template_id` 必须完全一致；
- 3 个 variant 的 chain、商品、内容主方向必须完全一致。

---

## 7. 内页脚本规则

用户选定封面后，才生成内页。

```ts
export type PageScript = {
  page_no: number;
  role: 'cover' | 'bridge' | 'value' | 'proof' | 'soft_sell' | 'fit';
  page_title: string;
  core_conclusion: string;
  support_content: string[];
  copy_format_id: string;
  visual_notes: string;
};
```

P2 必须承接封面标题，不得直接硬卖。

P6-P7 才允许自然带到资料包。

---

## 8. 图片渲染规则

图片分三层：

1. 背景层；
2. 文字层；
3. 组件层。

v1.0 所有文字由 Canvas/HTML/SVG 渲染。不得把中文文字交给生图 AI。

---

## 9. 输出文件

每次生成一个目录：

```text
outputs/YYYY-MM-DD-HHMMSS/
  manifest.json
  covers/
    cover_1.png
    cover_2.png
    cover_3.png
  selected/
    cover.png
    pages/
      page_1.png
      page_2.png
      page_3.png
      page_4.png
      page_5.png
      page_6.png
      page_7.png
  caption.txt
  tags.txt
  preview.html
```

---

## 10. v1.0 不允许开发的功能

- 自动发布；
- 多账号管理；
- 数据统计；
- 竞品爬虫；
- 用户登录；
- 在线支付；
- 真正接入生图 AI；
- 上传竞品封面自动识别；
- 任意组合生成器。

这些全部进入 `FUTURE_PLAN.md`。

---

## 11. 开发验收

至少跑通 6 条 examples：

1. `01_delf_formula_migration.md`
2. `02_delf_expression_upgrade.md`
3. `03_delf_sentence_patterns.md`
4. `04_delf_mistake_contrast.md`
5. `05_tef_tcf_exam_choice.md`
6. `06_tef_tcf_30_day_clb7.md`

验收时重点看：

- 有没有跨商品混用术语；
- 3 张封面是否同母版；
- 3 个标题是否同骨架；
- P2 是否承接封面；
- P6-P7 是否自然带货；
- caption 是否最后生成且不像硬广。
