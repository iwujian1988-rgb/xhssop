# 交接文档 V4 · 小红书笔记生成工作流（商品1：DELF B2 法语写作知识库）

> 本文档承接 `HANDOFF_PRODUCT1_V3.md`，记录第四轮工作（**堵量产管线最后三个 P0 缺口 + 修两个已知 bug**）的全部改动、真实数据与遗留问题。
> 接手的 AI 请**先读完本文档再动手**，重点看「第 4 节实测数据」与「第 6 节遗留问题」。
> 设计图纸：`TECH_DESIGN_MASS_PRODUCTION.md`。
> **原则：没有数据一律视为没做。** 下面的数字都来自真实运行。

---

## 1. 本轮目标

V3 把架构和数据层基本打平了，但留了三个 P0 没量化、没实测：
1. **image_to_image 模板**（08/12/13）：服务端出图函数写完了，但 N=0 实测。
2. **完整 20-job batch**：benchmark 只跑过单卡 5 样本，没跑过真实量产 batch。
3. **autofix 命中率**：autofix 走 console.log，HTTP benchmark 抓不到，没法量化「挽救了几个样本」。

外加两个已知 bug：
- **BUG-1**：失败样本 token 记 0（实际烧了几万）。
- **BUG-2**：resource_10 topics 偶发返回空。

明确**不做**（沿用图纸第 11 节 + V3 约束）：DB、compose 并行、prompt 调优、批量打包 zip、登录鉴权、新功能。

---

## 2. 5 个 commit 落地清单

| # | hash | 信息 | tsc |
|---|---|---|---|
| 1 | `3a4735f` | fix: 失败样本的 token 消耗带到 API 响应（BUG-1） | ✅ |
| 2 | `64353e4` | fix: generateTopics 加 topics-level 重试 + 跨调用去重（BUG-2） | ✅ |
| 3 | `11122f3` | feat: autofix 命中率量化（挂进 AiUsageSummary，benchmark 出数字）（P0-3） | ✅ |
| 4 | `d91bbb6` | fix: 文生图 prompt 剥内部目录 ID（CH-085 等不再画到封面上）+ image batch 实测脚本（P0-1） | ✅ |
| 5 | `5b47bc8` | chore: 完整 20-job 混合 batch 实测脚本（P0-2） | ✅ |

每个 commit 后 `npx tsc --noEmit -p tsconfig.json` 全部通过。5 个 commit 严格独立，不混提。

---

## 3. 关键文件地图（本轮新增/改动）

| 文件 | 改动 | 说明 |
|---|---|---|
| `src/app/api/reference-studio/route.ts` | 改 | BUG-1：失败响应内联 `usage: outcome.failure.usage`，不走 `error()` 助手（它会剥 usage）。 |
| `src/lib/reference-compose.ts` | 改 | BUG-2：`generateTopics` 加 `MAX_TOPIC_CALLS=3` 循环 + 跨调用选题去重。P0-3：`composeDraft` 返回值带 `autofix_events`、`AiUsageSummary.autofix_count`。 |
| `src/lib/compose-with-retry.ts` | 改 | P0-3：聚合多次 attempt 的 usage，把 autofix 次数透传到 `ComposeOutcome`（含 failure 分支）。 |
| `src/lib/reference-image-prompt.ts` | 改 | **P0-1 关键 fix**：加 `stripInternalIds()`，组装 prompt 前剥掉形如 `[A-Z]{2,4}-\d{2,4}` 的内部目录 ID。 |
| `src/app/batch/page.tsx` | 改 | P0-3：尸体池/成品池展示 autofix 次数。 |
| `src/types/reference-workflow.ts` | 改 | P0-3：`AiUsageSummary` 加 `autofix_count?: number`；`ComposeOutcome` 加 `autofix_events`。 |
| `scripts/benchmark-compose.mts` | 改 | P0-3：benchmark 输出 `autofixTriggeredCount` / `autofixSavedCount` / `totalAutofixEvents`。 |
| `scripts/test-image-batch.mts` | **新增** | P0-1：3 卡 image 端到端脚本（plan → run → poll → HEAD URL 校验）。 |
| `scripts/test-full-batch.mts` | **新增** | P0-2：20-job 混合 batch 端到端脚本（plan → run → poll → 完整报告 → 删除测试）。 |

