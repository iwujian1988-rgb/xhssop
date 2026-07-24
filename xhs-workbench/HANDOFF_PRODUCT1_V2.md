# 交接文档 V2 · 小红书笔记生成工作流（商品1：DELF B2 法语写作知识库）

> 本文档承接 `HANDOFF_PRODUCT1.md`，记录第二轮工作（测试 + 根因修复）的全部背景、改动、测试结果、现状与待办。
> 接手的 AI 请**先读完本文档再动手**，重点看「第 6 节现状」和「第 8 节 TODO」。

---

## 1. 项目背景

### 1.1 目标
做一个**本地可运行的小红书卖货笔记智能体**：给定商品 + 一张「参考封面模板」，自动产出可直接发布的高质量笔记（标题 / 封面 / 内页 / 正文 / 话题标签），尽量少人工。

产出质量要求达到「真人操盘手」水平：
- 封面不能像「程序员写的 HTML」，要有设计感、对齐、字体正常、不裁切、不溢出。
- 文案不能有 AI 味、不能有廉价夸张词（万能/必背/逆袭等）。
- 法语必须拼写正确、语法正确、语域正确，不能出现拼接乱码词。

### 1.2 商品
- **商品1（当前主攻）**：`delf_b2_writing` — DELF B2 法语写作知识库。知识库事实文件已就绪。
- **商品2（待接入）**：`tef_tcf_canada` — TEF/TCF 加拿大。**缺 `product_facts.json`**，详见第 9 节。

### 1.3 技术栈
- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4。
- 封面/内页用 **代码渲染（HTML/CSS）** 或 **AI 文生图**（第三方 `zexapi.com`）。
- 导出：`html-to-image`（DOM→PNG）+ `file-saver` + `jszip`。
- 法语校验：`nspell` + `dictionary-fr`（Hunspell 词典）。
- **已初始化 git**：仓库根在 `D:\claude_work\waiyuxhssop`（不是 `xhs-workbench` 子目录）。基线提交 `3f0ae84`（master），183 文件；`.env*` / `node_modules` / `.next` 已排除。改完请自行 commit，别再丢状态。

---

## 2. 关键文件地图

| 文件 | 作用 |
|---|---|
| `src/app/page.tsx` | 主工作流页面（首页）。选卡→选题→生成→审核→渲染→**导出**。含 `InnerPagePreview`（内页组件，**所有模板共用**）、`DraftReview`、`ReferenceImageGenerator`。 |
| `src/app/api/reference-studio/route.ts` | 核心 API。`action:'topics'` 生成选题；`action:'compose'` 生成整篇 + 审核 + 返修循环。含 `auditEducationalContent`（法语审校）、`getCoreIssues`（结构校验）、`clip`/`clipVisual`（截断）。 |
| `src/lib/cover-template-specs.ts` | 15 个模板的规格（分区数、每区条数、字数上限、family、renderMode、内容指令）。 |
| `src/lib/creative-card-library.ts` | `resource_XX` cardId → renderer 的映射表（见第 3 节）。 |
| `src/lib/french-spellcheck.ts` | 确定性法语词典校验（本轮新增/沿用）。 |
| `src/lib/export-image.ts` | 导出工具：单节点→PNG、外链图片下载、打包 zip。 |
| `src/components/templates/ReferenceCoverRenderer.tsx` | 代码渲染封面的总入口，含各 family 的子组件。 |
| `src/components/templates/useAutoFitScale.ts` | **核心自适应缩放 hook**：量真实高度 vs 可用高度，逐步缩小 CSS 变量 `--fit-scale` 直到不溢出。这是「版式根因方案」的核心。 |
| `src/components/templates/ParchmentDenseCover.tsx` / `WhiteGreenDirectoryCover.tsx` / `PurpleDirectoryCover.tsx` | 目录类封面组件（已套 `useAutoFitScale`）。 |
| `src/lib/reference-image-prompt.ts` | 文生图提示词构建（`book_cover`/`vocab_table`/`course_roadmap`）。 |
| `src/data/products.yml` | 商品元数据（含商品2）。 |
| `src/data/compatibility_matrix.yml` | 跨商品禁用词规则（**目前未在 route.ts 强制执行**，见 TODO）。 |
| `src/lib/product-facts-loader.ts` | 加载各商品 `product_facts.json`。商品2 指向的文件缺失。 |

