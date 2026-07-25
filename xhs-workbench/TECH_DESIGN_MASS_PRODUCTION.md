# 技术方案 · 量产改造（自动重试 + 尸体队列 + 批量模式）

> 本文档是**可执行的技术设计**，不是概念讨论。每一处改动都落到真实文件、真实函数、真实行号（基于基线 `ef45750`）。
> 接手执行的 AI：严格按「第 10 节执行顺序」分 commit 落地，每步跑 `npx tsc --noEmit -p tsconfig.json`，不要跳步，不要顺手重构无关代码。
> 前置阅读：`HANDOFF_PRODUCT1_V2.md`（背景与既有约定）。

---

## 0. 一句话目标

把系统从「单篇手工工作台」改造成「无人值守量产流水线」：

```
选题池 × 模板矩阵 → 批量生成（失败自动重试）→ 成品池 / 尸体池 → 人工终审 → 一键导出
```

人的角色从操作员退到终审编辑。目标产能：**一批 20-30 篇无人值守跑完，完成率 ≥ 90%**，人只做 15 分钟终审。

---

## 1. 现状代码地图（带行号，执行前务必核对）

### 1.1 生成主链路 `src/app/api/reference-studio/route.ts`（1037 行）

| 位置 | 内容 | 关键点 |
|---|---|---|
| L22-57 `POST` | 入口，分发 `topics` / `compose` | 每次请求 `resetRecentAiUsage()` |
| L59-112 `generateTopics` | 1 次 LLM 调用产 3 选题 | 少于 3 个直接 throw |
| L114-277 `composeDraft` | **核心管线** | 串行 4 阶段，3 个 throw 点 |
| L124/L181 | core 生成（标题+封面） | `maxTokens: 6500, retries: 3` |
| L123/L214 | editorial 与 core **并行**发起 | `editorialPromise` 在 core 校验前已发出 |
| L193-212 | core 返修循环（最多 3 次） | **throw 点①**：`标题或封面返修后仍未达标：...` |
| L223-233 | editorial 返修（仅 1 次） | **throw 点②**：`内页或正文返修后仍未达标：...` |
| L234-252 | 审校循环（初审 + 最多 2 次复审） | **throw 点③**：`法语与考试事实审校未通过：...` |
| L279-419 `auditEducationalContent` | LLM 审校 + 词典硬校验 | 返回修正后的 cover/innerPages + summary |
| L878-919 `getCoreIssues` | 封面结构确定性校验 | 产出 `cover_section_capacity_invalid` 等 issue code |
| L921-932 `getEditorialIssues` | 内页/正文确定性校验 | 产出 `caption_length_invalid` 等 issue code |

### 1.2 AI 调用层 `src/lib/ai-client.ts`（107 行）

- `callOpenAICompatibleJson(messages, { maxTokens, retries, temperature })`：retries 只对网络错误/5xx/空内容重试，**4xx 直接抛**。
- **L22 有一个模块级全局 `recentUsage`**：所有请求共享的可变状态。`resetRecentAiUsage()` / `getRecentAiUsage()` 在 `route.ts` POST 头尾调用。
- ⚠️ **这是批量并发的头号陷阱**：两个 compose 并行跑，usage 会串账。本方案强制 **compose 串行（concurrency = 1）**，见第 7.1 节。

### 1.3 页面 `src/app/page.tsx`（305 行）

- L18-123 `StudioPage`：单篇工作流（选卡→topics→选题→compose→DraftReview）。
- L144-217 `DraftReview`：封面 + 任务单 + 标题候选 + 检查 + 审校 + 内页 + 正文 + 导出按钮。
- L230-265 `ReferenceImageGenerator`：文生图客户端轮询（`/api/image-generate` 提交 → `/api/image-task` 每 4s 轮询，最多 80 次）。**目前文生图只能在浏览器里手动点**，批量模式必须服务端化，见第 6 节。
- L267-305 `InnerPagePreview`：内页组件（已套 `useAutoFitScale`，**不要动它的缩放逻辑**）。

### 1.4 模板规格 `src/lib/cover-template-specs.ts`（137 行）

