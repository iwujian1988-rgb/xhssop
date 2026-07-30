# 小红书商品笔记智能体完整交接文档

> 最后核对时间：2026-07-27（Asia/Shanghai）
>
> 项目目录：`D:\claude_work\waiyuxhssop\xhs-workbench`
>
> 本文是截至当前的唯一现状文档。`HANDOFF_PRODUCT1.md`、`HANDOFF_PRODUCT1_V2.md`、`HANDOFF_PRODUCT1_V3.md`、`HANDOFF_PRODUCT1_V4.md`只用于追溯历史，不应再被当作当前完成度。
>
> 接手 AI 必须先读完本文，再看代码。尤其不要把“已经接入数据”误判为“已经完成端到端验收”。

### 阅读前先看：停手时的精确状态（2026-07-27最终检查点）

当前正在做商品1/商品2共用流程的“产品提示词隔离”。这不是一个可直接验收的版本，而是**profile已接入半条主链、函数签名尚未收口、当前构建失败**的中间状态。接手者必须先完成P0接线，不要直接启动付费API测试。

- 已新增 `src/lib/product-prompt-profiles.ts`，定义两个商品各自的身份词、禁用身份、选题范围、成稿范围、编辑范围、审校范围、标题示例、SEO、标签和封面兜底标题。
- 已修改 `src/lib/editorial-quality.ts`：标题出现另一商品身份时不再机械替换，而是返回空字符串，等待上游按正确商品语义重建。
- 已把profile接入 `reference-compose.ts` 的 `generateTopics()`、`refineSeededTopics()`、`composeDraft()`核心提示词、`generateEditorialOutput()`、`repairEditorialOutput()`、`repairCoreOutput()`和 `auditEducationalContent()`。
- 已给选题归一化增加产品身份检查与本地种子字段回退，避免AI返回DELF选题后仅把考试名称替换成TEF/TCF。
- **尚未完成**标题候选、封面兜底、内页兜底、核心检查、编辑检查、SEO、考试规则和标签函数的productId参数改造。调用方已经传入 `productId`，这些函数定义仍是旧签名，因此TypeScript当前报错。
- `npm.cmd run test:seed-flow`当前通过：15张卡、60个商品1任务、原始Markdown摘录0；它仍未覆盖商品2。
- `npm.cmd run test:editorial-guards`当前失败：测试仍期待旧的跨商品机械替换，实际新逻辑返回空字符串。应更新测试，不应恢复旧实现。
- `npm.cmd run build`当前失败。编译已完成，TypeScript第一个报错在 `src/lib/reference-compose.ts:463`：`ensureCoverIdentity()`调用传了3个参数，定义仍只接收2个。修完后预计会继续暴露同一批未收口函数的参数错误。
- 此轮文档核对没有进行新的付费API或生图调用，没有新的商品2真实样本可宣称通过。

一句话交接当前位置：**产品隔离已经接入topics/core/editorial/audit，但标题、封面、检查、SEO和标签尚未收口；当前先修构建，再补双商品零成本测试，最后才跑商品2真实样本。**

## 1. 一句话说明这个项目

这是一个本地运行的小红书带货笔记工作台：管理员先选商品和一张竞品参考封面，系统再结合商品定位、用户痛点、真实搜索词、本地知识事实和标题公式，生成相互匹配的选题、笔记标题、封面标题、结构化封面内容、内页、正文、标签及商品承接。

它不是普通知识库问答，也不是“给一个主题让 AI 随便写”。核心目标是稳定生产三类至少命中一类的内容：

1. 有传播力：标题有点击理由，选题命中真实需求。
2. 有干货：封面和内页能让用户直接拿走内容，不是空泛设计说明。
3. 有带货力：商品承接自然、具体、有证据，不编造服务和效果。

## 2. 项目背景与两个商品

### 商品1：DELF B2 法语写作知识库

本地知识库原始目录：

`D:\claude_work\xunixiangmu\deliverables\feishu_pages`

结构化事实文件：

`D:\claude_work\xunixiangmu\deliverables\product_facts.json`

商品内容包括使用路径、20篇范文、DELF B2评分对照、240条词汇、100条句法、50条主题观点、20条组合示例、30条错题对照、36项检查清单和考前速查。

重要边界：商品1只讨论 DELF B2 写作，主要任务是正式信、建议信、投诉/反对信和论坛投稿。不能混入 TEF/TCF、CLB、加拿大移民、口语考试、短信或简讯任务。

### 商品2：TEF/TCF Canada 备考资料包

原始 Markdown 位于：

`D:\claude_work\taolun\法语付费资料`

共12份资料，覆盖：TEF/TCF选择、CLB7自测、写作句型、12类600词、高频写作主题、30天计划、听力、口语、B2-C1范文对比、真实备考故事、30条避坑经验、报名到查分流程。

当前新建的结构化事实文件：

`D:\claude_work\waiyuxhssop\xhs-workbench\data\product_facts_tef_tcf.json`

重要边界：商品2围绕 TEF/TCF Canada、CLB/NCLC、加拿大法语备考和听说读写四科展开。不能被商品1的 DELF B2 写作语境污染。

### 商品知识与公开科普的关系

用户已经明确：不能把创作范围锁死成“商品里有的才能写”。正确规则是：

- 一般法语知识、备考科普、正确例句和练习，知识库没有时允许 AI 原创。
- 只有在声称“资料包包含什么、多少条、什么服务、能解决什么”时，必须由商品事实支撑。
- 公开文案既不要把 AI 原创内容说成商品内容，也不要刻意向用户解释“这部分商品里没有”。
- 商品详情页可以兜底，因此数量和营销表达不必被过度拦截，但不得离谱、虚假或与商品能力冲突。

## 3. 用户真正要的结果与验收口径

接手 AI 必须用“资深小红书运营 + 法语学习者 + 产品经理”的视角验收，不能只看接口是否返回200。

### 内容验收