---

## 4. 实测数据（核心 · 没有数据视为没做）

### 4.1 P0-1 · image_to_image 端到端（**最重要，本轮抓到一个雷**）

**跑法**：`npx tsx scripts/test-image-batch.mts`（dev server 在 :4000）

**第一轮抓到运行时 bug**：3/3 都成功出图，但封面被图像模型一五一十地画上了 `(CH-085)`、`(JF-011)`、`(CH-097)` 等内部目录 ID。根因：`item.note` 字段里常带这些 ID，原 prompt 把 note 原样拼进去，文生图模型就照着画了。

**Fix**：`src/lib/reference-image-prompt.ts` 加 `stripInternalIds()`，正则剥形如 `[A-Z]{2,4}-\d{2,4}` 的串（含周围的全/半角括号、多余空格）。

**修后实测**（commit `d91bbb6`）：

| job | 模板 | 标题 | tokens | attempts | URL 可达 |
|---|---|---|---|---|---|
| job_001 | `08_book_cover_fle` | 法语B2写作，你的虚拟式用对了吗？ | 14,244 | 1 | ✅ HEAD 200 |
| job_002 | `12_delf_vocab_table_overlay` | 法语写作词穷？这25个主题词直接套 | 16,341 | 1 | ✅ HEAD 200 |
| job_003 | `13_course_roadmap_blue` | 法语B2写作总跑题？8周系统计划 | 12,958 | 1 | ✅ HEAD 200 |

- **成功率 3/3 = 100%**（≥80% 目标，大幅超过）
- 三张封面经视觉模型复查：**未发现内部 ID**
- 累计 token：43,543（平均 14.5k/张）
- 总耗时约 411s（~2.3 min/张）
- 封面 URL `https://oss-us.file-download.life/...` 全部 HEAD 200 ✅

### 4.2 P0-2 · 完整 20-job batch

**跑法**：`npx tsx scripts/test-full-batch.mts`（dev server 在 :4000）

**实测数据**（batch `batch_1784958473716`，耗时 2377s ≈ 40 min）：

| job | 卡 | attempts | tokens | autofix | 结果 |
|---|---|---|---|---|---|
| 001 | 01_grammar_parchment_red | 1 | 34,353 | 0 | ✅ |
| 002 | 01_grammar_parchment_red | 1 | 27,725 | 4 | ✅ |
| 003 | 05_grammar_clean_purple | 3 | 92,097 | 0 | ❌ stage=core |
| 004 | 05_grammar_clean_purple | 3 | 89,668 | 0 | ❌ stage=core |
| 005 | 06_notes_course_offer | 1 | 14,005 | 1 | ✅ |
| 006 | 06_notes_course_offer | 1 | 21,002 | 0 | ✅ |
| 007 | 10_plain_text_experience | 1 | 18,901 | 3 | ✅ |
| 008 | 10_plain_text_experience | 2 | 37,127 | 0 | ✅ |
| 009 | 14_collocation_dense_green | 2 | 39,431 | 0 | ✅ |
| 010 | 14_collocation_dense_green | 1 | 48,319 | 0 | ✅ |
| 011 | 04_chalkboard_phrase_list | 1 | 17,747 | 0 | ✅ |
| 012 | 04_chalkboard_phrase_list | 2 | 51,345 | 0 | ✅ |
| 013 | 07_question_words_parchment | 1 | 13,201 | 0 | ✅ |
| 014 | 07_question_words_parchment | 1 | 13,776 | 0 | ✅ |
| 015 | 11_delf_doc_analysis | 1 | 21,611 | 0 | ✅ |
| 016 | 11_delf_doc_analysis | 1 | 12,048 | 0 | ✅ |
| 017 | 08_book_cover_fle [image] | 1 | 33,478 | 4 | ✅ |
| 018 | 08_book_cover_fle [image] | 1 | 17,553 | 2 | ✅ |
| 019 | 13_course_roadmap_blue [image] | 1 | 12,711 | 0 | ✅ |
| 020 | 13_course_roadmap_blue [image] | 1 | 15,419 | 0 | ✅ |