- 15 个 renderer 的 `sectionCount` / `itemsPerSection` / `minTotalItems` / 字数上限 / family / renderMode。
- `getCoreIssues`（route.ts L886-895）对 flexible family 已有容忍：分组数 ±1、每组条数 ±2。在此容忍下仍 `capacity_invalid`，说明 LLM 输出偏离规格较远，不是校验太严。

### 1.5 文生图客户端 `src/lib/image-client.ts`（108 行）

- `submitImageTask` / `getImageTask` 都是**服务端可用**的纯 fetch 封装（读 `IMAGE_API_KEY`），批量 runner 可直接复用，无需改造。

---

## 2. 失败根因分析（决定了重试策略怎么写）

compose 一次失败的三个 throw 点，对应三类尸体：

| throw 点 | 错误消息前缀 | 失败阶段码 | 性质 |
|---|---|---|---|
| ① L212 | `标题或封面返修后仍未达标：` | `core` | 结构/容量/禁词，3 次返修没救回来 |
| ② L232 | `内页或正文返修后仍未达标：` | `editorial` | 内页数量/标题/正文长度/AI腔，1 次返修没救回来 |
| ③ L251 | `法语与考试事实审校未通过：` | `audit` | 3 轮审校后仍有 error 级 issue |

加上前置的两类：`topics`（选题不足 3 个）、`image`（文生图失败）、`unknown`（网络/4xx/JSON 修复失败）。

**核心判断：失败 = 设计缺陷 + 概率性噪声的混合体，要分层打。**

### 2.1 原始方案的两个设计缺陷（必须根治，不能只靠重试）

**缺陷 1：确定性问题交给 LLM 修——类别错误。** `cover_section_capacity_invalid` 的本质是「分组数/条数超上限」，这类问题代码可以零风险修复（截断、合并），原始设计却写进 prompt 让 LLM 返修 3 次。让概率系统解决确定性问题，每次修复都是重新摇骰子。

**缺陷 2：返修是整体重生成，不是打补丁。** `repairCoreOutput` 每轮重写整个封面，各轮失败概率独立、不收敛——第 3 次返修和第 1 次一样容易造出新的容量违规。

### 2.2 概率性噪声（设计无过错，重试兜底）

法语语法/语域/搭配审校（throw 点③）本质上无法完全确定性化：词典抓拼写，语法/语域靠 LLM。同输入重采样通过率约 50%，属正常方差。证据：HANDOFF 记录 memo_offer / notebook_big_words 首次失败、原样重试即通过。

### 2.3 三层解法（本方案的完整逻辑）

| 层 | 手段 | 管什么 | 章节 |
|---|---|---|---|
| 根治层 | `autoFixCoverCapacity`：容量超限代码直接修，嵌进返修循环每一轮 | 缺陷 1（throw 点①的大部分） | 4.5 |
| 放大层 | 自动整篇重试 3 次（新采样） | 缺陷 1 剩余 + 2.2 全部 | 4.1 |
| 隔离层 | 尸体队列，失败不阻塞整批 | 兜住最后 ~5% | 4.4 |

量化预期：autofix 把首次成功率从 50% 拉到约 65-75%（**取决于失败方向**：LLM 倾向"多给"则 autofix 基本全吃掉；倾向"少给"则需创作，autofix 帮不上，靠重试——分布未知，所以 autofix 必须记录命中日志，benchmark 验证），叠加重试后 ≥ 95%，尸体池接剩余。**"彻底解决"的工程定义：不是 100% 成功，而是 100% 不阻塞 + 损耗可度量。**

---

## 3. 改造 0：前置重构（两个提取，必须先做）

### 3.1 把 compose 管线从 route.ts 提取到 lib

**为什么**：Next.js route 文件只应导出 HTTP 动词；批量 runner 和原 API 都要复用 `composeDraft`，必须落到 lib。

**做法**：
1. 新建 `src/lib/reference-compose.ts`，把 `route.ts` 中以下函数**整体搬走**（不改逻辑）：`composeDraft`、`generateTopics`、`auditEducationalContent`、`generateEditorialOutput`、`repairCoreOutput`、`repairEditorialOutput`，以及它们依赖的所有私有 helper（`normalizeTopic` ~ `sanitizePublicText`，即 L463-1033 的全部）和 `error` 以外的导入。
2. `reference-compose.ts` 导出：`generateTopics`、`composeDraft`（签名不变）、以及失败分类用的 `classifyComposeError`（见 4.2）。
3. `route.ts` 改成薄壳：只留 `POST`，从 `@/lib/reference-compose` 导入，保留参数校验和 `NextResponse` 包装。
4. 验证：`npx tsc --noEmit` 通过 + 手动跑一遍 topics + compose 确认行为不变。