- 选题要有主流大需求，也要有细分干货，不能全是专家自嗨的小知识点。
- 当前目标是每次返回4个任务：搜索痛点、买点承接、细分干货、知识库宣传。
- 搜索痛点应来自真实搜索建议或高频一级需求，例如模板、范文、题型、格式、评分标准、批改、备考资料，而不是只写“抽象名词搭配”这种低感知细节。
- 知识库宣传不能写成硬广，必须先用小红书式痛点或利益钩子，再展示知识库价值。
- 标题必须像用户会点击的标题，不是开发者给内容起的内部名字。
- 封面标题和笔记文字标题是两个对象：文字标题负责搜索、点击、情绪和信息缺口；封面标题负责在3秒内说明领域、内容对象和资料价值。
- 正文约280-420个中文字符，图片已经承担干货，正文不应重复塞满全部内容。
- 正文要自然包含核心关键词与 `#` 标签，但不能堆砌。
- 禁止明显 AI 腔，如高频“不是……而是……”“很多同学”“问题的关键”“其实”等模板化句式。

### 法语与事实验收

- 法语例句、短语、拼写、变位、搭配、语域和中文释义必须准确。
- 不把 `mais`、`on`、`je pense que` 等本来正确的表达机械判成错误、口语或低级表达。
- 不把不同语义的连接词包装成可机械替换。
- 不虚构 DELF/TEF 官方评分规则、固定分钟数、必须使用的句法数量或提分承诺。
- 教研校验只是兜底，不应成为昂贵的“重写整篇”系统；用户只要求重点保证法语例句和释义准确。

### 视觉验收

- 竞品参考图不是灵感板，而是视觉骨架：布局、信息密度、质感、字体层级和第一眼气质要接近。
- 不能为了“复刻”死抄原图每一行，也不能放开 AI 重画成完全不同的新图。
- 资料型封面需要足够高的信息密度和知识库厚重感。
- 文字不能遮挡、串行、错位、超出画布或小到无法在小红书信息流阅读。
- 圆点、线条、标签和文字必须属于同一排版单元，不能分别绝对定位后靠肉眼对齐。
- 当前已确认暂停继续抠模板细节，先把内容链路走通。后续排版必须做“约束式自适应”，不能继续固定 CSS 硬塞动态文字。

### 沟通偏好

- 用户喜欢简洁、口语、直接的回复。
- 不要用技术完成度代替最终效果。
- 在给用户验收前，AI必须自己先看输出，发现明显错位、标题平淡、内容错误时继续修，不要把半成品推给用户。
- 用户不需要捧哏，需要客观判断、主动指出风险并做决定。

## 4. 当前确定的整体设计

主链路是：

`选择商品和竞品创作卡 -> 兼容种子 -> AI具体化4个选题 -> 本地事实检索 -> 统一任务单 -> 文字标题候选 -> 封面标题与结构化封面内容 -> 内页与正文 -> 法语准确性审校 -> 分层检查 -> 保存草稿`

### 4.1 竞品创作卡

竞品图片已经提前分析成 `CompetitorCreativeCard`，包含：

- 内容机制
- 点击机制
- 视觉机制
- 适合的人群和痛点
- 所需字段
- 禁止用途
- 信息密度
- 对应渲染器

因此运行时不需要每次重新 OCR 和重新分析竞品。用户选中某张封面后，系统从这张卡反向决定内容形态。这是当前方案相对旧版“先随便想内容再硬匹配封面”的核心改进。

### 4.2 种子

种子不是最终标题，也不是一篇固定文章。它是一张预置用户故事卡，负责限定：

- 商品
- 一级选题方向
- 目标人群
- 用户痛点和需求
- 付费触发点
- 使用场景
- 可兼容的封面内容形态
- 关键事实ID和动态检索词
- AI可以原创到什么程度
- 可用的标题心理触发器
- 内页展开计划

一颗种子可以每天结合不同封面、检索证据、标题触发器和表达方式生成不同内容，不等于“一个种子只能生成一篇笔记”。

### 4.3 四类选题

当前每次计划4个任务：

1. `search_pain`：真实搜索痛点，必须是大量用户立即理解的一级问题。
2. `selling_point`：从用户需求切入商品买点，不能直接报商品目录。
3. `narrow_knowledge`：细分知识点或具体任务，允许更专业。
4. `product_showcase`：单独宣传知识库本身，但标题和内容仍先从痛点或价值进入。

前两个和第四个默认标记为 `broad`，第三个为 `narrow`。封面内容形态必须与竞品卡一致，例如短语表只能匹配能产出法中短语对的种子，路线图只能匹配有阶段路径的种子。

### 4.4 本地事实检索

选题确认后，系统只检索结构化事实卡，不再把约1.2万字原始 Markdown 每次重复发给模型。

事实分为锚点和动态召回：

- 锚点来自种子的 `anchor_fact_ids`，确保商品、人群、痛点和核心能力不漂移。
- 动态召回根据本次选题和 `search_terms` 补充最相关事实。
- 当前测试确认生成提示词中的原始 Markdown 摘录数为0。

这既减少 token，也避免大段原文分散模型注意力。

### 4.5 标题系统

75个爆款公式仍然保留，但定位已经修正：它们不是填空模板，而是心理触发机制候选。

当前标题候选至少混合：

- 资料型
- 解释型
- 强钩子/认知冲突
- 竞品点击机制迁移
- 自由原创
- 75公式中与本次内容匹配的一条

公式要先按选题和封面家族路由到5-8个合适候选，再让 AI 仿写。不能把75个全部塞给 AI，也不能为了套公式把选题写歪。

封面标题不套75公式。封面标题根据封面角色单独生成，例如资料目录型应直接告诉用户“这张图里有什么”，情绪型封面才允许更强的痛点表达。

### 4.6 封面与内页

AI先输出统一的结构化封面内容：标题、副标题、分组、条目、法中释义、来源类型和来源ID。模板只负责渲染这些数据。

封面只放短条目，长解释、完整例句、选择条件和练习进入内页。不能再为了满足高密度把长句硬塞封面。

内页是独立内容产品，不是把正文切成几张图。当前要求4-6页，每页包含具体知识、例子、对照、步骤或练习，最后自然承接商品。

### 4.7 检查分层

用户明确要求不能所有问题都阻塞。当前代码分三层：

- `warn`：提醒但允许成稿，例如核心关键词未出现在正文开头、AI腔、商品数量缺少证据、过度绝对化、知识库宣传表达等。
- `autofix`：可确定性修复的问题，例如把中性法语误判成口语、机械替换、部分语域绝对化。
- `block`：真正会导致不可用的结构或事实错误，例如模板容量错误、来源ID错配、必要法中字段缺失、法语硬错误、虚构服务等。