**QA 页**：`/qa/[cardId]` 可单独预览某模板渲染。

---

## 3. 15 个模板清单

cardId → renderer → 渲染方式（`code`=纯代码渲染，`hybrid`=代码渲染，`image_to_image`=AI 文生图）：

| # | cardId | renderer | renderMode | 名称 |
|---|---|---|---|---|
| 01 | `resource_01_grammar_parchment_red` | parchment_dense_directory | code | 羊皮纸密集目录 |
| 02 | `resource_02_grammar_white_green` | white_green_directory | code | 白绿目录 |
| 03 | `resource_03_chalkboard_course` | blackboard_offer | hybrid | 黑板大字方案 |
| 04 | `resource_04_chalkboard_phrase_list` | blackboard_phrase | hybrid | 黑板短语密集表 |
| 05 | `resource_05_grammar_clean_purple` | clean_purple_directory | code | 白底紫色目录 |
| 06 | `resource_06_notes_course_offer` | memo_offer | code | 备忘录资料说明 |
| 07 | `resource_07_question_words_parchment` | word_flashcard | hybrid | 印刷式词卡 |
| 08 | `resource_08_book_cover_fle` | book_cover | **image_to_image** | 法语教材封面风 |
| 09 | `resource_09_notebook_warning` | notebook_big_words | hybrid | 手写本痛点大字 |
| 10 | `resource_10_plain_text_experience` | plain_experience | code | 极简经验长图 |
| 11 | `resource_11_delf_doc_analysis` | document_analysis | hybrid | 文档素材解析 |
| 12 | `resource_12_delf_vocab_table_overlay` | vocab_table | **image_to_image** | 主题词汇表压屏 |
| 13 | `resource_13_course_roadmap_blue` | course_roadmap | **image_to_image** | 蓝色学习路径信息图 |
| 14 | `resource_14_collocation_dense_green` | collocation_dense | code | 三列固定搭配密表 |
| 15 | `resource_15_grammar_grid_purple` | grid_purple_directory | code | 网格纸紫色体系 |

> 3 个 `image_to_image` 模板（08/12/13）走**文生图**：提前写好构图提示词，生成时把本篇标题+内容塞进去，**不再上传参考图做图生图**。逻辑在 `reference-image-prompt.ts` + `image-client.ts`。

---

## 4. 本轮（第二轮）我做的改动

### 4.1 内页溢出根因修复（最重要）★
- **问题**：所有模板共用的 `InnerPagePreview`（`page.tsx`）此前用「按字数猜字号」的静态启发式，密集内页被 `overflow-hidden` 裁掉最多约 **203px** 内容。这是第一轮「版式根因方案」漏掉的一处（因为它在 `page.tsx`，不在 templates 文件夹）。
- **修复**：套用 `useAutoFitScale`；**关键点是字号 + 间距（margin）+ padding 必须一起随 `--fit-scale` 缩放**——只缩字号不缩间距会残留溢出（第一次修复就栽在这，缩到 0.5 仍溢出 31–64px）。下限设 `min: 0.4`。
- **代码位置**：`src/app/page.tsx` 的 `InnerPagePreview` 函数。所有 `mt-*` / `space-y-*` 固定间距已改成 `calc(... * var(--fit-scale, 1))` 内联样式。

### 4.2 审核 issue location 格式不匹配 bug（系统性）★
- **问题**：`auditEducationalContent` 里「已修正的问题就不再计入」的过滤逻辑，要求 issue.location 与内部记录的 `correctedLocations` **完全字符串相等**。但审校模型自由书写 location（如 `cover > sections[0] > items[2] > primary`），而内部用点号格式（`cover.sections[0].items[2].primary`），**几乎永不匹配**。结果：内容已被修好，但针对旧文本的过期 issue 仍卡审核，导致不必要的返修甚至整篇失败。影响**所有模板**。
- **修复**：`src/app/api/reference-studio/route.ts` 中新增 `normalizeLocation`（去掉所有非字母数字字符再比较），并在 `output_schema` 里提示模型用点/方括号路径。

### 4.3 导出功能（第一轮已写，本轮首次浏览器实测通过）
- `src/lib/export-image.ts` + `page.tsx` 里的「导出封面 / 单独导出这张 / 打包下载全部（封面+内页）」按钮。