**commit 1：`refactor: 提取 compose 管线到 lib/reference-compose.ts（纯搬运，无逻辑改动）`**

### 3.2 把 DraftReview 相关组件从 page.tsx 提取到 components

**为什么**：批量页 `/batch` 的成品池要复用同样的草稿预览/导出 UI。

**做法**：
1. 新建 `src/components/draft/DraftReview.tsx`：搬走 `page.tsx` 的 `DraftReview`、`DynamicDirectoryCover`、`ReferenceImageGenerator`、`InnerPagePreview`、`BriefFact`、`Check` 及 `UsageSummary` 类型（`UsageSummary` 若两用则移到 `src/types/reference-workflow.ts`）。
2. `page.tsx` 改为 `import { DraftReview } from '@/components/draft/DraftReview'`。
3. 验证：首页走一遍完整流程 + 导出，行为不变。

**commit 2：`refactor: 提取 DraftReview 组件族到 components/draft/`**

---

## 4. P0-a：compose 自动整篇重试 + 尸体队列

### 4.1 `composeWithRetry` 包装器

新建 `src/lib/compose-with-retry.ts`：

```ts
import { composeDraft } from '@/lib/reference-compose';
import type { AiUsageSummary } from '@/lib/ai-client';
import { resetRecentAiUsage, getRecentAiUsage } from '@/lib/ai-client';

export type ComposeFailureStage = 'core' | 'editorial' | 'audit' | 'unknown';

export interface ComposeFailure {
  stage: ComposeFailureStage;
  message: string;          // 原始错误消息（含 issue code 列表）
  attempts: number;         // 总尝试次数（含首次）
  usage: AiUsageSummary;    // 全部尝试的累计 token
}

export type ComposeOutcome =
  | { ok: true; draft: ReferenceDrivenDraft; attempts: number; usage: AiUsageSummary }
  | { ok: false; failure: ComposeFailure };

export async function composeWithRetry(
  input: Parameters<typeof composeDraft>[0],
  options: { maxAttempts?: number } = {},   // 默认 3（首次 + 2 次整篇重试）
): Promise<ComposeOutcome> {
  const maxAttempts = options.maxAttempts ?? 3;
  let totalUsage: AiUsageSummary = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    resetRecentAiUsage();                    // 前提：串行执行，见 7.1
    try {
      const draft = await composeDraft(input);
      const usage = getRecentAiUsage();
      totalUsage = addUsage(totalUsage, usage);
      return { ok: true, draft, attempts: attempt, usage: totalUsage };
    } catch (cause) {
      const usage = getRecentAiUsage();
      totalUsage = addUsage(totalUsage, usage);
      lastError = cause instanceof Error ? cause : new Error('compose 失败');
      if (!isRetryableComposeError(lastError)) break;  // 4xx/缺key 不重试
    }
  }
  return { ok: false, failure: { stage: classifyComposeError(lastError), message: lastError!.message, attempts: maxAttempts, usage: totalUsage } };
}
```

### 4.2 失败分类与可重试判断（放在 `reference-compose.ts` 导出）

```ts
export function classifyComposeError(error: Error | null): ComposeFailureStage {
  const m = error?.message || '';
  if (m.startsWith('标题或封面返修后仍未达标')) return 'core';
  if (m.startsWith('内页或正文返修后仍未达标')) return 'editorial';
  if (m.startsWith('法语与考试事实审校未通过')) return 'audit';
  return 'unknown';
}

export function isRetryableComposeError(error: Error): boolean {
  const m = error.message;
  if (/请求失败：4\d\d/.test(m)) return false;       // AI API 4xx（鉴权/参数错），重试无意义
  if (m.includes('缺少 OPENAI_API_KEY')) return false;
  return true;                                       // 质量不达标 + 5xx + JSON 修复失败都可重试
}
```

### 4.3 route.ts 的 compose 分支换用包装器（保持单篇 API 契约不变）