界面已经将检查代码翻译为中文含义，用户不应再直接看到 `core_keyword_missing_from_opening` 之类的内部代码。

## 5. 现有封面模板资产

目前有15张受支持的竞品创作卡：

| 编号 | 竞品卡 | family | 当前实现模式 |
|---|---|---|---|
| 01 | 羊皮纸语法体系大目录 | directory | code |
| 02 | 白底绿字语法清单 | directory | code |
| 03 | 黑板大字课程招募 | offer | hybrid |
| 04 | 黑板短语密集表 | phrase | hybrid |
| 05 | 白底紫色语法资料 | directory | code |
| 06 | 备忘录课程说明页 | offer | code |
| 07 | 疑问词大字卡片 | flashcard | hybrid |
| 08 | 法语教材封面风 | book | image_to_image |
| 09 | 手写本警告首图 | pain | hybrid |
| 10 | 极简真人经验正文 | experience | code |
| 11 | DELF素材文档解析 | document | hybrid |
| 12 | 主题词汇表大字压屏 | table | image_to_image |
| 13 | 蓝色课程规划信息图 | roadmap | image_to_image |
| 14 | 高频固定搭配密集表 | phrase | image_to_image |
| 15 | 网格纸紫色语法体系 | directory | code |

实现模式含义：

- `code`：程序精排，适合规则明确、文字是主体的资料页。
- `hybrid`：真实或AI生成底图 + 程序排字，适合黑板、手写本、词卡、文档批改等质感背景。
- `image_to_image`：参考图驱动的图生图，适合教材封面、词汇压屏、路线信息图和复杂密表。

重要：这个模式表是当前代码状态，不等于视觉质量全部通过。用户已经多次指出折行、遮挡、字号、字体和对齐问题。模板视觉目前只算“有资产、有渲染器、有部分可用样式”，不能写成“15个模板均已生产级”。

## 6. 7月25日前已经提交的基线

Git里已经提交的最后基线是 `6890932`（2026-07-25 14:44）。主要完成：

- 单篇生成链路抽离到 `reference-compose.ts`。
- 失败自动重试、失败阶段分类和 token 回传。
- 批量工作台、任务落盘、尸体池、重试和基本断点续跑。
- 容量超限的确定性自动修复。
- 文生图链路和内部ID清洗。
- 20-job混合批量实测：18/20成功，旧基线累计631,517 token，约40分钟。
- image_to_image小样和批量样本成功出图。
- autofix命中率被量化。

旧 V4 中仍记录两个历史风险：服务中断后 `running` 任务可能成为孤儿；`resource_05` 在旧版20-job测试中连续失败。当前这两项是否已被后续未提交改动完全消除，不能仅凭旧文档下结论，需要专门复测。

## 7. 7月26日完成的工作（当前仍主要在未提交工作树）

根据文件时间、结果文件和当前代码，7月26日主要做了：

1. 建立种子架构和种子使用历史，开始从“固定任务”改为“种子限定 + AI具体化”。
2. 为每个模板家族增加内容契约，规定分组、条目、字段、信息密度和禁止用途。
3. 引入精确事实检索，删除生成提示词中重复发送的大段原始 Markdown。
4. 将单篇生成拆为核心层（任务单、标题、封面）和编辑层（内页、正文、标签）。
5. 增加种子端到端测试脚本，并连续生成多批真实样本。
6. 开始限制整条流程无意义重跑，把可以内部修复的问题留在当前阶段处理。
7. 记录设计决策：模板暂缓继续微调，后续采用约束式自适应排版。

当日的问题也很明确：早期校验过严，失败会导致整条流程重跑，多次调用曾把单篇推到约12万 token；教研提示词也一度过重。后续代码已改为分层校验和更小的事实上下文，但仍需继续压缩调用次数。

## 8. 7月27日完成的工作（当前仍主要在未提交工作树）

### 8.1 选题与种子

- 将“选择内容任务”从纯本地固定排序改为：本地种子先限定范围，AI再结合当前封面具体化。
- 从3个选题扩展到4个：搜索痛点、买点承接、细分干货、知识库宣传。
- 明确前两个和知识库宣传必须是主流大需求，第三个才允许细分。
- 加入种子去重历史，成功生成后记录使用，降低连续重复。
- 商品1种子已覆盖正式信开头结尾、交卷前检查、错误改写、评分维度、观点库、范文迁移、表达组织等方向。

### 8.2 搜索词与标题

- 将用户提供的小红书搜索下拉截图整理为商品1关键词组：模板、范文、题型、格式、评分标准、批改、备考资料、备考攻略等。
- 标题生成改为多路候选，不再只有“XXX？YYY”一种句式。
- 明确提供资料型、解释型和强钩子型选择，同时保留竞品机制迁移、自由原创和75公式。
- 加入标题自然度、点击力、内容承诺和数量一致性检查。

### 8.3 内容质量与校验

- 把 `caption_ai_cliche`、`core_keyword_missing_from_opening`、商品数量缺证据等问题从一律阻塞改成提醒。
- 加入中性法语误判、机械替换、绝对语域规则、虚构考试数量等检测。
- 引入法语词典硬校验，用于发现可能缺空格拼接或截断的词；普通“词典未收录”仅提醒，不阻塞。
- 教研审校当前聚焦法语例句、短语、拼写、变位、搭配、语域、中文释义和少数明确考试事实。
- 正文目标调整为280-420字，内页4-6张，标签和SEO关键词自动生成。

### 8.4 商品2基础接入

- 新建 `data/product_facts_tef_tcf.json`，含7类结构化事实。
- `product-facts-loader.ts` 已支持两个商品。
- `editorial-seed-library.ts` 新增12颗商品2种子。
- 商品2种子覆盖：选考、CLB7自测、30天计划、写作句型、主题词汇、真题主题、听力、口语、B2-C1对比、考试流程、避坑、知识库宣传。
- 为商品2增加独立的四类种子池。
- 首页和批量页的商品2选项已启用。
- 增加商品2临时搜索词，但它们来自商品资料推断，不是用户实测的小红书下拉词。

### 8.5 7月27日停手前刚开始的P0改造