### 4.4 承接第一轮的既有改动（未回退，仍生效）
- `useAutoFitScale` 已套用于 11 个代码渲染模板。
- `french-spellcheck.ts` 确定性词典校验（拼接词硬错误拦发布，未收录词仅告警不阻塞）。
- `document_analysis` 字数上限调整（`maxPrimaryVisualLength:56` / `maxSecondaryVisualLength:34`）。
- `clip` / `clipVisual` 的拉丁词整词边界截断（防 `distinguées`→`disti`）。

---

## 5. 我做的测试与结果

### 5.1 API 层内容生成测试（脚本直连 `/api/reference-studio`）
针对第二轮重点的 4 个模板：

| 模板 | 结果 |
|---|---|
| `plain_experience`（10） | ✅ 通过，仅词典软告警（Linguee，真实专有名词） |
| `word_flashcard`（07） | ✅ 通过，0 问题 |
| `memo_offer`（06） | ⚠️ 首次失败 `cover_section_capacity_invalid`，重试通过 |
| `notebook_big_words`（09） | ⚠️ 首次失败（真实内容问题：要点重复 + 拼写 `moin`→`moins`），重试通过 |

> 结论：这类失败是**概率性偶发**（约 50%），返修循环耗尽 3 次后整篇失败，重试通常能过。不是新引入的 bug。

### 5.2 导出功能浏览器实测（memo_offer）
- ✅「导出封面」→ 提示「封面已下载」
- ✅「打包下载全部」→ 提示「打包完成：共 6 张图，已下载 zip」
- ✅「单独导出这张」→ 成功
- ✅ 无 JS 控制台报错

### 5.3 内页溢出修复验证（真实生成的 6 张内页）
用真实 compose 产出的 6 张内页 + 生产同款 CSS/hook 复现测量：

| 阶段 | 结果 |
|---|---|
| 修复前 | P1=139px、P2=191px、P3=48px、P4=203px 溢出 |
| 第一次修复（只缩字号，min0.5） | 仍溢出 31–64px（间距没缩） |
| **最终修复（字号+间距+padding 全缩，min0.4）** | **6 页溢出全部 = 0**，缩放仅 0.875–1.0（不难看） |

---

## 6. 现状评估（能不能商用）

### 核心链路已通
选题 → 生成 → 审核（LLM + 词典）→ 代码渲染/文生图 → 导出（PNG/zip），端到端跑得通。

### 关键硬缺口已补
- 封面裁切：11 个代码模板已套自适应缩放。
- 内页裁切：共用组件已修，实测清零。
- 导出：已实测可用。
- 审核假失败：location 匹配 bug 已修。

### 结论
**「核心可用」但还没到「稳定可无人值守商用」。** 差三件事，见 TODO。

---

## 7. 未关闭的风险

1. **生成偶发失败（约 50%）**：`memo_offer`、`document_analysis` 等在返修 3 次后仍可能整篇失败，需重试。原因是 LLM 结构/法语审校的概率性，不是确定性保证。
2. **文生图依赖第三方**：`zexapi.com` 偶发 502/超时/质量波动（08/12/13 三个模板）。
3. **法语正确性仍部分依赖 LLM**：词典硬校验只能确定性抓「拼写/拼接」类，语法/语域/搭配仍靠 LLM+返修，量大偶尔漏。
4. **11–15 及全部模板未做完整浏览器验收**：本轮只对 06 做了完整浏览器实测 + 用 06 的内页验证了共用组件；其余模板的封面在真实浏览器里的裁切/对齐**尚未逐一目检**（代码层已套同款方案，理论低风险，但缺证据）。
5. **`compatibility_matrix.yml` 跨商品禁用词未强制执行**：`route.ts` 没接这个规则，商品2 接入后有串味风险。

---

## 8. TODO（按优先级）

### P0 — 达到稳定商用的必做项
- [ ] **压低生成失败率**：调查 `cover_section_capacity_invalid` 与法语审校偶发失败，考虑：放宽/校准容量校验、增加返修次数、或对失败自动整篇重试（目前是抛错）。目标把「首次成功率」从约 50% 拉到可接受水平。
- [ ] **15 模板全量浏览器验收**：逐个 cardId 走完整流程，目检封面 + 内页的裁切/对齐/字体/溢出，产出「通过/问题」清单（对应本 TODO 的 report）。可优先补 11–15 与所有 `image_to_image`。
- [ ] **文生图稳定性**：对 08/12/13 加重试/超时兜底，确认三个模板都能稳定出图且文字准确。