```ts
// route.ts POST 内，替换原来的 composeDraft 直调：
const outcome = await composeWithRetry({ productId, card, topic: body.topic, evidence });
if (!outcome.ok) {
  return error(`${outcome.failure.message}（已自动重试${outcome.failure.attempts - 1}次仍失败，阶段：${outcome.failure.stage}）`, 500);
}
return NextResponse.json({ card, draft: outcome.draft, usage: outcome.usage });
```

**注意**：单篇 UI 的错误提示会变长但信息更全，不用改前端（前端只显示 `json.error`）。

**commit 3：`feat: compose 失败自动整篇重试（默认3次）+ 失败阶段分类`**

### 4.5 根治层：确定性容量自动修复 `autoFixCoverCapacity`

**位置**：`reference-compose.ts` 内，`composeDraft` 的每个封面校验点之前调用——即首次 `getCoreIssues` 前 + 每轮 `repairCoreOutput` 之后。相当于在所有 LLM 返修之前先跑一遍「零成本返修」。

**能确定性修的（无内容创造、零风险）**：
1. 每组条数超上限 → **截断**到上限（条目是独立列表项，丢多余的安全）。
2. 分组数超上限 → **末组并入前组**，条数再按规则 1 截断（比直接丢组保留更多内容）。
3. （primary/secondary 超长已由 `clip`/`clipVisual` 处理，不在此列。）

**不能确定性修的（需要创作，留给 LLM 返修/重试）**：
1. 分组数不足（拆组需要新标题，标题是创作）。
2. 每组条数不足（跨组挪条目会破坏主题分组语义）。
3. `minTotalItems` 不足、heading 缺失/重复、占位斜杠。

```ts
// reference-compose.ts 内新增
function autoFixCoverCapacity(
  cover: DenseDirectoryCoverPayload,
  spec: CoverTemplateSpec,
): { cover: DenseDirectoryCoverPayload; fixed: string[] } {
  const flexible = flexibleCapacityFamilies.has(spec.family);
  const maxSections = flexible ? spec.sectionCount + 1 : spec.sectionCount;
  const maxItems = flexible ? spec.itemsPerSection + 2 : spec.itemsPerSection;
  const fixed: string[] = [];
  const sections = cover.sections.map(s => ({ ...s, items: [...s.items] }));

  for (const s of sections) {                       // 规则1：条数超上限截断
    if (s.items.length > maxItems) {
      fixed.push(`分组「${s.heading}」${s.items.length}条→截断为${maxItems}条`);
      s.items = s.items.slice(0, maxItems);
    }
  }
  while (sections.length > maxSections) {           // 规则2：末组并入前组
    const last = sections.pop()!;
    const target = sections[sections.length - 1];
    target.items = [...target.items, ...last.items].slice(0, maxItems);
    fixed.push(`分组超上限，「${last.heading}」并入「${target.heading}」`);
  }
  return { cover: { ...cover, sections }, fixed };
}
```

调用点（`composeDraft` 内，首次校验与每轮 repair 后都要）：

```ts
const autoFixed = autoFixCoverCapacity(normalizedCover, spec);
const coreIssues = getCoreIssues({ titles: normalizedTitles, cover: autoFixed.cover, spec });
// autoFixed.fixed 非空时记入 attempts/日志——benchmark 要靠它统计命中率
```

**执行纪律**：
- **autofix 的最小操作单位是「整条 item」，绝不切割任何一条内容的内部文字**——多余的词/短语条目整条撤掉，留下的每一条都完整无缺。字符级截断只允许走既有 `clip`/`clipVisual`（已在整词边界切，上一轮修过 `distinguées`→`disti` 的 bug），autofix 不得新增任何句中截断逻辑。
- autofix 必须在返修循环的**每一轮**跑（LLM 每轮都可能重新造出超上限结构）。
- `fixed` 记录进 job/attempts 日志。benchmark 看命中率：**若 90% 的超额被 autofix 兜住 → 容量问题基本根治；若失败多为"少给" → autofix 覆盖不到，此时才考虑打补丁式返修（只重生成失败分组），那是下一阶段的事，本次不做。**
- 只做安全的确定性操作（截断/合并），坚决不做需要创作的（拆组/造条目）——这是缺陷 1 的教训在方案内部的贯彻。

**commit 4：`feat: 容量超限确定性自动修复（截断/合并），嵌进返修循环每一轮`**

