# XHS 内容工作台 V2 技术架构方案

> 状态：设计基线，尚未实施  
> 目标：在保留现有前台、视觉模板和商品数据的前提下，替换不稳定的内容生成编排核心。  
> 适用商品：`delf_b2_writing`、`tef_tcf_canada`

## 1. 结论

不重写整个项目，不继续给 `reference-compose.ts` 打补丁。

采用“旁路 V2”方案：保留现有视觉层、数据层和批量页面，新建一条窄的生成链路：

```text
选择封面 -> 生成选题 -> 选择选题 -> 生成内容 -> 法语/事实审校 -> 生成标题 -> 分级校验 -> 编译封面 -> 视觉校验 -> 现有渲染器
```

正常每篇笔记调用 3 次文本 AI：选题一次、内容一次、标题一次。只有出现新增法语、考试事实疑点或单条溢出时，才局部增加一次审校或改短调用。任何阶段失败都不得整条重跑。

## 2. 当前架构审计

### 2.1 可以复用的资产

- `ReferenceCoverRenderer.tsx` 及全部代码、混合、图生图模板。
- `cover-template-specs.ts` 已整理的模板身份、渲染模式、语言限制和容量经验。
- `product_facts.json`、`product_facts_tef_tcf.json` 及事实检索逻辑。
- 两个商品各自的身份、范围和考试规则配置。
- 小红书搜索下拉词、75 个标题公式、竞品创作卡。
- `title-usage-store.ts` 的跨批次标题、选题、标签、内页标题历史。
- `batch-store.ts` 的本地 JSON 作业存储和图生图 `task_id` 恢复机制。

### 2.2 当前主要结构问题

1. `reference-compose.ts` 超过五千行，同时拥有内容、标题、封面、正文、标签、审校和兜底的写权限。
2. 标题在核心生成、核心返修、审校后润色、最终保险和 fallback 中被多次改写，责任不唯一。
3. 所有模板最终共用 `DenseDirectoryCoverPayload`，经验长图、痛点金句、词卡和资料目录被强行抽象成同一种数据结构。
4. 模板规格以固定组数和条目数为主，生成内容稍有偏差就触发补写、裁剪或返修。
5. 单条入口与批量入口分别实现选题和证据准备，行为可能漂移。
6. `ai-client.ts` 使用进程全局 usage 状态，批量只能 `CONCURRENCY = 1`。
7. 作业只保存最终 `draft`，缺少选题、内容、标题等阶段产物，无法局部恢复。
8. 批量证据上限为 25，单条默认较少；同一任务在两个入口得到的上下文不完全一致。
9. 未列入 warning/autofix 的校验默认 block，新增规则容易意外炸掉整篇。
10. 商品事实路径为绝对路径，换机器部署容易失败。
11. 旧 `state-machine.ts` 与新 reference workflow 并存，形成两套业务模型。
12. 现有测试主要证明 schema 和接口能走通，不能证明成品具有发布质量。

## 3. 架构原则

### 3.1 单一写入者

| 字段 | 唯一负责人 | 后续是否允许改写 |
|---|---|---|
| 选题、目标用户、主目标 | Topic Stage | 否 |
| 封面语义块、内页、正文、商品承接 | Content Stage | 否 |
| 文字标题、封面标题、副标题 | Title Stage | 否 |
| 分组、取舍、密度档、渲染 payload | Cover Compiler | 只允许结构映射，不允许创作 |
| 标签格式、标点、重复项 | Deterministic Gates | 只允许无语义修改 |

### 3.2 阶段不可变

每个阶段输出独立 artifact，并包含：

- `schema_version`
- `prompt_version`
- `input_hash`
- `created_at`
- `usage`
- `warnings`

下游只能读取上游 artifact，不能直接修改。返修必须生成该阶段的新版本，并使下游 artifact 失效。

### 3.3 AI 与程序的边界

AI 负责语义：选题、内容、标题、必要的局部改写。

程序负责确定性工作：计数、去重、字符限制、证据 ID 校验、完整条目搬移、选择密度档、状态保存和渲染。