- 新增 `src/lib/product-prompt-profiles.ts`，实际接口名为 `ProductPromptProfile`。
- 商品1 profile要求DELF B2/法语B2写作身份，禁止TEF/TCF/CLB/NCLC/加拿大移民语境。
- 商品2 profile要求TEF/TCF/CLB/NCLC/加拿大法语身份，禁止DELF/DALF。
- 两个profile都包含topics、content、editorial、audit四段独立提示词，以及考试事实规则、SEO关键词、标签身份和不同内容形态的封面兜底标题。
- 新增本地函数：`getProductPromptProfile()`、`hasRequiredProductIdentity()`、`hasForbiddenProductIdentity()`、`isProductPublicTextSafe()`、`getProductCoverFallbackTitle()`。
- `editorial-quality.ts`已改为：发现跨商品身份直接返回空标题，不再把考试名做字符串替换。
- `reference-compose.ts`已完成第一批接线：topics、core提示词、editorial提示词、repair提示词和audit提示词均开始读取profile。
- 选题返回值新增产品安全归一化：选题本身必须带当前商品身份；人群、场景、痛点、承诺、理由、搜索词不得含另一商品身份；不安全字段回退到本地种子。
- 这一步停在“调用方先传productId、底层辅助函数还没全部改签名”的中间态。因此它不是可构建版本，更不是商品2完成版。
- 尚待改造的函数集中在：`ensureTitleCandidateMix()`、`buildSeedTitleFallbacks()`、`buildStrongTitleCandidates()`、`buildTitleChoiceCandidates()`、`ensureMinimumInnerPages()`、`ensureCoverIdentity()`、`getCoreIssues()`、`getEditorialIssues()`、`buildSeoKeywords()`、`getExamFactRules()`、`normalizeTags()`。

## 9. 当前真实完成度

### 已经可认为完成或基本稳定

- P0接线前的项目基线曾能构建；当前中间态不能构建，见第18节。
- 商品1的种子、结构化事实、模板兼容、标题路由、正文/内页生成和检查链路在上一可构建版本已经贯通；本次产品隔离改造完成后必须做回归，不能假定商品1没有被影响。
- 15张竞品卡都能在本地计划出兼容内容任务。
- 大段原始 Markdown 不再重复进入生成提示词。
- 标题、正文、封面、内页和检查结果能保存到单篇批次。
- token用量会在前台显示，失败样本也能记录真实消耗。
- 校验已经区分提醒、自动修复和阻塞。

### 已接入但不能宣布完成

- 商品2的数据、种子、UI入口已经接入。
- 商品2本地种子规划能覆盖大部分模板家族。
- 但商品2尚未通过完整的真实AI端到端验收。

### 明确未完成

1. 商品2的产品专属提示词配置已经接入topics/core/editorial/audit，但标题候选、封面、检查、SEO、标签和内页兜底尚未完成；全链路身份保护仍未闭环。
2. 商品2真实 `topics` 调用已经暴露 DELF B2 污染，必须修。
3. 商品2尚未按 code/hybrid/image_to_image 各跑至少一条完整笔记。
4. 商品2搜索建议尚未由用户在小红书实测。
5. 当前 `test:seed-flow` 只测试商品1，未覆盖商品2；`test:editorial-guards`还未同步新的“拒绝串线而非机械替换”语义，目前会失败；`next build`因辅助函数签名未收口而失败。
6. 前台按钮写“生成3个新选题”，实际上返回4个，文案未同步。
7. 15个模板并非都通过视觉验收；动态排版的折行、遮挡、字号和对齐问题仍存在。
8. 约束式自适应排版只写入 `DESIGN_DECISIONS.md`，尚未编码。
9. 商品2使用相同的封面卡时，部分卡名仍带“DELF”，只是内部/管理员显示问题，后续应按商品动态显示或改为中性名称。
10. 当前大量7月26-27改动尚未提交，不能直接大范围重构或回滚。已跟踪文件约有1800行新增改动，另有大量新文件、真实样本、日志和临时截图。

## 10. 商品2当前最关键的真实缺陷

已对商品2真实调用：

`POST /api/reference-studio`，`action=topics`，商品为 `tef_tcf_canada`，参考卡为羊皮纸目录。

结果约27秒，1次AI调用，约3031 token，但AI把多个商品2选题写成了 DELF B2。

根因不是种子错，而是共享提示词仍有明显商品1偏置：

- 原始 `refineSeededTopics()`只要求出现任一法语考试身份，没有对商品2禁止 DELF/DALF。当前已开始用profile修复，并对不安全字段回退本地种子，但尚未做商品2真实复测。
- 原始 `composeDraft()`含大量 DELF B2 写作专属示例和规则。当前核心、编辑、修复和审校提示词已注入商品profile，但下游标题/封面/标签仍可重新带回商品1默认值。
- 标题候选、封面兜底、内页兜底、核心/编辑检查、SEO、考试规则和标签函数仍有商品1默认值或旧签名。
- `normalizeTitleIdentity()`已经改为发现跨商品身份就返回空字符串，不再机械替换。这一方向正确，但调用方必须提供产品正确的候选或兜底，否则可能得到空标题。

## 11. 下一位 AI 必须继续完成的 P0 改造

不要立即重写整个工作流。先加轻量但完整的产品提示词配置与身份保护。

### 11.1 产品提示词配置已建好，不要重复创建

已有文件：`src/lib/product-prompt-profiles.ts`。实际接口如下，不要再平行创建第二套profile：

```ts
interface ProductPromptProfile {
  productId: ProductId;
  adminName: string;
  noteIdentity: string;
  shortIdentity: string;
  requiredIdentityPattern: RegExp;
  forbiddenIdentityPattern: RegExp;
  topicScopePrompt: string;
  contentScopePrompt: string;
  editorialScopePrompt: string;
  auditScopePrompt: string;
  titleExamples: string[];
  examFactRules: string;
  seoKeywords: string[];
  tagIdentity: string;
  coverFallbackTitles: Partial<Record<ContentShape, string>>;
}
```

商品1配置：

- 允许 DELF B2、法语B2写作。
- 禁止 TEF、TCF、CLB、NCLC、加拿大移民。
- 范围只含 DELF B2 写作任务。

商品2配置：

- 允许 TEF Canada、TCF Canada、TEF/TCF、CLB/NCLC、加拿大法语备考。
- 禁止 DELF、DALF、DELF B2。
- 范围包含选考、四科、CLB7、30天计划、流程和资料使用。

以下位置已读取现有profile，不要重复接线：