### 4.4 尸体队列

尸体不落库，**落文件**（本地工具，fs 足够，零依赖）：

- 目录：`xhs-workbench/data/batches/<batchId>/`（加入 `.gitignore`：`data/batches/`）。
- 每个 job 一个 JSON：`jobs/<jobId>.json`。失败的 job 就是尸体，`failure` 字段即尸体信息。不单独搞"尸体表"——**job 状态机本身就是队列**。
- 写入策略：runner 是单写者，直接 `fs.writeFile`（Windows 上避免 `rename` 覆盖的坑）。每次状态变更即时落盘，进程挂了重启能从磁盘恢复现场。

```ts
// src/lib/batch-store.ts
export interface BatchJob {
  id: string;                        // `job_${seq}`，seq 从 1 补零到 3 位
  product_id: ProductId;
  reference_card_id: string;
  topic: MigratedTopic;
  status: 'pending' | 'running' | 'success' | 'failed';
  attempts: number;
  draft?: ReferenceDrivenDraft;      // status=success 时存在
  cover_image_url?: string;          // image_to_image 模板出图后写入
  failure?: ComposeFailure & { stage: ComposeFailureStage | 'topics' | 'image' };
  usage?: AiUsageSummary;
  started_at?: string;               // ISO 8601
  finished_at?: string;
}

export interface Batch {
  id: string;                        // `batch_${Date.now()}`
  product_id: ProductId;
  direction: string;
  created_at: string;
  status: 'planned' | 'running' | 'done';
  jobs: BatchJob[];                  // 摘要（不含 draft），完整 draft 在 job 文件里
}

// 导出函数：createBatch / loadBatch / listBatches / saveJob / loadJob / updateJobStatus
// 全部基于 data/batches/<batchId>/batch.json + jobs/<jobId>.json
```

---

## 5. P0-b：批量模式

### 5.1 API 设计（新建 `src/app/api/batch/route.ts`）

| 请求 | 行为 | 返回 |
|---|---|---|
| `POST { action:'plan', product_id, card_ids: string[], direction?, topics_per_card? }` | 对每张卡调 `generateTopics` 取前 `topics_per_card`（默认 2）个选题，展开成 job 列表，落盘 | `{ batch: Batch }`（全部 job 为 pending） |
| `POST { action:'run', batch_id }` | **立即返回**，后台异步跑 runner（见 5.2） | `{ started: true }` |
| `GET ?batch_id=xxx` | 读 batch.json + 各 job 状态 | `{ batch, jobs: BatchJob[] }` |
| `POST { action:'retry_failed', batch_id }` | 把 failed 的 job 重置为 pending，启动 runner | `{ started: true }` |
| `GET ?list=1` | 列出历史 batch（终审入口） | `{ batches: Batch[] }` |

**去重规则（plan 阶段必须做）**：同一 batch 内，若两个选题的 `topic.topic` 文本完全相同，保留先出现的 job，丢弃后者（LLM 对同方向可能产出雷同选题）。跨 batch 不去重（用户可能刻意重跑）。

### 5.2 批量 runner（新建 `src/lib/batch-runner.ts`）