程序禁止：编写知识点、补写商品卖点、拼接半句话、为凑数量复制内容。

### 3.4 主目标制

每篇只允许一个 `primary_goal`：

- `search`：搜索与干货优先
- `save`：收藏与资料获得感优先
- `click`：冲突、好奇、情绪优先
- `conversion`：商品展示与购买理由优先

其他目标只需达到合格线，避免一篇同时追求四项最高导致四不像。

## 4. V2 领域模型

### 4.1 TemplateCapability

现有 `CoverTemplateSpec` 升级为能力卡，但保留旧字段兼容渲染器。

```ts
interface TemplateCapability {
  renderer: CreativeCardRenderer;
  family: ContentShape;
  renderMode: 'code' | 'hybrid' | 'image_to_image';
  allowedGoals: PrimaryGoal[];
  forbiddenGoals: PrimaryGoal[];
  acceptedBlockKinds: ContentBlockKind[];
  allowedTitleMechanisms: TitleMechanism[];
  densityTiers: Array<{
    id: 'compact' | 'normal' | 'dense';
    sectionRange: [number, number];
    itemRange: [number, number];
    primaryVisualLength: [number, number];
    secondaryVisualLength: [number, number];
  }>;
  languagePolicy: 'mixed' | 'primary_french';
  compiler: 'directory' | 'pairs' | 'narrative' | 'document' | 'offer';
}
```

容量从“必须 5x5”改为经过视觉验收的 2-3 个密度档。字体不得低于模板已验证的缩略图可读下限。

### 4.2 TopicOption

```ts
interface TopicOption {
  id: string;
  productId: ProductId;
  templateId: CreativeCardRenderer;
  primaryGoal: 'search' | 'save' | 'click' | 'conversion';
  topic: string;
  audienceState: string;
  scene: string;
  painOrDesire: string;
  promise: string;
  contentAngle: string;
  productBridge: string;
  seo: { primary: string; related: string[] };
  knowledgeMode: 'product_grounded' | 'exam_grounded' | 'educational_original' | 'mixed';
  factTerms: string[];
  seedSignals: string[];
  noveltyFingerprint: string;
}
```

seed 只作为 `seedSignals`，不再锁死公开选题文字，也不承担最终知识清单。

### 4.3 ContentPackage

```ts
interface ContentPackage {
  topicSnapshotHash: string;
  coverBlocks: Array<{
    id: string;
    kind: 'group' | 'pair' | 'paragraph' | 'quote' | 'example' | 'step' | 'benefit';
    heading?: string;
    items: Array<{ primary: string; secondary?: string; note?: string }>;
    priority: 1 | 2 | 3;
    sourceMode: 'product_fact' | 'exam_fact' | 'general_advice' | 'ai_example';
    sourceIds: string[];
  }>;
  innerPages: GeneratedInnerPage[];
  captionParts: {
    opening: string;
    value: string[];
    productBridge: string;
    cta: string;
  };
  tagMaterial: string[];
  factualClaims: Array<{
    text: string;
    type: 'product' | 'exam' | 'general_advice' | 'example';
    sourceIds: string[];
  }>;
  frenchSegments: Array<{ path: string; text: string; translation?: string }>;
}
```

内容 AI 输出语义块的候选池，不要求严格等于模板格子数。Cover Compiler 只选择完整块和完整条目。

### 4.4 TitlePackage

```ts
interface TitlePair {
  textTitle: string;
  coverTitle: string;
  coverSubtitle?: string;
  mechanism: TitleMechanism;
  userRelation: string;
  seoKeyword?: string;
  noveltyFingerprint: string;
}

interface TitlePackage {
  contentSnapshotHash: string;
  candidates: TitlePair[];
  selected: TitlePair;
}
```

文字标题与封面标题必须成对生成。文字标题负责搜索和点击，封面标题负责“用户一眼看出和自己有关”。

## 5. 运行流程

### Stage 1：Topic

输入：

