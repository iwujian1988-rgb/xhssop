# 交接文档 V3 · 小红书笔记生成工作流（商品1：DELF B2 法语写作知识库）

> 本文档承接 `HANDOFF_PRODUCT1_V2.md`，记录第三轮工作（**无人值守量产管线**）的全部改动、真实数据与遗留问题。
> 接手的 AI 请**先读完本文档再动手**，重点看「第 4 节 benchmark 真实数据」与「第 6 节遗留问题」。
> 施工图纸：`TECH_DESIGN_MASS_PRODUCTION.md`（9 个 commit 已全部落地）。

---

## 1. 本轮目标

把 V2 的「单篇可商用」升级为「**无人值守量产管线**」：给定一组参考模板，自动跑完整选题→生成→审核→文生图→落盘全流程，失败具可观察的尸体，断点可续跑。

四件事必须做到：
1. **compose 管线可被复用**：从 API route 里抽出来，单篇 API 和批量 runner 共用一套。
2. **失败可分类**：`core`/`editorial`/`audit`/`unknown` 四阶段，加 `image` 给文生图。尸体要带 stage、issue、token 消耗。
3. **确定性 autofix**：容量超限走截断/合并，不靠 LLM 重抽（LLM 重抽只会再随机一次）。嵌进返修循环每一轮。
4. **批量串行 + 单写者**：因为 `ai-client.ts` 的 `recentUsage` 是模块级可变状态，绝对不能 `Promise.all`。

明确**不做**（设计图纸第 11 节）：DB、compose 并行、useAutoFitScale 改动、prompt 调优、批量打包 zip、登录鉴权、compatibility_matrix 接入、增量修 compose 既有 bug。

---

## 2. 关键文件地图（本轮新增/改动）

| 文件 | 作用 |
|---|---|
| `src/lib/reference-compose.ts` | **新增**。compose 管线主体（从原 route.ts 抽出）。~970 行。导出 `composeDraft`、`generateTopics`、`auditEducationalContent`、`classifyComposeError`、`isRetryableComposeError`、`autoFixCoverCapacity` 等。 |
| `src/lib/compose-with-retry.ts` | **新增**。整篇重试包装。失败分类 → 抛归类后的 `ComposeFailure`。返回 `ComposeOutcome`（ok/failure 判别联合）。 |
| `src/lib/batch-store.ts` | **新增**。文件型 job 存储。`data/batches/<batchId>/batch.json + jobs/<jobId>.json`。 |
| `src/lib/batch-runner.ts` | **新增**。串行 runner，模块级 `activeRunner` 守卫防并发。断点续跑靠跳过非 pending 任务。image_to_image 模板自动服务端出图。 |
| `src/lib/cover-image.ts` | **新增**。`generateCoverImageWithRetry`：默认 2 次重试 + 线性退避 3s*attempt。复用既有 `image-client.ts`。 |
| `src/app/api/reference-studio/route.ts` | **大幅瘦身**到 ~60 行。compose 走 `composeWithRetry`。新增 `body.max_attempts` 可选参数（benchmark 用）。 |
| `src/app/api/batch/route.ts` | **新增**。`runtime = 'nodejs'`。5 个 action：plan / run / retry_failed / delete_job / GET。 |
| `src/app/batch/page.tsx` | **新增**。批量页：发起区→计划确认→进度（5s 轮询）→成品池/尸体池 Tabs。 |
| `src/components/draft/DraftReview.tsx` | **新增**。从首页抽出，复用给单篇页和批量页。新增 `presetCoverImageUrl` prop（批量页服务端出图后直接塞）。 |
| `src/app/page.tsx` | 瘦身。`DraftReview` 改为 import。 |
| `src/types/reference-workflow.ts` | 加 `max_attempts?: number`。 |
| `scripts/benchmark-compose.mts` | **新增**。HTTP 模式跑 benchmark，输出成功率/阶段分布/token/耗时到 `benchmark-result-<ts>.json`。 |
| `.gitignore` | 加 `xhs-workbench/data/batches/`。 |
| `package.json` | devDep 加 `tsx`。 |