```ts
// 关键约束：全局同时只允许一个 runner（本地单用户工具，简单可靠）
let activeRunner: string | null = null;   // 正在运行的 batchId

export async function startBatchRunner(batchId: string): Promise<{ started: boolean; reason?: string }> {
  if (activeRunner) return { started: false, reason: `batch ${activeRunner} 正在运行` };
  activeRunner = batchId;
  runBatch(batchId)
    .catch(err => console.error(`batch ${batchId} runner crashed:`, err))
    .finally(() => { activeRunner = null; });
  return { started: true };
}

async function runBatch(batchId: string) {
  const batch = await loadBatch(batchId);
  await updateBatchStatus(batchId, 'running');
  for (const jobMeta of batch.jobs) {
    const job = await loadJob(batchId, jobMeta.id);
    if (job.status !== 'pending') continue;              // 支持断点续跑
    await saveJob(batchId, { ...job, status: 'running', started_at: new Date().toISOString() });

    const card = getCompetitorCreativeCard(job.reference_card_id)!;
    const facts = await loadProductFacts(job.product_id);
    const evidence = retrieveProductFacts(facts, job.topic);
    const outcome = await composeWithRetry({ productId: job.product_id, card, topic: job.topic, evidence });

    if (!outcome.ok) {
      await saveJob(batchId, { ...job, status: 'failed', attempts: outcome.failure.attempts, failure: outcome.failure, usage: outcome.failure.usage, finished_at: new Date().toISOString() });
      continue;                                          // 尸体不阻塞整批
    }

    // image_to_image 模板：服务端出图（第 6 节），出图失败 → 尸体
    const spec = getCoverTemplateSpec(card.renderer_id);
    let coverImageUrl: string | undefined;
    if (spec?.renderMode === 'image_to_image') {
      const imageResult = await generateCoverImageWithRetry(card, outcome.draft.cover);
      if (!imageResult.ok) {
        await saveJob(batchId, { ...job, status: 'failed', attempts: outcome.attempts, failure: { stage: 'image', message: imageResult.error, attempts: 1, usage: outcome.usage }, draft: outcome.draft, usage: outcome.usage, finished_at: new Date().toISOString() });
        continue;
      }
      coverImageUrl = imageResult.url;
    }

    await saveJob(batchId, { ...job, status: 'success', attempts: outcome.attempts, draft: outcome.draft, cover_image_url: coverImageUrl, usage: outcome.usage, finished_at: new Date().toISOString() });
  }
  await updateBatchStatus(batchId, 'done');
}
```

**为什么用 fire-and-forget 而不是让 POST 请求挂着**：Next dev 下 route handler 没有硬超时，但浏览器/客户端 fetch 有；且批量 20 篇 × 每篇 1-5 分钟 = 最长 1 小时以上，必须异步。状态通过 `GET` 轮询（前端每 5s）。

**Next.js 注意点**：
- route 文件顶部加 `export const runtime = 'nodejs'`（fs 写盘需要 node runtime，默认就是，但显式声明防误改）。
- dev 模式热重载会杀掉 runner 进程内循环——改造期间跑批量用 `next dev` 即可，但**改代码触发热重载后记得检查 batch 状态**；job 都已落盘，重跑 `run` 会跳过非 pending，天然断点续传。

**commit 4：`feat: 批量 job 存储（batch-store）+ 批量 runner（串行、断点续跑、尸体落盘）`**
**commit 5：`feat: /api/batch（plan/run/retry_failed/查询）`**

### 5.3 批量页面 `/batch`（新建 `src/app/batch/page.tsx`）

页面四个区块，从上到下：

1. **发起区**：商品下拉、模板多选（15 个卡，checkbox，默认全选 12 个 code/hybrid，3 个文生图单独标"需出图"）、方向输入、每卡选题数（默认 2）、「生成批量计划」按钮。
2. **计划确认区**：plan 返回后列出全部 job（卡名 + 选题一句话），可单个删除（前端删，run 时只跑剩下的——简单做法：前端维护排除列表，run 时传 `exclude_job_ids`）。「开始运行」。
3. **进度区**（run 后 5s 轮询）：进度条 `success+failed / total`、每个 job 一行状态（pending ⏳ / running 🔄 / success ✅ attempts=2 / failed ❌ stage=audit）、实时 token 累计。
4. **成品池 / 尸体池**（tab 切换）：
   - 成品池：复用 3.2 提取的 `DraftReview` 逐个渲染（折叠卡片，默认收起，展开才渲染——**性能关键，20 个 DraftReview 同时挂载会卡**）。文生图模板显示 `cover_image_url` 的 `<img>`。每个成品带「打包下载」按钮（复用 `exportAllAsZip`，从 DOM 节点导出；封面是外链图时走 `downloadImageUrl` 分支，`ExportItem` 已支持 `url`）。
   - 尸体池：每具尸体显示卡名、选题、失败阶段、错误消息（含 issue code）、消耗 token。「一键重试全部尸体」调 `retry_failed`。

**全部成品一键导出**：遍历展开的成品逐个 zip 不现实。务实方案：**逐个点「打包下载」**（每篇一个 zip），页面不做整批导出。别过度设计。

**commit 6：`feat: /batch 批量页（计划/进度/成品池/尸体池）`**

---

## 6. P0-c：文生图服务端化 + 重试