- 精简商品 profile，不超过 1200 字符
- 当前 TemplateCapability
- 与模板匹配的 seed 信号，最多 12 条
- 已验证搜索词，最多 12 个
- 最近选题指纹和角度，最多 20 条
- 用户额外方向

一次 AI 调用输出 4 个不同主目标的 TopicOption。程序执行：商品身份检查、模板目标兼容、搜索词相关性、历史指纹去重。单篇由用户选；批量按需求、模板适配、新鲜度、商品承接四项排序。

### Stage 2：Content

输入：

- 已选 TopicOption
- TemplateCapability，但只给内容形态和容量范围
- 精简商品 profile
- 最多 8 条命中事实
- 最近内容角度和承接句摘要，最多 10 条

一次 AI 调用输出 ContentPackage。禁止输入标题公式、完整历史标题、整套知识库和竞品长文。

知识规则：

- 商品库存、数量和能力必须引用 product fact。
- 考试规则、评分、题型和时效事实必须引用 exam fact。
- 学习方法、解释、示例可以原创。
- AI 新写法语和翻译进入 `frenchSegments`，后续条件审校。

### Stage 2.5：French / Fact Audit

审校必须发生在标题生成之前，防止内容审校后标题与正文失配。

- 没有新增法语、翻译、考试规则或商品数量主张时，程序直接跳过，不调用 AI。
- 需要审校时，只传 `frenchSegments`、`factualClaims` 与命中的 source IDs，不传整篇正文。
- 审校只能返回精确 JSON Path 和替换值，例如 `coverBlocks[1].items[2].primary`，禁止重写整个 `ContentPackage`。
- 任一内容路径被修改，旧 `contentSnapshotHash` 失效；尚未生成标题时继续进入 Title，已经存在的 Title artifact 必须自动失效并重新生成。
- 确定的法语错误、翻译错误、商品串线和考试事实错误修复失败才阻断；风格建议只记 warning。

### Stage 3：Title

在内容完全确定后调用。输入：

- TopicOption
- 封面最终采用的内容摘要
- 正文 opening 与 3 个核心干货点
- TemplateCapability 的标题机制
- 1 个主搜索词和少量相关词
- 路由后最匹配的 6-10 个标题公式骨架，不传固定文案例句
- 最近标题文字、句式骨架、情绪机制和核心对象指纹

一次 AI 调用生成 6-8 组 TitlePair。确定性过滤：

- 文字标题按平台规则不超过 20 个可见单位。
- 两个商品身份不得串线。
- 标题承诺必须能在内容中找到支撑。
- 封面标题必须出现用户关系信号、使用场景或明确对象中的至少一项。
- 同批和近期不得命中相同标题指纹或相同“机制+对象+角度”指纹。
- 标题类型必须属于模板允许机制。

交互模式由用户选择。批量模式从过滤后的候选中按自然度、关系感、点击机制、内容兑现和 SEO 五项选择，不单独调用 Judge；只有未来真实数据证明 Judge 有增益时再引入。

### Stage 4：Compile

按模板 family 使用五类编译函数，建议落在现有 `cover-material-adapter.ts`，不新增服务：

- directory：分组目录
- pairs：词汇、短语、词卡、表格
- narrative：经验段落、痛点大字
- document：原句、解释、迁移表达
- offer：资料说明、路线图、公告

编译器按优先级选择完整条目，选择可容纳的 density tier；溢出内容进入内页。内容不足时选择低密度档，不补假内容。单条超长时返回精确路径，允许一次局部改短。

#### 17 个模板迁移契约

下表是开发合同，不允许开发时临场把不同语义重新压成同一种“资料目录”。`ContentPackage` 保留语义块；compiler 只在最后一步映射到当前渲染器仍需的 `DenseDirectoryCoverPayload`。