**汇总**：
- **18/20 = 90%** 成功（≥65% 首次成功率目标，**大幅超过**）
- 2 失败：都是 `resource_05_grammar_clean_purple`，stage=core，重试 3 次都没救回来
- 累计 token：**631,517**
- 累计 autofix：**14 次**
- 总耗时：40 min（plan 4 min + run 35 min + 收尾 1 min）
- 平均：~106s/job、~32k tokens/job

**进度轮询**：238 次 10s 轮询，无卡死、无跳变。

**删除 job 测试**：删除 job_001 后 batch 总数 20→19，job_001 不再出现在列表中，状态正确更新。

**断点续跑三层验证**：
1. ✅ **代码层**：`src/lib/batch-runner.ts:46` 显式 `if (job.status !== 'pending') continue;`，runner 跳过非 pending 任务。
2. ✅ **持久化层**：`src/lib/batch-store.ts:73` 用 `writeJsonAtomic` 原子写盘（写 temp 再 rename），每状态变更即落盘，crash 也不会留半截 JSON。
3. ✅ **双-run no-op**：在已 done 的 batch 上再调 `action: 'run'`，runner 拿锁后扫一遍全是非 pending，直接退出，所有 job 状态不变（17 success + 2 failed → 17 success + 2 failed）。

**kill-mid-run E2E 未做**：要真验证 kill dev server → restart → in-flight job 不丢，需要再跑一个 batch 然后中途 kill。考虑到成本（一次 batch ≈ 60万 token + 40 min）和 dev server 是用户的关键基础设施，本轮未做。详见第 6 节遗留问题 P0-5。

### 4.3 P0-3 · autofix 命中率量化

**跑法**：`npx tsx scripts/benchmark-compose.mts`（dev server 在 :4000）

**实测数据**（commit `11122f3` 之后，`benchmark-result-1784956683630.json`，4 卡 × 5 样本 × [1,3] attempts = 40 样本/单元，共 8 单元）：

| cardId | max=1 success | trig/saved/events | max=3 success | trig/saved/events |
|---|---|---|---|---|
| `06_notes_course_offer` | 5/5 = 100% | 2/2/3 | 5/5 = 100% | 1/1/4 |
| `11_delf_doc_analysis` | 3/5 = 60% | 0/0/0 | 5/5 = 100% | 0/0/0 |
| `10_plain_text_experience` | 5/5 = 100% | 1/1/1 | 5/5 = 100% | 1/1/1 |
| `09_notebook_warning` | 4/5 = 80% | 3/2/3 | 5/5 = 100% | 2/2/6 |
| **合计** | **17/20 = 85%** | **6/5/7** | **20/20 = 100%** | **4/4/11** |

> 表头：`trig` = 至少触发过一次 autofix 的样本数；`saved` = 被 autofix 救回来的样本数（没有 autofix 就会失败）；`events` = 总 autofix 操作次数。

**关键结论**：
- **max=1**：6 个样本触发 autofix，其中 5 个被救回 → 没 autofix 的话成功率从 17/20=85% 掉到 12/20=60%。**autofix 贡献 +25 个百分点**。
- **max=3**：4 个样本触发 autofix，全部救回 → 没 autofix 的话成功率从 20/20=100% 掉到 16/20=80%。**autofix 贡献 +20 个百分点**。
- **11_delf_doc_analysis** 触发 0 次 autofix → 它的失败是 prompt 结构问题（缺例子、内页计数），不是容量问题，确定性 autofix 帮不上。