### 6.1 服务端出图函数（新建 `src/lib/cover-image.ts`）

```ts
import { submitImageTask, getImageTask } from '@/lib/image-client';
import { buildReferenceImagePrompt, referenceImageNegativePrompt } from '@/lib/reference-image-prompt';

export async function generateCoverImageWithRetry(
  card: CompetitorCreativeCard,
  cover: DenseDirectoryCoverPayload,
  options: { maxAttempts?: number; pollIntervalMs?: number; maxPolls?: number } = {},
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const maxAttempts = options.maxAttempts ?? 2;
  const prompt = buildReferenceImagePrompt(card, cover);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const task = await submitImageTask({ prompt, negativePrompt: referenceImageNegativePrompt, aspectRatio: '3:4' });
      const final = await pollUntilDone(task.id, options.pollIntervalMs ?? 4000, options.maxPolls ?? 90);
      if (final.status === 'completed' && final.url) return { ok: true, url: final.url };
      // status=failed 或轮询耗尽：换一个新任务重试（zexapi 偶发 502/卡死）
    } catch (cause) {
      if (attempt === maxAttempts) return { ok: false, error: cause instanceof Error ? cause.message : '文生图失败' };
    }
    await sleep(3000 * attempt);   // 线性退避
  }
  return { ok: false, error: '文生图多次尝试后仍失败' };
}
```

### 6.2 单篇 UI 的 `ReferenceImageGenerator` 不改

批量走服务端出图，单篇页维持手动触发（人对文生图文字准确性本来就要目检）。**唯一改动**：把 `ReferenceImageGenerator` 轮询失败后的「重新生成」按钮文案改明确，不动逻辑。

**commit 7：`feat: 文生图服务端出图函数（提交失败/任务失败自动重试2次）`**

---

## 7. 并发与状态陷阱（执行时必须遵守）

### 7.1 严禁 compose 并行

`ai-client.ts` 的 `recentUsage` 是模块级全局可变状态（L22）。并行跑两个 compose 会导致 usage 串账。**runner 串行执行 job（for 循环 await），不做 Promise.all。**

另一个串行理由：DeepSeek 兼容 API 对并发敏感，串行更稳。20 篇 × 平均 2-4 分钟 ≈ 40-80 分钟跑完一批，可接受。

如果未来要加速：先把 usage 统计重构成「`callOpenAICompatibleJson` 返回 `{ result, usage }` 由调用方累计」，再开 concurrency=2。**本次不做。**

### 7.2 `editorialPromise` 并行是既有设计，不要动

`composeDraft` 内 core 和 editorial 是并行的（L123-124），单次 compose 内部就有两个并发 LLM 调用——这在同一 job 内，usage 累计是线性的，没问题。不要"顺手优化"它。

### 7.3 fs 写盘

- 所有 batch 数据在 `data/batches/`，加入 `.gitignore`。
- 单写者直接 `writeFile`，不用 rename。
- `loadProductFacts` 每个 job 都调一次有 IO 浪费，runner 内按 product_id 缓存一次即可（小优化，允许做）。

### 7.4 选题生成也是 LLM 调用

plan 阶段 15 张卡 × 1 次 topics 调用 = 15 次调用串行，约 2-5 分钟。前端要有进度提示（逐张卡显示完成）。不要并行。

---

## 8. Benchmark 先行（用数据决定要不要调 prompt）

新建 `scripts/benchmark-compose.ts`（用 `npx tsx` 跑）：

```ts
// 用法：npx tsx scripts/benchmark-compose.ts <cardId> <n>
// 例：npx tsx scripts/benchmark-compose.ts resource_06_notes_course_offer 20
// 对同一 cardId 跑 n 次「topics 取第1个 + composeWithRetry(maxAttempts=1)」
// 输出：首次成功率、失败阶段分布（core/editorial/audit）、平均 token、平均耗时
// 再跑 maxAttempts=3 对照，输出自动重试后的累计成功率
```

- env 加载：脚本顶部 `import { loadEnvConfig } from '@next/env'; loadEnvConfig(process.cwd());`（Next 自带，零新增依赖）。
- 依赖安装：`npm i -D tsx`（若 package.json 没有）。
- **执行顺序上它在 commit 3 之后跑**：先拿到「自动重试后成功率」的真实数据。若某模板重试后仍 <70%，才回头看它的 prompt/容量规格是否要校准——**只调数据差的模板，不要凭感觉全调**。