| renderer | compiler | 接受的 block kind | compact / normal / dense | 旧 payload 映射 |
|---|---|---|---|---|
| `parchment_dense_directory` | directory | group、step、benefit | 4x4 / 5x4 / 5x5 | block.heading→section.heading；items→section.items；分组名→side_label |
| `white_green_directory` | directory | group、step、benefit | 3x4 / 4x4 / 4x5 | 同 directory 标准映射 |
| `clean_purple_directory` | directory | group、step、benefit | 3x6 / 4x7 / 4x9 | 同 directory 标准映射 |
| `grid_purple_directory` | directory | group、step、pair | 3x6 / 4x7 / 4x8 | 同 directory 标准映射，columns 仅由 tier 决定 |
| `blackboard_phrase` | pairs | pair、example | 2x6 / 2x8 / 2x10 | 法语→primary；中文用途→secondary；组名→heading |
| `blackboard_offer` | offer | benefit、group、step | 3x2 / 3x3 / 3x4 | 适合谁/解决什么/包含什么分别成为 section |
| `memo_offer` | offer | benefit、group、step | 3x2 / 4x2 / 4x3 | 人群/场景/内容/用法分别成为备忘录 section |
| `word_flashcard` | pairs | pair | 3x2 / 3x3 / 3x4 | 法语词→primary；中文义→secondary；用法→note |
| `book_cover` | offer | group、benefit、quote | 2x1 / 2x2 / 3x2 | 主题提要→sections；主收益→subtitle |
| `notebook_big_words` | narrative | paragraph、quote、step | 3x1 / 4x1 / 5x1 | 每个完整短句独立为 item，不拆句 |
| `plain_experience` | narrative | paragraph、quote | 2x1 / 3x1 / 4x1 | 每段作为一个完整 item，禁止词条化 |
| `document_analysis` | document | example、pair、group | 2x3 / 3x3 / 3x4 | 原句/翻译或解释/迁移用途按组映射，完整句不截断 |
| `vocab_table` | pairs | pair、group | 4x4 / 5x4 / 5x5 | 法语→primary；中文义→secondary；主题→heading |
| `course_roadmap` | offer | step、benefit | 3x3 / 4x3 / 4x4 | 阶段→heading；目标/任务/检查结果→items |
| `collocation_dense` | pairs | pair、group | 3x6 / 3x8 / 3x10 | 搭配→primary；用途→secondary；核心动词/功能→heading |
| `official_notice` | offer | group、benefit、step | 3x2 / 3x3 / 4x3 | 对象/内容/使用节点→sections；保持公告顺序 |
| `pain_quote_big` | narrative | quote、paragraph | 2x1 / 3x1 / 4x1 | 身份/受挫对象/钩子保持完整成分，按顺序映射 |

统一规则：

1. tier 数值是允许范围上界，不是要求 AI 精确输出的格子数；compiler 根据完整条目数量选择最高可读档。
2. `title`、`subtitle` 只能来自 Title artifact；compiler 无权改写。
3. `section.side_label` 只能来自 block 的短分组标签；不存在时允许留空，不得用“第1组”补位。
4. `source_type/source_ids` 从原 block 原样汇总；程序不得伪造 source ID。
5. 超出当前 tier 的完整 block 按 priority 顺序进入内页；不足时降档，禁止复制、补写、拆半句。
6. 每个 renderer 必须有三档 fixture 截图测试；图生图模板只测 prompt payload 与异步任务恢复，不在迁移期重做视觉风格。

### Stage 5：Validate

规则必须显式登记级别，禁止“未知规则默认 block”。

硬阻断白名单：

- schema 无法解析
- 商品身份串线
- 模板没有任何可渲染内容
- 文字标题候选全部超过 20 单位
- 商品/考试事实缺少有效 source ID
- 法语审校存在确定错误且局部修复失败
- 编译后仍发生遮挡、溢出或低于可读字号

自动修复：

- tag 的 `#`、重复和数量
- 标点、空格、编号
- 完整条目转移到内页
- 候选排序和重复候选删除

提醒：

- SEO 较弱
- 开头未自然出现主词
- 标题钩子一般
- 商品承接偏弱
- 内容密度未达到最高档
- AI 套话嫌疑

提醒不得触发整篇失败。

### Stage 6：Render