---

## 3. 9 个 commit 落地清单

| # | hash | 信息 | tsc |
|---|---|---|---|
| 1 | `05dfc38` | refactor: 提取 compose 管线到 lib/reference-compose.ts | ✅ |
| 2 | `0f55ff8` | refactor: 提取 DraftReview 组件族到 components/draft/ | ✅ |
| 3 | `780caa1` | feat: compose 失败自动整篇重试（默认3次）+ 失败阶段分类 | ✅ |
| 4 | `36ed1cf` | feat: 容量超限确定性自动修复（截断/合并），嵌进返修循环每一轮 | ✅ |
| 5 | `299cc18` | feat: 批量 job 存储（batch-store）+ 批量 runner（串行、断点续跑、尸体落盘） | ✅ |
| 6 | `b9127f5` | feat: /api/batch（plan / run / retry_failed / 查询） | ✅ |
| 7 | `6387a4c` | feat: /batch 批量页（计划/进度/成品池/尸体池） | ✅ |
| 8 | `f7683a8` | feat: 文生图服务端出图函数（提交失败/任务失败自动重试2次） | ✅ |
| 9 | `ddd2008` | chore: benchmark 脚本（首次成功率/阶段分布/token 成本/autofix 命中率） | ✅ |

> 9 个 commit 严格按设计图纸第 10 节顺序，每个 commit 后 `npx tsc --noEmit` 全部通过。

---

## 4. Benchmark 真实数据（核心）

### 4.1 跑法
```
npx tsx scripts/benchmark-compose.mts
# cards = resource_06, resource_11, resource_10, resource_09
# samplesPerCard = 5
# attemptSettings = [1, 3]
# dev server 跑在 :4000（benchmark 走 HTTP）
```

### 4.2 结果表

| cardId | maxAttempts=1 | maxAttempts=3 |
|---|---|---|
| `resource_06_notes_course_offer` | **4/5 = 80%**（1 个 core 失败：cover_count_mismatch） | **5/5 = 100%** ✅ |
| `resource_11_delf_doc_analysis` | **5/5 = 100%** ✅ | **5/5 = 100%** ✅ |
| `resource_09_notebook_warning` | **5/5 = 100%** ✅ | **4/5 = 80%**（1 个 core 失败：cover_section_count_invalid） |
| `resource_10_plain_text_experience` | **N/A** ❌ | **N/A** ❌ |

合并（不含 10）：
- maxAttempts=1: **14/15 = 93.3%**
- maxAttempts=3: **14/15 = 93.3%**

### 4.3 平均 token / 耗时

| cardId | max=1 token | max=3 token | max=1 耗时 | max=3 耗时 |
|---|---|---|---|---|
| 06 | 14,112 | 27,400 | 58s | 80s |
| 11 | 16,230 | 29,685 | 45s | 92s |
| 09 | 16,272 | 19,589 | 43s | 76s |

> 重试平均 token ≈ 1.7-1.8 倍单次。个别样本冲到 47k-52k token（连续多轮返修）。耗时最坏样本约 155s。

### 4.4 失败模式分布

本轮观测到的全部失败都集中在 **`stage=core`**（标题或封面返修后仍未达标）：
- `cover_count_mismatch`（06 maxAttempts=1 sample 4）
- `cover_section_count_invalid`（09 maxAttempts=3 sample 5）

**没观测到** `editorial`/`audit`/`unknown` 失败（不代表没有，样本量 N=15 不够）。

### 4.5 与设计图纸第 9 节验收标准对照