**commit 8：`chore: benchmark 脚本（首次成功率/阶段分布/token 成本）`**

---

## 9. 验收标准

| 项 | 标准 | 验证方式 |
|---|---|---|
| 自动重试 | 单篇 compose 失败后错误消息含「已自动重试N次」 | API 直连故意触发失败（或 benchmark 日志） |
| autofix 命中 | benchmark 日志能看到 autofix 修复记录及命中率（判断失败方向分布） | benchmark 脚本输出 |
| 首次成功率 | 20 样本 × 4 个历史失败模板：autofix 后首次成功率 ≥ 65%，重试后累计 ≥ 90% | benchmark 脚本输出 |
| 批量完整性 | 20 个 job 的 batch 无人值守跑完，success+failed=20，无进程崩溃 | `/batch` 页面实测 |
| 断点续跑 | 跑到一半重启 dev server，重新 run 后已 success 的 job 不重跑 | 手动实测 |
| 尸体信息 | 每具尸体有 stage + 完整 issue 列表 + token 消耗 | `/batch` 尸体池目检 |
| 成品可用 | 随机抽 3 个成品走导出，zip 内封面+内页齐全、无裁切 | 浏览器实测 |
| 文生图 | 08/12/13 各跑 2 个 job，出图成功率 ≥ 80%，文字准确 | `/batch` 成品池目检 |
| 回归 | 单篇工作流（首页）行为与改造前一致 | 首页完整走一遍 |
| 类型 | `npx tsc --noEmit -p tsconfig.json` 通过 | 每个 commit 后 |

---

## 10. 执行顺序（严格按序，每步一个 commit）

| # | commit | 内容 | 验证 |
|---|---|---|---|
| 1 | refactor | compose 管线提取到 `lib/reference-compose.ts` | tsc + 单篇流程 |
| 2 | refactor | DraftReview 组件族提取到 `components/draft/` | tsc + 单篇流程 + 导出 |
| 3 | feat | `composeWithRetry` + 失败分类 + route 接入 | tsc + API 直连 |
| 4 | feat | `autoFixCoverCapacity` 嵌进返修循环每一轮 + 命中日志 | tsc + benchmark 小样本 |
| 5 | feat | `batch-store` + `batch-runner` | tsc + 单测式脚本小跑 |
| 6 | feat | `/api/batch` 五个 action | curl/脚本验证 plan+run |
| 7 | feat | `/batch` 页面 | 浏览器实测 20 job 批量 |
| 8 | feat | 文生图服务端化 + 重试 | 批量跑 08/12/13 |
| 9 | chore | benchmark 脚本 + 跑数据出报告 | 报告贴进交接文档 |

做完 commit 3+4 就先跑 benchmark 拿「autofix 命中率 + 重试后成功率」的基线数据；commit 5-8 是批量主体；commit 9 收尾出报告。

---

## 11. 明确不做清单（防止接手 AI 过度设计）

1. **不引入数据库/ORM**——fs JSON 文件足够，本地单用户。
2. **不做并发 compose**——除非先重构 usage 统计，本次不做。
3. **不改 `useAutoFitScale`、InnerPagePreview、封面渲染组件**——版式刚治好，别碰。
4. **不调 prompt**——除非 benchmark 数据显示某模板重试后成功率 <70%，且只调那个模板。
5. **不做整批一键导出**——逐篇 zip 已够用。
6. **不做登录/多用户/部署**——本地工具。
7. **不接 `compatibility_matrix.yml`**——那是 P1，本文档范围外，商品2 接入前另做。
8. **不把 `composeDraft` 内部改成增量修复**——整篇重采样就是当前性价比最高的方案，内部管线保持稳定。

---

## 12. 估算（供主人决策）

- 代码量：新增约 750-950 行（autofix + runner/store/api/page/脚本），搬运约 1300 行（两个提取）。
- token 成本：20 篇批量 ≈ 20 × (60-100k) ≈ 1.2-2M token（含重试，autofix 生效后重试次数会下降），benchmark 另加约 1M。
- 时间：按 commit 顺序，一个熟悉代码库的 AI 约 1-2 个工作日可全部落地 + 实测。