- `refineSeededTopics()`
- `generateTopics()`
- `composeDraft()`核心提示词
- `generateEditorialOutput()`
- `repairEditorialOutput()`
- `repairCoreOutput()`
- `auditEducationalContent()`

以下位置仍未收口，是下一位AI应继续的准确范围：

- `ensureTitleCandidateMix()`及三个标题fallback/choice函数：显式接收productId，为商品2提供TEF/TCF语义候选，不能用`B2`猜成DELF。
- `ensureCoverIdentity()`：显式接收productId，发现禁用身份时使用 `getProductCoverFallbackTitle()`。
- `ensureMinimumInnerPages()`：内页兜底身份来自profile，不能硬编码“法语B2写作”。
- `getCoreIssues()`与`getEditorialIssues()`：公开文本跨商品身份必须block；缺少身份根据字段角色判断，不能要求每个bullet都重复考试名。
- `buildSeoKeywords()`、`getExamFactRules()`、`normalizeTags()`：直接读取profile中的SEO、考试规则与标签身份。
- `normalizeTitles()`及少数默认标题：不得用共享正则和DELF默认值猜产品。

用以下命令定位尚未清理的商品硬编码：

```powershell
rg -n "DELF|TEF|TCF|CLB|NCLC|法语B2写作" src/lib/reference-compose.ts
```

停手时的关键热点包括：内页兜底约1024行、标题候选约1274-1520行、封面身份约1708行、核心检查约1769行、编辑检查约1865行、SEO/考试规则/标签约1931行以后。行号会随修改漂移，以函数名和搜索结果为准。

### 11.2 增加模型输出后的身份守卫

选题阶段：

- 商品2结果中出现 DELF/DALF，或完全没有 TEF/TCF/CLB/NCLC/加拿大法语身份时，不能做字符串替换。
- 直接回退到对应的原始 `seededTopic`，保留已经验证的人群、痛点和知识范围。
- 商品1出现 TEF/TCF/CLB/NCLC 同理回退。

成稿阶段：

- 标题、封面、内页、正文任一公开字段出现另一商品身份，应进入一次定向修复。
- 修复后仍出现则阻塞，因为这是明确错配，不应只是提醒。
- 修复只能重写受污染字段，不能整篇重新跑两遍。

推荐的最小实现顺序：

1. `refineSeededTopics()`读取profile，用 `topicScopePrompt`替换共享身份说明。
2. AI选题返回后，topic若含禁用身份或缺少必需身份，直接回退同索引的本地seed topic；audience/pain等字段只检查禁用身份，不强迫每个字段重复考试名。
3. `composeDraft()`、编辑层和审校层分别注入 `contentScopePrompt`、`editorialScopePrompt`、`auditScopePrompt`。
4. 标题候选与封面兜底显式接收 `productId`，禁止再从coverTitle猜商品。
5. 最终检查把跨商品身份设为block，但只允许一次字段级定向修复。
6. SEO和标签从profile读取；商品2标签不能再只用一个泛化的`TCF`兜底。

### 11.3 不要做的错误修法

- 不要把所有 `DELF B2`机械替换成 `TEF/TCF`。
- 不要为商品2复制整份2300行 `reference-compose.ts`。
- 不要把两个商品的所有规则同时塞进同一个system prompt。
- 不要重新发送12篇商品2 Markdown给模型。
- 不要为了防错配增加十几个新AI校验调用。

## 12. P0完成后的测试顺序

### 第一步：零API成本

扩展 `scripts/test-seed-flow.mts`：

- 同时遍历两个商品。
- 每个受支持竞品卡都至少得到兼容选题。
- 商品1所有选题不得含 TEF/TCF/CLB/NCLC。
- 商品2所有选题不得含 DELF/DALF。
- 锚点事实必须存在。
- 仍确保原始Markdown摘录为0。

预期是2个商品 × 15张卡 × 每卡最多4个任务。个别高度专用模板如果只能得到3个，不要为了凑数错配，测试应按模板兼容现实定义最小数量。

### 第二步：低成本真实topics测试

商品2至少测3张卡：

1. 羊皮纸目录：验证高密度资料选题。
2. 黑板/备忘录方案说明：验证买点和知识库宣传。
3. 路线图：验证TEF/TCF选择、CLB7或30天计划。

每张看4个选题是否满足：身份正确、1个搜索痛点、1个买点、1个细分、1个知识库宣传，且没有DELFB2语义。

### 第三步：完整compose测试

商品2至少跑3条：

- 1个 `code`
- 1个 `hybrid`
- 1个 `image_to_image`

不要先跑15张全部模板。先看内容质量和身份保护是否成立，再扩大样本。

每条都人工检查：

- 文字标题是否有小红书点击理由。
- 封面标题是否一眼知道TEF/TCF/CLB主题。
- 封面内容与模板结构是否匹配。
- 法语和中文释义是否准确。
- 内页是否真的展开而非重复正文。
- 正文是否280-420字、有关键词、有标签、有自然商品承接。
- 是否出现不存在的商品服务、数量和结果承诺。

## 13. 模板排版后续方案（已确认，当前不要抢跑）

用户已经否定“要求LLM严格多写少写来适应模板”。后续应实现约束式自适应：

1. 每个模板准备宽松、标准、密集布局，必要时有单列、双列、三列变体。
2. 字体加载完成后实际测量文本宽高。
3. 用二分搜索寻找模板允许范围内的最大字号。
4. 圆点、线条、标签和文字用同一 `flex/grid` 布局单元流式排版。
5. 检查溢出、裁切、遮挡、重叠、安全边距和最小字号。
6. 放不下时按内容优先级把长解释和低优先项移到内页，不无限缩小。
7. 多个合法布局中选择字号最大、密度最接近参考图的一版。

模板内容契约仍有价值，但只能定义字段语义和优先级，不能假设LLM永远精确返回固定条数。

## 14. Token、调用次数与性能现状

历史最差情况：校验失败后整条流程重跑两遍，合计约10次AI调用，单篇接近12万token。主因是：大段知识库原文重复发送、每层失败触发整篇重跑、教研校验过重。

当前改进：

- 只发送结构化事实卡，不发送原始Markdown全文。
- 提示词静态段前置，尝试利用DeepSeek前缀缓存。
- 选题单独约1次调用。
- 成稿通常是核心内容1次、内页正文1次、法语审校1次；遇到硬错误再局部返修。
- 最新同一模板的三次商品1真实样本，单篇约16,607、17,454、21,327 token，调用3-4次，正文315-337字。