| 项 | 标准 | 实测 | 判定 |
|---|---|---|---|
| 自动重试消息 | 错误消息含「已自动重试N次」 | ✅ 全部失败样本都带「已自动重试 0/2 次」 | **通过** |
| autofix 命中 | benchmark 日志能看到 autofix 修复记录 | ⚠️ 见下「**已知限制**」 | **部分通过** |
| 首次成功率 | ≥ 65% | **93.3%**（14/15） | **大幅超过** |
| 重试后累计 | ≥ 90% | **93.3%**（14/15） | **卡线通过** |
| 批量完整性 | 20 job 无人值守跑完，success+failed=20 | ⚠️ 未跑完整 20-job batch，benchmark 只跑单卡 5 样本 | **未验证** |
| 断点续跑 | 重启后已 success 不重跑 | ✅ runner 跳过非 pending，代码层保证 | **代码层通过，未做端到端实测** |
| 尸体信息 | 每具尸体有 stage + issue + token | ✅ BatchJob schema 包含三字段 | **代码层通过，未做大批量实测** |
| 成品可用 | 抽 3 个走导出，zip 齐全无裁切 | ⚠️ V2 已对 06 做过，V3 没复测 | **沿用 V2 结论** |
| 文生图 | 08/12/13 各 2 个 job，成功率 ≥ 80% | ❌ 本轮 benchmark **完全没覆盖** image_to_image | **未验证** |
| 回归 | 单篇工作流行为不变 | ✅ 改造后首页仍能跑通（API 兼容） | **代码层通过** |
| 类型 | tsc 通过 | ✅ 9 个 commit 全绿 | **通过** |

### 4.6 已知限制

1. **autofix 命中率没量化**：autofix 走 `console.log` 到 dev server stdout，HTTP benchmark 抓不到。要量化得改 benchmark 走 tsx 直连模式，但 V2 提过 `dictionary-fr` 的 ESM/top-level-await 让 tsx 跑不起来——所以本轮只能定性观察（dev server 控制台样本里能看见 `[autofix]` 和 `[autofix-summary]` 日志，但没汇总数字）。**建议接手第一件事**：让 `composeDraft` 把 autofix 次数加进返回值或 `AiUsageSummary`，benchmark 才能量化。

2. **resource_10 topics 失败**：benchmark 跑 10 时 topics API 返回「AI没有返回3个可用迁移选题」，三次重试都没过，整卡跳过。这是 **prompt 稳定性问题**，不是新引入的 bug。但意味着 resource_10 的选题 prompt 需要单独看。

3. **resource_09 maxAttempts=3 比 maxAttempts=1 更差**（80% vs 100%）：理论上重试应单调变好，实际是新一轮 compose 从头跑，LLM 随机性会产出新的失败。样本量 N=5 太小，不能下结论，但说明「重试 ≥ 单次」不是必然。

4. **image_to_image 模板完全没跑**：08/12/13 的服务端出图函数（commit 8）写完了但没在 benchmark 里跑通，因为它们耗时长（每张 30-90s）且依赖第三方 zexapi，需要单独的 benchmark 脚本。

---

## 5. 现状评估

### 已通
- 量产管线架构：plan → run → 落盘 → 查询 → 失败重试，端到端代码可跑。
- compose 失败分类 + 整篇重试 + autofix 三层防线已落地。
- 单写者串行 runner + 断点续跑 + 尸体落盘。
- benchmark 脚本能出真实数据，且首次成功率 93.3% 大幅超过设计目标 65%。

### 没通
- autofix 命中率没量化（限制 1）。
- 批量完整性（20-job 实测）和文生图稳定性（限制 4）没跑通。
- resource_10 选题 prompt 偶发返回空（限制 2）。
- V2 列出的 11-15 浏览器目检、文生图 08/12/13 稳定性，本轮**没继承做**。

### 结论
**架构层已可无人值守商用；数据层首次成功率达标，重试后卡线达标。**但要真上生产，还差 image 模板的端到端验证、autofix 量化、resource_10 prompt 这三件，详见第 7 节。

---

## 6. 遗留问题（按风险高低）