复用现有渲染器和图生图异步任务。V2 只输出兼容 payload，不修改视觉实现。图生图提交后继续立即持久化 `task_id`，进程重启后只恢复轮询，不重新扣费提交。

## 6. AI 调用与预算

| 阶段 | 正常调用 | 最大输入 | 最大输出 | 内容失败处理 |
|---|---:|---:|---:|---|
| Topic | 1 | 8k 字符 | 2k tokens | 返回可读错误，不整批重跑 |
| Content | 1 | 12k 字符 | 5k tokens | 只允许 schema 修复，不重新创作 |
| Title | 1 | 6k 字符 | 2k tokens | 淘汰坏候选；全军覆没才重跑本阶段 |
| French/Fact Audit | 条件 0-1 | 6k 字符 | 2k tokens | 只改具体路径 |

正常 3 次，最大 4 次语义调用。网络 5xx/超时重试属于传输重试，但必须使用相同 `idempotency_key`，不能重新生成不同内容。

## 7. 作业状态与恢复

现有 `BatchJob.status` 保持 `pending | running | success | failed` 不变，避免前台、旧批次和导出逻辑断裂；另加 `current_stage`：

```text
planned
topic_ready
topic_selected
content_ready
audited
title_ready
compiled
rendering
```

Job 增加：

```ts
artifacts: {
  topics?: VersionedArtifact<TopicOption[]>;
  selectedTopic?: VersionedArtifact<TopicOption>;
  content?: VersionedArtifact<ContentPackage>;
  titles?: VersionedArtifact<TitlePackage>;
  compiledDraft?: VersionedArtifact<ReferenceDrivenDraft>;
}
current_stage: PipelineStage;
stage_failures: StageFailure[];
pipeline_version: 'v1' | 'v2';
```

重跑某阶段时，只删除该阶段之后的 artifacts。单条和批量入口必须共同调用同一个 `PipelineService`，禁止继续复制业务逻辑。

### 7.1 旧数据兼容

- 读取旧 Job JSON 时，缺少 `pipeline_version` 一律视为 `v1`，缺少 `artifacts/current_stage` 不报错。
- V2 Job 继续写最终 `draft`，供现有前台、导出、`ReferenceCoverRenderer` 和历史脚本读取；`artifacts.compiledDraft.data` 与 `draft` 必须使用同一快照。
- API 继续返回原有 `card/topics/draft/usage/saved_batch_id` 字段，V2 只新增 `pipeline_version/current_stage/artifacts_summary/warnings`，不删除旧字段。
- 已经存在的批次不得原地升级为 V2；V1 重试仍走 V1，V2 重试仍走 V2，同一 Job 禁止混跑。
- 旧 Job 已持久化的 `image_task_id`、`cover_image_url` 和 `failure.stage === 'image'` 恢复规则原样保留；切换 pipeline 不得重新提交已经扣费的图生图任务。
- `batch.json` 和 `job.json` 写入统一改为“同目录临时文件 → fsync/close → rename”，读取到旧 JSON 时不回写，只有状态变化才写新格式。

### 7.2 指纹预占

只在成功后记录历史不足以防止并发任务撞题。V2 在候选确定后使用本地 reservation 文件预占：

- Topic 选中时预占 `topicFingerprint`；Title 选中时预占 `titleFingerprint`。
- reservation 包含 `job_id/product_id/card_id/fingerprint/created_at/expires_at`，默认 30 分钟过期。
- 同一批次和并发 Job 选候选前必须读取有效 reservation；命中则淘汰该候选。
- Job 成功时 reservation 转入 `title-usage-store` 并释放；Job 失败、取消或超过 TTL 时释放。
- reservation 写入与查询使用同一个互斥锁和原子 rename，防止双占。

## 8. AI Gateway 改造

当前全局 `recentUsage` 必须改为每次调用返回 usage：

```ts
interface AiResult<T> {
  data: T;
  usage: AiUsageSummary;
  requestId: string;
}
```

Pipeline 在 job 上累加 usage，不使用全局 reset。完成后批量文本阶段可从并发 1 提升到并发 2；图生图仍使用独立限流。