这已经比12万明显下降，但仍不是最终最省方案。下一步优化顺序：

1. 产品身份守卫用本地代码，不新增AI调用。
2. 审校只检查法语/释义和明确考试事实。
3. 只有确定错误才局部修正；warning不得触发重跑。
4. 记录每阶段token，定位是core、editorial还是audit最贵。
5. 不要在尚未验证商品2内容质量前跑大批量。

## 15. 当前检查规则的实际分层

### 提醒，不阻塞

- 核心关键词没有出现在正文前100字。
- 正文有AI套话。
- 商品数量缺少当前证据。
- 公开规则过度绝对。
- 固定分钟建议缺少依据。
- 机械化学习方法表达。
- 公开文案声称资料中包含某内容。
- 标题候选混合不完整。
- 封面内容存在一定重复。

### 自动修复后再检查

- 把中性法语误判为口语/错误。
- 机械地用一个法语词替换另一个。
- 对语域作绝对化判断。

### 当前阻塞

- 封面分组/容量/密度仍不满足模板要求。
- 封面条目过长。
- 封面缺少法语领域身份。
- 标题/副标题数量与实际内容不一致。
- 来源ID与本次检索证据不匹配。
- 短语、词卡、文档等模板缺少必要法中字段。
- 虚构服务、第一人称经历或官方真题。
- 内页页数/内容过薄/来源错配。
- 审校发现确定的法语硬错误且没有成功修正。

注意：当前容量结构仍偏严格，后续约束式自适应完成后，应把“精确条数”从硬规则改为模板可接受区间和视觉测量结果。

## 16. 关键代码地图

### 主流程

- `src/app/page.tsx`：前台单篇工作台。
- `src/app/api/reference-studio/route.ts`：topics/compose入口、商品加载、证据检索、保存。
- `src/lib/reference-compose.ts`：选题具体化、核心内容、标题、封面、内页、正文、审校、修复和最终检查。当前最大、最需要谨慎改的文件。
- `src/lib/compose-with-retry.ts`：整篇重试和失败阶段分类。

### 商品、种子和检索

- `src/lib/product-prompt-profiles.ts`：两个商品的独立身份、范围、审校、SEO、标签和封面兜底配置。文件已存在，但主流程尚未接完。
- `src/lib/editorial-seed-library.ts`：两个商品的种子、模板兼容、四类选题池。
- `src/lib/seed-usage-store.ts`：近期种子使用历史。
- `src/lib/product-facts-loader.ts`：两个商品事实路径。
- `src/lib/product-fact-retrieval.ts`：锚点和动态事实召回。
- `data/product_facts_tef_tcf.json`：商品2结构化事实。
- `src/lib/xhs-search-keywords.ts`：商品搜索建议词。

### 标题和质量

- `src/lib/full-title-formula-catalog.ts`：75公式和按内容/模板路由。
- `src/lib/editorial-quality.ts`：标题身份规范、公开内容风险规则、商品数量检查。
- `src/lib/reference-workflow-validation.ts`：最终结构、一致性和证据检查。
- `src/lib/french-spellcheck.ts`：法语词典校验。

### 封面

- `src/lib/creative-card-library.ts`：竞品创作卡。
- `src/lib/cover-template-specs.ts`：模板内容契约和renderMode。
- `src/lib/reference-image-prompt.ts`：图生图提示词与内部ID清洗。
- `src/components/templates/`：程序渲染模板。
- `src/components/draft/DraftReview.tsx`：成稿、封面、内页、正文和中文检查提示展示。

### 批量与测试

- `src/app/batch/page.tsx`、`src/app/api/batch/route.ts`
- `src/lib/batch-runner.ts`、`src/lib/batch-store.ts`
- `scripts/test-seed-flow.mts`
- `scripts/test-editorial-guards.mts`
- `scripts/test-seeded-e2e.mts`

## 17. 当前运行方式

```powershell
Set-Location "D:\claude_work\waiyuxhssop\xhs-workbench"
npm.cmd run dev
```

默认页面：

- 单篇工作台：`http://localhost:4000/`
- 批量工作台：`http://localhost:4000/batch`
- 模板总览：`http://localhost:4000/template-matrix`

本地代理脚本默认使用 `http://127.0.0.1:7897`，可通过 `LOCAL_HTTP_PROXY`覆盖。

环境变量名称：

- `OPENAI_API_KEY`
- `OPENAI_MODEL`，默认 `deepseek-v4-pro`
- `OPENAI_BASE_URL`
- `IMAGE_API_KEY`
- `IMAGE_API_MODEL`，默认 `gpt-image-2`
- `IMAGE_API_BASE_URL`，默认 `https://zexapi.com`

密钥已经配置在本地 `.env.local`，本文故意不记录任何密钥。不要把聊天中出现过的密钥复制进代码或交接文档；如果文档要发给外部人员，应先轮换密钥。

## 18. 当前验证结果

最初编写本文时三项都曾通过；停手前引入新身份守卫后，又重新核对了一次。**以下才是此刻状态：**

```powershell
npm.cmd run test:seed-flow
npm.cmd run test:editorial-guards
npm.cmd run build
```

结果：

- `test:seed-flow`通过：15张受支持卡、60个商品1任务、原始Markdown摘录0。
- `test:editorial-guards`失败：旧测试期待把跨商品标题机械替换成当前商品标题，实际新逻辑已经返回空字符串。应更新测试，不应恢复旧实现。
- `next build`失败：编译阶段通过，TypeScript检查失败。第一个错误是 `src/lib/reference-compose.ts:463` 调用 `ensureCoverIdentity(..., productId)`时传入3个参数，但函数定义仍只接收2个。后面同类函数很可能会依次报错，必须一次性完成第11节列出的签名收口。
- 构建同时仍有1个非阻塞警告：`product-facts-loader.ts`读取绝对文件路径，Turbopack NFT追踪认为可能扩大到整个项目。它不是本次build失败原因；当前本地可运行方案保留，正式部署前再处理路径。

失败断言的精确位置：`scripts/test-editorial-guards.mts`第4行附近。旧预期是：

```ts
normalizeTitleIdentity('TEF/TCF写作：按目的选正式信开头', 'delf_b2_writing')
// 旧预期：'DELF B2写作：按目的选正式信开头'
```