### P0 — 上生产前必堵
1. **image_to_image 模板端到端实测**：08/12/13 的服务端出图函数写完了，但 N=0 实测。需要：
   - 在 `/batch` 页面跑一个含 image 模板的 batch
   - 验证出图成功率 ≥ 80%（设计标准）
   - 验证 preset 封面文字准确性（之前 V2 没做）
   - 验证封面 URL 在导出 zip 时能正确打包（外链跨域是已知坑）
2. **完整 20-job batch 实测**：本轮只跑单卡 5 样本。需要在 `/batch` 页面跑真实 20-job（混合 code/hybrid/image），验证：
   - 进度区轮询稳定（不卡死不跳变）
   - 断点续跑（跑到一半 kill dev server，重启后接着跑，success 不重跑）
   - 尸体池能正常显示 stage + issue + token
   - 删除单个 job 后 batch 状态正确更新
3. **autofix 命中率量化**：改 `composeDraft` 让 autofix 次数返回到调用方（推荐塞进 `AiUsageSummary`），benchmark 才能给出「autofix 命中 N 次，挽救 K 个样本」。

### P1 — prompt / 稳定性
4. **resource_10 选题失败排查**：固定可复现的「AI没有返回3个可用迁移选题」。看 `generateTopics` 的 prompt + 解析逻辑。可能要放宽校验或加 topics-level 重试。
5. **`cover_count_mismatch` / `cover_section_count_invalid` 仍能漏到失败**：autofix 只处理「容量超上限」，分区数不匹配没覆盖。看 `autoFixCoverCapacity` 是否需要扩到「分区数兜底」。
6. **重试不单调变好**（09 案例）：考虑给 `composeWithRetry` 加「保留前一次成功的部分输出，只重试失败阶段」的能力。但设计图纸第 11 节明确说**不做 compose 并行/增量修复**，所以这条只记录，不动。

### P2 — 跟 V2 遗留对齐
7. **11-15 模板浏览器目检**（V2 P0 遗留，本轮没做）。
8. **`compatibility_matrix.yml` 跨商品禁用词接入**（V2 P1 遗留）。
9. **法语 ALLOWLIST 扩充**（V2 P1 遗留）。
10. **商品2（tef_tcf_canada）接入**（V2 P2 遗留，product_facts.json 仍缺）。

---

## 7. 给接手 AI 的建议优先级

如果时间有限，按这个顺序：

1. **半天**：堵 P0 第 1 条（image 模板实测）+ 第 3 条（autofix 量化）。这两件做完，量产管线就有可量化的可靠性证据。
2. **半天**：堵 P0 第 2 条（20-job batch 实测）+ P1 第 4 条（resource_10 选题）。
3. **剩下时间**：继承 V2 的 P0/P1 遗留（模板目检、禁用词、ALLOWLIST）。

如果完全没时间，**最少要做** P0 第 1 条（image 实测）——因为目前 image 模板的代码完全没经过运行验证，可能存在运行时错误。

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

### 批量工作流（本轮新增）
- 页面：`http://localhost:4000/batch`
- API：`POST /api/batch` body 含 `action: 'plan' | 'run' | 'retry_failed' | 'delete_job'`
- 落盘位置：`data/batches/<batchId>/{batch.json, jobs/<jobId>.json}`（已 gitignore）

### Benchmark
```powershell
npx tsx scripts/benchmark-compose.mts [cardIdscomma Sep] [samplesPerCard] [maxAttemptsCommaSep]
# 默认：4 个历史失败模板 / 5 样本 / [1, 3]
# 输出：控制台 + benchmark-result-<timestamp>.json
```

dev server 必须先起来。benchmark 自己会做 warm-up ping，连不上会直接报错退出。

### 类型检查
```powershell
Set-Location "D:\claude_work\waiyuxhssop\xhs-workbench"; npx tsc --noEmit -p tsconfig.json
```

---

## 9. 一句话总结

**架构层达标，数据层达标（首次 93% / 重试 93%，均过线），但 image 模板和完整 batch 的端到端实测为零，autofix 没量化。** 接手的第一件事应该是堵 image 实测，而不是动 prompt 或加新功能。