每次调用记录：stage、product、card、prompt_version、input_hash、耗时、tokens、结果状态。不得默认落盘完整 API key；prompt 调试文件仅保存在明确开启的本地 debug 模式。

### 8.1 usage 迁移清单

V2 新增 `callOpenAICompatibleJsonWithUsage<T>()`，返回 `AiResult<T>`；V1 暂时保留旧函数和全局 usage，直到回滚窗口结束。禁止把两种接口混入同一个 Job。

必须迁移并测试的生产调用方：

- `src/app/api/reference-studio/route.ts`：删除 V2 路径上的 reset/get，直接汇总 PipelineResult.usage。
- `src/app/api/batch/route.ts`：plan 阶段 usage 由 Topic artifact 汇总。
- `src/lib/compose-with-retry.ts`：仅供 V1；V2 不得调用。
- `src/lib/batch-runner.ts`：每个 Job 独立累加 usage；完成迁移后文本并发才允许从 1 调到 2。
- `src/lib/reference-compose.ts`、`src/lib/title-refiner.ts`：仅供 V1；V2 三阶段不得调用。

历史调试脚本 `generate-ai-title-matrix.mts`、`repair-existing-title-matrix.mts` 保持 V1 接口或单独迁移，但不得作为 V2 发布门槛。所有新测试脚本只能读取 `PipelineResult.usage`。

### 8.2 统一可见字数算法

标题、前端提示和后端闸门必须共用唯一实现，不得分别用 `string.length`、正则或估算值：

```ts
export function countVisibleUnits(input: string): number {
  const normalized = input.normalize('NFC').trim();
  return Array.from(
    new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(normalized),
  ).length;
}
```

- 每个汉字、英文字母、数字、全角/半角标点、内部空格各计 1。
- 组合重音字母和 emoji 字素簇按用户看到的一个符号计 1。
- 标题禁止换行；20 字限制统一调用此函数。
- 单元测试至少覆盖中文、`DELF B2`、数字、全半角标点、重音法语和 emoji。

## 9. 数据和部署

移除 `product-facts-loader.ts` 中绝对路径，采用：

1. 环境变量覆盖路径。
2. 未配置时读取项目 `data/products/<productId>/product_facts.json`。
3. 启动时执行 preflight，缺文件直接给中文诊断，不等用户点到中途才失败。

建议配置：

```env
DELF_PRODUCT_FACTS_PATH=
TEF_TCF_PRODUCT_FACTS_PATH=
```

V2 不新增数据库。当前本地单机规模继续使用 JSON 文件，但所有写入保持临时文件加 rename。只有出现多进程部署或远程协作需求时才迁移 SQLite。

## 10. 物理代码边界

最多新增五个 V2 文件：

```text
src/lib/v2/contracts.ts
src/lib/v2/topic-stage.ts
src/lib/v2/content-stage.ts
src/lib/v2/title-stage.ts
src/lib/v2/pipeline.ts
```

复用或小改：

- `cover-template-specs.ts`：加入 capability/density tier。
- `cover-material-adapter.ts`：加入五类 family compiler。
- `ai-client.ts`：usage 请求级化。
- `batch-store.ts`：阶段 artifact。
- `batch-runner.ts`：改为调用 V2 pipeline。
- 两个 API route：只做参数校验和调用 pipeline。

明确禁止：

- 新增第二个巨型 compose 文件。
- 引入消息队列、向量数据库、微服务或通用规则引擎。
- V2 调用 `composeDraft` 后再二次修补。
- 新旧流程在同一个 job 内混跑。

## 11. 迁移策略

使用环境开关：

```env
CONTENT_PIPELINE_VERSION=v1|v2
```

阶段一：只接一个 directory 模板，验证 Topic -> Content -> Title -> Compile 全链路。  
阶段二：接 pairs、narrative、document、offer 各一个代表模板。  
阶段三：两个商品各跑 5 类模板，每类 3 个选题，共 30 篇。  
阶段四：接入剩余 renderer。  
阶段五：V2 达标后前台默认切换，V1 保留一个发布周期后删除。