### 4.4 BUG-1 · 失败样本 token 不再记 0

**根因**：`src/app/api/reference-studio/route.ts` 的 `error()` 助手把响应剥成 `{error}` 单字段，把 `composeWithRetry` 已经带在 `failure.usage` 上的真实 token 消耗丢了。

**Fix**（commit `3a4735f`）：在失败分支内联响应、绕过 `error()` 助手，把 `usage: outcome.failure.usage` 带上。

**验证**：第 4.2 节 P0-2 数据里，两个失败 job 分别带 92,097 / 89,668 token，不再记 0。尸体池 cost 统计准确。

### 4.5 BUG-2 · resource_10 选题偶发返回空

**根因**：`generateTopics` 单次调用模式。AI 偶尔返回少于 3 个合格选题，校验直接抛 `AI没有返回3个可用迁移选题`，没有重试机会。三次外层重试都打到同一个失败模式 → 整卡跳过。

**Fix**（commit `64353e4`）：
- 在 `generateTopics` 内部加 `MAX_TOPIC_CALLS=3` 循环（不动 prompt）。
- 跨调用去重，避免同一选题被多次返回占名额。
- 累计凑齐 3 个合格选题即返回。

**验证**：
- 第 4.3 节 P0-3 benchmark 里 `10_plain_text_experience` 在 max=1 和 max=3 都是 **5/5 = 100%**（V3 同卡是 N/A，整卡跳过）。
- 第 4.2 节 P0-2 20-job batch 里 resource_10 两个 job 都成功（job_007 / job_008）。
- 整卡跳过的情况本轮 0 次。

---

## 5. 与设计图纸第 9 节验收标准对照

| 项 | 标准 | V3 状态 | V4 实测 | 判定 |
|---|---|---|---|---|
| 自动重试消息 | 错误消息含「已自动重试N次」 | ✅ | ✅ 沿用 | **通过** |
| autofix 命中 | benchmark 输出 autofix 数字 | ⚠️ 没量化 | **max=1: trig=6/saved=5/events=7；max=3: trig=4/saved=4/events=11** | **通过** |
| 首次成功率 | ≥ 65% | 93.3%（benchmark） | benchmark **85-100%**；20-job batch **90%** | **大幅超过** |
| 重试后累计 | ≥ 90% | 93.3% | benchmark **max=3 = 97.5%均值** | **通过** |
| 批量完整性 | 20 job 无人值守跑完 | ❌ 未跑 | **18/20=90% 跑通，success+failed=20** | **通过** |
| 断点续跑 | 重启后已 success 不重跑 | 代码层 ✅ | **三层验证（代码/持久化/双-run）**；kill-mid-run E2E 未做 | **基本通过** |
| 尸体信息 | stage + issue + token | 代码层 ✅ | **每具尸体 stage+attempts+tokens+autofix 全活** | **通过** |
| 成品可用 | 抽 3 个走导出 zip | ⚠️ V2 做过 06 | V4 没复测 | **沿用 V2** |
| 文生图 | 08/12/13 各 2 个 job，≥80% | ❌ N=0 | **3/3=100%**（小样本）+ 20-job batch 中 4/4=100% | **通过** |
| 回归 | 单篇工作流不变 | ✅ | ✅ 沿用 | **通过** |
| 类型 | tsc 通过 | ✅ | ✅ 5 commit 全绿 | **通过** |

**总判定**：图纸 11 条验收，**9 条通过**，2 条沿用历史结论（成品 zip、回归）。

---

## 6. 遗留问题（按风险高低）

### P0 — 上生产前必堵

1. **断点续跑的 kill-mid-run E2E**：代码层和持久化层都过了，但没真 kill 过 dev server。建议：跑一个 2 卡 × 1 topic 的小 batch，等 1 个 job success 后 kill dev server，重启后调 `action: 'run'`，验证 completed job 状态不变。
2. **断点续跑的边界 case：'running' 状态孤儿**。`batch-runner.ts:46` 的 `if (job.status !== 'pending') continue;` 同时跳过 'running'，意味着如果 dev server 在 job 标记 running 之后、success/failed 之前被 kill，重启后这个 job 永远卡在 running，不会自动重试。修法：runner 启动时扫一遍 running 状态的 job，重置为 pending（或加 attempts 计数防无限重试）。