### P1 — 质量与防串味
- [ ] **接入 `compatibility_matrix.yml` 禁用词**：在 `route.ts` 生成/审核阶段强制过滤跨商品词（商品1 禁 CLB7 等，商品2 禁 DELF B2 等）。
- [ ] **法语校验再加固**：扩充 `french-spellcheck.ts` 的 ALLOWLIST（subj、Linguee 等反复出现的合法缩写/专名），减少软告警噪音。

### P2 — 商品2 接入（详见第 9 节）
- [ ] 生成 `tef_tcf_canada` 的 `product_facts.json`。
- [ ] 用商品2 跑一遍全流程验收。

---

## 9. 商品2（tef_tcf_canada）接入评估

- **已就绪**：`products.yml` 有完整元数据；`route.ts` 主流程是**商品无关**的（换 product_id 即可）。
- **唯一硬缺口**：`product-facts-loader.ts` 中商品2 的 `FACT_PATHS` 指向 `D:\claude_work\taolun\法语付费资料\product_facts.json`，**该文件不存在**。
- **原料充足**：`D:\claude_work\taolun\法语付费资料\` 有 12 个核心 markdown（约 17 万字 / ~2600 行），近期已对照官方事实核查过，质量高。
- **接入路径**：把这 12 个 markdown 结构化成商品1 同款 `product_facts.json`（audiences / use_cases / pain_points / selling_points / knowledge_assets 等字段，参考商品1 的 `product_facts.json` 结构），放到 loader 指向的路径即可，主流程无需改。
- **注意**：接入后务必先落地 P1 的跨商品禁用词，否则容易 DELF/TEF 串味。

---

## 10. 如何运行与复现

### 启动开发服务器
```powershell
Set-Location "D:\claude_work\waiyuxhssop\xhs-workbench"
npx next dev -p 4000
```
> 本轮测试一直用 **4000 端口**。页面：`http://localhost:4000/`（主工作流）、`http://localhost:4000/qa/<cardId>`（单模板预览）、`http://localhost:4000/template-matrix`（模板总览）。

### API 直连测试（不走 UI，快）
`POST http://localhost:4000/api/reference-studio`
- 选题：`{ "action":"topics", "product_id":"delf_b2_writing", "reference_card_id":"<cardId>", "direction":"" }`
- 生成：`{ "action":"compose", "product_id":"delf_b2_writing", "reference_card_id":"<cardId>", "direction":"", "topic": <上一步返回的某个 topic 对象> }`

返回 `draft`（含 `cover`、`inner_pages`、`accuracy_audit`）。compose 失败会返回 `{ error: "..." }` 且 HTTP 非 200。

### 类型检查
```powershell
Set-Location "D:\claude_work\waiyuxhssop\xhs-workbench"; npx tsc --noEmit -p tsconfig.json
```
本轮所有改动 `tsc --noEmit` 均通过。

### 浏览器验收建议
用 `/qa/<cardId>` 或主页走流程，用 CDP `Runtime.evaluate` 量溢出：
```js
Array.from(document.querySelectorAll('article')).map(el => ({
  scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
  overflow: el.scrollHeight - el.clientHeight
}))
```
`overflow <= 2px` 视为通过。

---

## 11. 给接手 AI 的提醒
- 用户明确要求：**替他审核质量，不是「构建给一个人用的工具」**。产出要挑刺到能直接商用的程度，别只检查数据合法性。
- 用户对 token 消耗敏感，**优先用 API 直连脚本测内容生成**（快、便宜），只在需要验证「真实像素级版式/导出」时才开浏览器。
- 版式类 bug 的统一解法就是 `useAutoFitScale` + 「字号和间距一起随 --fit-scale 缩放」，别再回退到按字数猜字号。
- 法语拼写/例句问题：用户说「这些你改吧」——遇到确定性拼写错误直接修，别只报告。
- **仓库已存档**：基线 `3f0ae84`。改完请 commit；密钥在 `.env.local`，永远不要入库。