迁移期间冻结视觉模板，除非验收发现渲染器本身的独立缺陷。

## 12. 测试体系

发布验收分成两套，不能互相替代：

1. **30 篇内容质量集**：验证两个商品、五类语义 compiler 和三种不同选题的内容质量。
2. **17 模板视觉全覆盖集**：每个 renderer 至少 1 篇真实编译产物，并额外用 compact/dense fixture 做容量边界截图。图生图模板必须验证 payload、task_id 持久化和恢复；正式质量测试可先跳过实际扣费生图，但上线前必须逐个完成真实图验收。

### 12.1 合同测试

- 每阶段输入输出可解析。
- 下游无法修改上游 hash。
- 每个字段只有唯一写入者。
- 任一阶段重跑只失效下游。
- 正常调用数不超过 3，条件调用不超过 4。

### 12.2 模板编译测试

- 17 个 renderer 均有 capability 和 compiler。
- 内容少、中、多三档都能选择合法密度。
- 不截半句话、不复制、不造内容。
- 所有 code/hybrid 模板做 1080x1440 和小红书缩略图截图检测。
- 无溢出、遮挡和低于可读字号。

### 12.3 内容黄金样本

建立 30 篇固定验收集：2 商品 x 5 family x 3 选题。每篇人工标注：

- 选题是否值得点
- 标题是否说人话
- 封面是否与用户有关
- 封面、内页、正文是否同一件事
- 是否至少有 3 个可用信息点
- SEO 是否自然
- 商品承接是否合理
- 法语和考试事实是否准确

测试脚本必须产出 HTML、完整 JSON 和缩略图，不能只报告接口 200。

### 12.4 回归门槛

- 视觉硬错误：0/30。
- 商品串线、事实错误、法语确定错误：0/30。
- 标题无需人工重写即可发布：至少 24/30。
- 封面与内容一致：至少 28/30。
- 每篇 3 个以上有效信息点：至少 27/30。
- 平均语义 AI 调用小于等于 3.5。
- 同批标题“机制+对象+角度”明显复读不超过 10%。
- 17 个模板真实 payload 均可编译，code/hybrid 缩略图遮挡、溢出、不可读字号为 0。
- 旧 V1 Job、V2 Job、已有 image task 三类恢复用例全部通过。

## 13. 发布与回滚

- V2 首先只对测试批次开放。
- 每个 job 记录 pipeline version 和所有 prompt version。
- V2 失败可以重新以 V1 创建新 job，但同一 job 不允许混跑。
- 切换默认版本前，保留最近一次通过的生产构建和数据备份。
- 图生图 task id、title usage 和 seed usage 继续兼容旧记录。

## 14. 开发完成定义

以下条件全部满足才叫“开发完成”：

1. 单条和批量共用同一个 V2 Pipeline。
2. 正常路径恰好 3 次文本 AI 调用。
3. 可从任一阶段继续，不整条重跑。
4. 程序没有任何生成知识点或商品卖点的 fallback。
5. 两个商品 30 篇黄金样本达到内容回归门槛。
6. 17 个模板完成逐模板视觉回归，所有 code/hybrid 模板同时通过 compact/dense 容量边界。
7. 前台能查看每阶段产物、中文提醒、token 和耗时。
8. 完整验收 HTML 和缩略图由程序生成并人工看过。
9. V1/V2 可独立切换和回滚，旧 Job 与已扣费 image task 均可恢复。

## 15. 架构决策摘要

- 选择渐进替换，不选择全量重写。
- 选择阶段 artifact，不选择一个巨型 draft 从头改到尾。
- 选择五类编译策略，不选择所有模板共用 DenseDirectory 语义。
- 选择弹性密度档，不选择固定格子硬逼 LLM。
- 选择最多 8 条事实，不选择批量发送知识库。
- 选择局部返修，不选择整条 compose retry。
- 选择人工/确定性候选选择，不默认增加标题 Judge。
- 选择本地 JSON 继续承载单机状态，不提前引入数据库。