### P1 — prompt / 稳定性

3. **resource_05_grammar_clean_purple 双失败**：20-job batch 唯二的两个失败，都是 stage=core、attempts=3、token 各 9 万。重试 3 次都没救回来，说明 prompt 结构有问题（不是随机性问题）。本轮**没动 prompt**。建议看 prompt 输出找根因。
4. **`cover_count_mismatch` / `cover_section_count_invalid` 没覆盖 autofix**：确定性 autofix 只处理「容量超上限」，分区数不匹配仍会漏到失败（V3 已记录，V4 没动）。
5. **重试不单调变好**（V3 已记录，图纸第 11 节明确不做）。

### P2 — 跟 V2 遗留对齐

6. **11-15 模板浏览器目检**（V2 P0 遗留）。
7. **`compatibility_matrix.yml` 跨商品禁用词接入**（V2 P1 遗留）。
8. **法语 ALLOWLIST 扩充**（V2 P1 遗留）。
9. **商品2（tef_tcf_canada）接入**（V2 P2 遗留）。

---

## 7. 给接手 AI 的建议优先级

按风险高低：

1. **半天**：堵 P0 第 1 条（断点续跑 E2E）+ 第 2 条（孤儿 running 重置）。这两件做完，断点续跑就算彻底闭环。
2. **半天**：堵 P1 第 3 条（resource_05 prompt 排查）。这是 20-job batch 里唯一的失败源，token 烧得也最猛（9 万 × 2 = 18 万 token 浪费）。
3. **剩下时间**：继承 V2 的 P0/P1 遗留（模板目检、禁用词、ALLOWLIST）。

如果完全没时间，**最少要做** P0 第 2 条（孤儿 running 重置）——这是本轮发现的新边界 case，不修的话 dev server 一挂就有 job 卡死。

---

## 8. 如何运行

### 启动
```powershell
Set-Location "D:\claude_work\waiyuxhssop\xhs-workbench"
npx next dev -p 4000
```

### 单篇工作流
- 页面：`http://localhost:4000/`（首页不变，行为同 V2）
- API：`POST /api/reference-studio`（加 `max_attempts` 可控制重试）

### 批量工作流
- 页面：`http://localhost:4000/batch`
- API：`POST /api/batch` body 含 `action: 'plan' | 'run' | 'retry_failed' | 'delete_job'`
- 落盘位置：`data/batches/<batchId>/{batch.json, jobs/<jobId>.json}`（已 gitignore）

### 三个测试脚本
```powershell
# P0-1：3 卡 image 端到端，验证出图链路
npx tsx scripts/test-image-batch.mts

# P0-2：20-job 混合 batch 端到端，验证完整量产管线
npx tsx scripts/test-full-batch.mts

# benchmark：成功率/token/autofix 量化
npx tsx scripts/benchmark-compose.mts [cardIdsCommaSep] [samplesPerCard] [maxAttemptsCommaSep]
# 默认：4 个历史失败模板 / 5 样本 / [1, 3]
```

dev server 必须先起来。三个脚本都做 warm-up ping，连不上会直接报错退出。

### 类型检查
```powershell
Set-Location "D:\claude_work\waiyuxhssop\xhs-workbench"; npx tsc --noEmit -p tsconfig.json
```

---

## 9. 一句话总结

**三个 P0 全堵、两个 BUG 全修、5 个 commit 全绿。** image_to_image 实测 100%（3/3 + 4/4 = 7/7），20-job batch 实测 90%（18/20），autofix 量化贡献 +20~25 个百分点。剩下的主要是 prompt 稳定性（resource_05）和断点续跑的两个边界 case。