新正确预期应为 `''`，因为只换考试名仍可能保留错误任务语义。修完测试后，再为商品1/商品2分别增加required/forbidden identity单测。

本次检查命令执行时间为2026-07-27交接前。不要引用文档中更早的“build通过”结论覆盖这里；修复后必须重新运行三条命令，并把新结果写回本文。

## 19. 工作树与版本控制注意事项

当前工作树非常脏，7月26-27的大量改动没有提交。接手后第一件事不是重置，而是：

```powershell
git status --short
git diff --stat
git diff -- src/lib/reference-compose.ts
```

绝对不要执行 `git reset --hard`、`git checkout -- .` 或回退整份 `reference-compose.ts`。这里包含两天累计的种子、标题、审校、token和商品2改造。

建议在完成商品身份P0修复和最小测试后，按功能拆分提交：

1. 种子与事实检索。
2. 标题与搜索词。
3. 校验分层和法语审校。
4. 商品2数据与产品提示词配置。
5. UI和测试。

测试生成的 `seeded-e2e-result-*.json`、日志、临时图片和批次数据很多，不要把它们与源码一起盲目提交。先整理 `.gitignore`，保留有代表性的验收样本即可。

## 20. 已知坑与避免方式

1. **把“能返回JSON”当成内容通过。** 必须人工看标题、封面、内页、正文和商品承接。
2. **共享提示词导致商品串线。** 两个商品共用流程可以，但必须有独立产品prompt profile。
3. **字符串替换掩盖语义错配。** `DELF B2 -> TEF/TCF`不能修复任务、题型和受众已经写错的问题。
4. **所有问题都拦截。** SEO和文风多为warning，只有结构、事实、法语硬错和商品错配应block。
5. **失败整篇重跑。** 优先局部修复；整篇重跑最多作为最后兜底，并记录真实token。
6. **每次发送完整知识库。** 当前已消除，不能再恢复。
7. **为了信息密度无限缩字。** 放不下就把低优先内容移到内页。
8. **要求LLM严格输出固定条数来解决排版。** LLM一定会多写少写，布局引擎必须自适应。
9. **所有封面都用HTML/CSS。** 教材、实拍、手写、复杂词汇压屏等模板应使用hybrid或image_to_image。
10. **所有封面都改成图生图。** 文字密集资料页需要文字准确、可控和可搜索，纯图生图容易乱码，code/hybrid仍有必要。
11. **把竞品每条线和每一行都照抄。** 应保留视觉骨架和密度，不抄原文、Logo、水印和独有元素。
12. **商品宣传写成目录播报。** 必须先有用户痛点、使用场景或结果承诺，再自然承接资料。
13. **标题一味追求夸张。** 爆款机制不等于虚构提分、百分比或官方规则。
14. **用窄知识点替代主流选题。** 四个任务中只有第三个允许窄，其余必须覆盖真实大需求。
15. **在用户验收前不看图。** 必须截图或打开实际渲染，检查折行、遮挡、字号和对齐。

## 21. 推荐接手顺序

### 第一阶段：1至2小时，堵商品串线

1. 先收口当前已传入productId、但定义仍是旧签名的辅助函数，恢复TypeScript构建。
2. 标题候选、封面兜底、内页兜底、core/editorial检查、SEO、考试规则和tags全部读取现有profile。
3. 更新 `test:editorial-guards` 的旧机械替换预期，并为两个profile补身份单测。
4. 扩展 `test:seed-flow` 覆盖商品2，验证禁用身份、证据锚点和零原始Markdown。
5. 修正首页“生成3个新选题”为“生成4个新选题”。
6. 重新运行两个测试和build，全部绿灯后才允许付费API测试。

### 第二阶段：控制API成本，做商品2小样

1. 跑3张卡的topics。
2. 先人工检查，再跑3条compose。
3. 记录每阶段调用和token。
4. 只修真实暴露的问题，不预先增加新校验层。

### 第三阶段：内容验收

1. 对商品1和商品2各连续生成至少3次，检查重复度。
2. 由小红书运营视角看标题和转化，由法语学习者看内容可理解性。
3. 选出失败样本，按“提示词问题、事实召回问题、模板兼容问题、排版问题”分类，不要混在一起修。

### 第四阶段：恢复模板开发

1. 实现约束式自适应排版引擎。
2. 每个模板用短、中、长三档真实AI数据测试。
3. 桌面和手机缩略图都检查。
4. 最后再扩展更多竞品模板。

## 22. 接手后的完成定义

商品2不能因为“下拉框能选”就算完成。只有同时满足以下条件才算进入验收阶段：

- 两个商品都有独立prompt profile。
- 选题、标题、封面、内页、正文、标签不存在跨商品身份。
- 两个商品的本地种子测试都通过。
- 商品2至少3种渲染模式各有1条真实完整样本。
- 标题有资料/解释/强钩子多种选择。
- 正文长度、关键词和标签正常。
- 法语例句和释义通过准确性检查。
- 商品承接有证据且不虚构服务。
- 前台能完整走通，失败信息为中文且不会因为warning阻断。
- token和耗时在界面可见，没有无意义整篇重跑。

## 23. 最后的判断

当前方案在技术和内容逻辑上是成立的：以竞品封面为入口，种子负责人群/痛点/买点不乱，结构化事实负责商品可信，AI负责具体选题和内容创作，75公式负责点击机制，模板负责视觉呈现，分层校验负责兜底。这比最早的“把人群、痛点、买点、知识点逐层穷举组合”更简单，也更接近人工手搓高赞笔记的真实过程。

但当前还不是两个商品都完成的版本。商品1已经进入可继续打磨验收阶段；商品2处在“数据、种子和独立profile已建立，topics/core/editorial/audit已接入，标题/封面/检查/SEO/tags尚未收口”的阶段。下一位 AI 最重要的工作不是继续加功能或继续做模板，而是完成剩余函数的productId改造并恢复构建，再补双商品零成本测试，最后用少量真实样本证明商品2不会写成DELF B2。

## 24. 给下一位 AI 的第一小时操作清单

这部分可直接执行，避免重新分析半天后又走回旧路。

1. 阅读本文第9-12、18、20-25节，并运行 `git status --short`，确认没有回滚用户和上一位AI的未提交改动。
2. 阅读 `src/lib/product-prompt-profiles.ts`、`src/lib/editorial-quality.ts`和 `scripts/test-editorial-guards.mts`。
3. 不要先跑付费API。先打开 `reference-compose.ts`，从当前第一个build错误开始，依次修改底层函数签名和实现：`ensureCoverIdentity`、标题候选组、`getCoreIssues`、`ensureMinimumInnerPages`、`getEditorialIssues`、SEO/考试规则/tags。
4. 每个函数都必须显式接收 `productId` 并读取现有profile，不得通过标题中是否含`B2`来猜商品，因为商品2同样可能讨论B2/C1。
5. 运行 `npm.cmd run build`，修完所有类型错误；不要只修第463行后就停。
6. 把editorial guard测试改为新语义，并增加两个商品的required/forbidden identity测试。
7. 扩展 `test:seed-flow`遍历两个商品，保证商品1不含TEF/TCF/CLB/NCLC，商品2不含DELF/DALF，锚点存在，原始Markdown仍为0。
8. 三项零成本命令全部通过后，修正首页“3个新选题”为“4个新选题”。
9. 然后只调用商品2 topics三张代表卡；人工检查通过后再生成三条完整compose。
10. 把每次真实样本按“小红书点击力、商品承接、法语准确、模板匹配、跨商品污染、token/耗时”六列记录。商品2内容链路通过前不做新模板扩展。

## 25. 文档可信度与边界

- “完成”只表示代码或本地规则已经实现并经过对应测试，不等于视觉和商业效果已验收。
- “已接入”只表示数据/UI/配置可被选择，不等于AI生成内容正确。
- 本文中的token数据来自历史真实样本，只用于判断成本量级，不是供应商账单。
- 商品2结构化事实由本地12篇资料整理而来，仍需在真实输出中检查是否召回了正确事实，而不是只检查ID存在。
- 搜索词截图只覆盖商品1；商品2搜索词当前是推断池，不应描述成小红书真实热搜数据。
- 用户已经明确：普通科普允许AI原创，商品能力、商品数量和服务承诺才必须有本地证据。不要把证据规则重新收紧成“知识库没有就不能写”。
- 用户也已经明确：教研规则只需兜底法语例句和释义准确，不要恢复昂贵的全篇官方规则审稿。
- 任何新AI接手时都应保持用户的验收标准：结果优先于开发完成度，先自己看输出，再让用户验收。

## 26. 当前未完成代码的精确实现蓝图

这一节对应停手时的实际代码，不是泛泛计划。

### 26.1 标题候选

把以下函数改成显式接收 `productId`：

- `ensureTitleCandidateMix(candidates, coverTitle, topic, productId)`
- `buildSeedTitleFallbacks(topic, productId)`
- `buildStrongTitleCandidates(topic, productId)`
- `buildTitleChoiceCandidates(topic, productId, coverTitle)`

商品2不能沿用商品1的“正式信、论坛、DELF B2评分”默认标题。应按种子语义提供TEF/TCF候选，例如：

- 选考：`TEF还是TCF？别急着报名`
- CLB7自测：`CLB7四科差在哪？先测`
- 30天计划：`TEF/TCF备考别再乱刷`
- 写作句型：`TEF/TCF句型背了用不上？`
- 词汇：`TEF/TCF词背了还说不出？`
- 高频主题：`TEF/TCF写作别临场想观点`
- 听力：`TCF听力临考猛刷有用吗`
- 口语：`TEF/TCF口语卡住？不只缺词`
- B2/C1对比：`加拿大法语写作差在哪？`
- 流程：`TEF/TCF考试流程别当天查`
- 避坑：`TEF/TCF备考越努力越乱？`
- 商品展示：`TEF/TCF资料别再乱收了`

候选仍需包含自由原创、参考图机制迁移和匹配的75公式候选；标题建议不超过22个中文视觉字符。公式只是点击机制，不得覆盖商品身份与内容承诺。

### 26.2 封面、内页与检查

- `ensureCoverIdentity(cover, renderer, productId)`：先清洗条目，再检查当前商品必需/禁用身份；禁用身份直接用 `getProductCoverFallbackTitle(productId, family)`，不得替换考试名。
- `ensureMinimumInnerPages(pages, cover, productId)`：兜底页标题使用profile的 `shortIdentity` 或 `noteIdentity`，不再硬编码“法语B2写作”。
- `getCoreIssues(..., productId)`：标题、封面标题和封面公开内容出现另一商品身份时加入 `product_identity_mismatch`，默认block。
- `getEditorialIssues(..., productId)`：内页与正文出现另一商品身份同样block。不要要求每个bullet重复身份，只检查整篇身份可识别且无禁用身份。
- 字段级修复最多一次；仍失败才阻塞。不得因此整篇重跑两遍。

### 26.3 SEO、考试规则与标签

- `buildSeoKeywords()`直接读取 `profile.seoKeywords`，再合并当前topic搜索词。
- `getExamFactRules()`直接返回 `profile.examFactRules`。
- `normalizeTags()`使用 `profile.tagIdentity`，商品2不能只兜底一个泛化`#TCF`。
- 搜索词只作为需求信号和SEO容器，不得因为搜索词出现“模板/范文”就强迫所有封面变成清单。

### 26.4 零成本测试应新增的断言

- `normalizeTitleIdentity('TEF/TCF写作：按目的选正式信开头', 'delf_b2_writing') === ''`。
- 商品1 required identity通过、TEF/TCF/CLB/NCLC被识别为forbidden。
- 商品2 required identity通过、DELF/DALF被识别为forbidden。
- `test:seed-flow`遍历两个商品；商品2topic、audience、pain、search_terms均无DELF/DALF。
- 两个商品的证据锚点ID存在，生成提示词原始Markdown摘录仍为0。

### 26.5 实测顺序与停止条件

1. `npm.cmd run build`
2. `npm.cmd run test:editorial-guards`
3. `npm.cmd run test:seed-flow`
4. 商品2三张卡只跑topics
5. topics人工通过后再跑三条compose
6. 最后从前台完整走一遍两个商品

任何一步出现跨商品身份、法语硬错、来源ID错配或页面不可读，都不要宣布完成。标题平淡、SEO弱、AI腔属于需要继续优化的问题，但应按warning/人工验收处理，不能再把整条流程拖入高成本重跑。
