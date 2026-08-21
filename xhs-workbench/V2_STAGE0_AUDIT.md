# V2 阶段0 代码审计（2026-08-21）

审计人：v2-flow-dev（阶段 0，纯审计，零代码改动）
基准：V2_CONSENSUS_IMPLEMENTATION_DESIGN.md v3 第 1 节断言表；行号以本次工作区（含未提交改动）为准。

## 1. 断言复核表

| # | 断言 | 结论 | 当前 file:line 证据 | 备注 |
|---|---|---|---|---|
| 1 | 标题节点已在正文后 | **confirmed** | `src/lib/v2/pipeline.ts:88-96`（composeV2 内先 `prepareContentForTitles`，含生成→闸门→repair→法语审查 `auditContentPackage`），`:106-110` 才 `generateTitlePackage` | 行号基本未漂移；title 抛错时带 partialArtifacts（:111-121） |
| 2 | 选题候选级淘汰、剩1条降级放行 | **confirmed** | `src/lib/v2/topic-stage.ts:117`（gateFailures 过滤 + TOPIC_HARD_FAILURES 淘汰）、`:118` selectTopicPortfolio、`:122-139`（可用 < limit → 降级继续+警告「已继续生成，不阻断任务」）、`:141-155`（零可用时唯一候选只要不跨商品/不跨模式就保留放行）、`:156-187`（showcase 兜底选题）、`:188`（全灭才 throw） | 行号与快照一致；失败信息目前只有聚合统计（rejected 数组+console.error），尚无「逐候选死因」结构化文案——阶段 B 需补 |
| 3 | 标题失败不让整篇失败 | **confirmed（含在途改动）** | `src/lib/v2/title-stage.ts:132-156`（候选不足时 repairTitleCandidates 返修补齐）、`:159-180`（零候选时 salvage：忽略历史占用重筛，保候选+警告「请人工复核标题新鲜度」）、`:187-189`（仅 salvage 池也为空才 throw） | 注意：该文件有未提交改动（见 §2），repair 触发条件已从「length===0」放宽为「length<TITLE_CANDIDATE_COUNT(4)」，新增 targetCount 参数——设计 4.3/4.4 的方向已被在途改动部分实现 |
| 4 | topics_per_card 控制点 | **confirmed** | `src/app/api/batch/route.ts:86`（`clamp(body.topics_per_card ?? 2, 1, 3)`）、`:127-136`（planTopicsV2 传 `limit: topicsPerCard`，注释明确不再硬编码候选池数量） | 行号未漂移 |
| 5 | 商品隔离 pattern 被 topic/title/content 调用 | **confirmed** | 定义：`src/lib/product-prompt-profiles.ts:27/28、54/55、81/82、110-126`。实际调用点：topic-stage.ts:347（cross_product_identity）、content-stage.ts:404（内容身份串线直接 throw）、title-stage.ts:289-291（passesHardGates）+ 676-678（titleGateFailures 返修口径）。v1 侧 reference-compose.ts:750/1068/4469 也用 | 设计假设成立；商品2/3 各自 profile 独立正则，隔离边界清晰 |
| 6 | 密度硬拦有降档+返修前置 | **confirmed** | `src/lib/v2/publish-guard.ts:17-24` RELEASE_BLOCKING_ISSUES = {cover_density_below_contract, cover_group_underfilled, inner_pages_too_few, false_product_form, fabricated_authority, unsupported_exam_consequence}；`src/lib/v2/topic-stage.ts:474-492` buildTiers（tiers[0] 为 compact 降档档位，:469 组装）；`src/lib/v2/pipeline.ts:203-231`（生成→发现 blocking→先 repairContentPackage 再复查，仍未过才 :234-243 throw） | **重要在途改动**：publish-guard 的 `inner_pages_too_few` 硬拦已被未提交改动改成 `ensureInnerPageCount(content)` 程序补齐（publish-guard.ts:226-257），即内页不足不再拦截而是程序造页补到 5 页——与设计 6.2「密度硬拦仅无法恢复」方向一致但属行为变化，需主会话确认接受 |
| 7 | 单条前台 limit=4 | **confirmed** | `src/app/api/reference-studio/route.ts:40`（v2 分支 `limit: 4`；v1 分支 :56 同为 4） | 快照写 41，实际 40，逻辑一致；阶段 B 改 3 的落点即此行 |

结论：7 条断言全部成立，无 contradicted；仅第 3/6 条行为被未提交在途改动推进。

## 2. 未提交改动盘点

git status：修改 15 个文件（src 12 + scripts 3），未跟踪 318 项（.tmp-*、JSON 运行产物、日志、.research/ 等，按约定只计数不深究）。git diff --stat：src+scripts 共 +257/-82。

### src/lib/v2/（5 文件）

| 文件 | 改动语义 | 与设计冲突？ |
|---|---|---|
| contracts.ts | 新增 `REQUIRED_INNER_PAGE_COUNT = 5` 常量 | 不冲突；为下面内页 5 页制提供单一来源 |
| content-stage.ts | ① showcase 模式 prompt 升级：内页按 5 张截图逐张对应（模块/截图/图中内容/用户价值），禁止串图；② 普通+返修 prompt 硬性要求「恰好 5 页、每页至少 3 条」；③ `ensureMinimumPages` 重写为 `ensureInnerPageCount`：不足 5 页时程序按 coverBlocks/承诺轮转切片补齐，超出截断 | 不冲突。注意：这是把「内页不足」从拦截改为程序兜底，与 publish-guard 的改动配套。潜在隐患：补齐页内容是封面条目复述，5 页全兜底时内页质量低但闸门看不见 |
| publish-guard.ts | 删除 `inner_pages_too_few` 硬拦（原 `length<2` 报 hardIssue），改为 `ensureInnerPageCount` 原地补齐/截断到恰好 5 页（publish-guard.ts:226-257） | **需主会话拍板**：RELEASE_BLOCKING_ISSUES 集合仍含 `inner_pages_too_few`（:20）但已无代码会产生该 code——变成死码。设计 6.2 语义上兼容（「无法恢复」才硬拦），但硬拦集与实际产出不一致，阶段 E 前应清理或保留观察 |
| title-stage.ts | ① 新增 `TITLE_CANDIDATE_COUNT=4` 常量；② prompt 从「showcase 8 组/普通 12 组、每类 2-3 组」统一改为「恒 4 组、四机制各 1」，maxTokens 2400/3000→1800、retries 2→1；③ repair 触发条件 `length===0` → `length<4`，repairable 池 6→8，repair 增加 targetCount；④ `limitShowcaseCandidates` 重命名 `limitTitleCandidates`（每机制限 1 + 补足到 4）；⑤ salvage 路径同样走 limit；⑥ 警告文案改为「只有 N 组/未达到 4 组」 | **与设计 4.2/4.4 高度重叠但提前落地**：输出组数已从写死 8/12 收敛到 4 且抽出常量，正是阶段 D 要参数化的前置。无冲突，反而是阶段 D 的好起点；但 6 方向池、candidateCount clamp 1-8、内页摘要入参尚未做 |
| pipeline.ts | 新增 `wholeProductBridge`：普通模式结尾带货页（product_bridge）文案从「截图三段复述」升级为商品1 专属整套资料库叙事（目录全模块串联），商品2/3 走 asset 字段通用兜底 | 不冲突，且已按商品隔离（productId 分支，商品2/3 不吃商品1 文案）。注意 lead/bullets 是写死文案，属「程序生成非 AI」，符合零 AI 调用原则 |

### 其他 src/（6 文件）

| 文件 | 改动语义 | 与设计冲突？ |
|---|---|---|
| src/app/api/batch/route.ts | 批内选题去重范围收窄：普通模式从 batchUsedTopicTexts（跨卡）改为 cardUsedTopicTexts（同卡内），topicKey 统一带 cardId 前缀——不同封面允许相似选题，同封面内仍去重；batchUsedTopicTexts 保留并仍传下一张卡 recentAngles（跨卡软规避） | **不冲突（v3 口径）**：设计 v3 预核对第 1 条已按工作区现状为基线（卡内硬去重 + 跨卡软规避 + 跨卡撞题只警告不吞 job）。已核对 diff 与描述一致 |
| src/lib/reference-compose.ts | v1 侧：内页统一「恰好 5 页」（prompt、ensureMinimumInnerPages、repair、getEditorialIssues 的 inner_page_count_invalid 从 4-6 区间改为 ===5） | 不冲突（v1 链路），但注意商品2/3 走 v2 开关关闭时实际也走 v1 的 composeDraft——商品2/3 行为**有变化**（内页 4-6 → 恰 5），与「商品2/3 逐字节等价」红线需在阶段 E 验证口径 |
| src/lib/product-showcase-library.ts | 商品1 showcase 资产大扩容：4 张手写资产 → +20 张 PDF teaser 页（canBeInnerPage only），带 moduleId/moduleLabel；pickProductShowcasePlan 内页选图改为「跨模块优先取 5 张」避免同文件夹重复截图 | 设计红线「不动 product_showcase 模式」——这是**已落盘的 showcase 模式改动**（主会话/他人之前的工作，非本阶段引入）。阶段 0 只记录，不评判 |
| src/lib/reference-image-prompt.ts | 图生图 prompt 加一行「字体随参考图模仿」约束 | 不冲突（生图 prompt，非本设计范围） |
| src/components/templates/ReferenceCoverRenderer.tsx | showcase 封面字体样式升级（text-stroke 替代多层 text-shadow、各变体独立字体族）；PlainExperience/DocumentAnalysis 布局微调 | 视觉组件改动，属他人 showcase/视觉工作，与本设计「不改视觉」不冲突（非本阶段做的） |
| src/components/templates/inner-pages/InnerPageRenderer.tsx | showcase 内页支持展示 `showcase_asset_image` 真实截图（62% 高度图区，bullets 收到 2 条） | 同上，showcase 配套 |

### scripts（3 文件）

| 文件 | 改动语义 |
|---|---|
| test-editorial-guards.mts | 断言反转：`unsupported_score_or_time_claim`、`unsupported_outcome_claim` 从「必须拦截」改为「必须不拦截」（用户 2026-08-16 拍板允许提分/效率钩子）——注意这与 v2-flow-dev 纪律「禁止改测试预期变绿」形似，但注释说明是用户拍板的行为变更，属存量在途工作 |
| test-seed-flow.mts | 商品列表加入第三个商品 tcf_canada_writing_7day（补测试覆盖） |
| screenshot-covers.mjs | 输出目录/清空行为可由环境变量控制（工具性改动） |

**半成品检查**：未发现改一半的函数或孤儿代码。tsc 级一致性看起来完整（TITLE_CANDIDATE_COUNT 在 title-stage.ts 内闭环使用；REQUIRED_INNER_PAGE_COUNT 在 contracts 导出、content-stage/publish-guard 引用）。唯一逻辑瑕疵：publish-guard.ts:20 的 `inner_pages_too_few` 仍在硬拦集合但已无产生源（见上表）。

## 3. showcase 兜底实现要点（topic-stage.ts:156-187）

实现方式：
- 触发条件：AI 零可用候选 且 productShowcaseMode 为真（:156），先于最终 throw（:188）。
- 纯程序构造一个 `TopicOption` 字面量（:160-179）：id 用 `showcase_fallback_${card.id}_${stableHash(productId)}`；topic/audienceState/scene/painOrDesire/promise/productBridge 全部由 `profile.noteIdentity`（商品身份）+ `input.card.name`（封面名）+ `card.content_mechanism` 模板化拼出；plannedBlockKind 取 capability 第一个可用块型；seo.primary = noteIdentity；noveltyFingerprint 固定前缀便于事后统计。
- 返回时带警告「已使用该封面的商品介绍兜底选题」（:180-186），零额外 AI 调用，后续标题/正文链路照常走。

标准模式兜底可复用什么：
1. **结构完全可复用**：fallback TopicOption 的构造骨架（从 profile + card + capability 派生所有必填字段）对普通模式同样成立，只是文案模板要从「介绍资料包」换成按 capability.acceptedBlockKinds / family 推导的保守知识型选题。
2. **降级链位置可复用**：插在「唯一候选轻微偏差保留」(:141-155) 之后、throw (:188) 之前，天然满足设计 3.4 的失败语义顺序（候选级淘汰→降级→兜底→卡片失败）。
3. **警告与 fingerprint 惯例可复用**：seedSignals 标 fallback 标记 + noveltyFingerprint 前缀，便于回放测试识别兜底路径。
4. **需要新增的**：普通模式兜底的「无法成立」判定（设计 3.4 要求兜底也无法成立才失败，且失败信息逐候选列死因）——现有代码 throw 文案只有计数（:188），需阶段 B 重写。

## 4. 测试脚本盘点（scripts/ 全部 v2 测试，2026-08-21 复核补充）

- **test-v2-topic-portfolio.mts**：离线。构造 6 个候选（含重复、机器表达、各车道）调 `selectTopicPortfolio`/`diagnoseTopicOption`，断言车道覆盖、语义去重（findSimilarTopic/topicIntentFingerprint）、封面 family 形态失配判定。设计 7.1 引用存在 ✓
- **test-v2-title-stage.mts**：⚠️ **不是离线测试**。读历史产物 JSON（默认 `v2-real-smoke-tef-publishable.json`，fixture 必须存在）后直接调真实 `generateTitlePackage`（内部走 callOpenAICompatibleJsonWithUsage → 真实 LLM）。可作阶段 E 后的真实验收工具，不能当「离线每阶段必跑」。
- **test-v2-title-gates.mts**：离线。手写 TEF/DELF 标题候选调 `diagnoseTitlePair`/`selectTitleCandidateForTest`，断言闸门 failures。存在 ✓
- **replay-v2-topic-gates.mts**：离线回放。argv[2] 传历史验收 JSON（默认 `v2-real-acceptance-composed.json`），对每个 job 的 v2_topic 跑 `diagnoseTopicOption` 列 failures。存在 ✓
- **replay-v2-publish-guard.mts**：离线回放。历史产物过 `inspectForPublish`。存在 ✓
- **test-v2-fact-guard.mts**：离线。inspectForPublish + isReleaseBlockingIssue 的事实/权威/考试后果判罚。
- **test-v2-dataflow.mts**：离线。compileCover 编译与 countVisibleUnits 契约。
- **test-v2-compile-real-artifacts.mts**：离线。历史真实 artifacts 走 compileDraft。
- **test-v2-failed-job-regressions.mts / test-v2-latest-batch-guards.mts**：离线。扫描落盘失败 job / 最近 batch 过闸门回归。
- **test-v2-api-flow.mts / test-v2-real-smoke.mts**：**需起真实服务**（localhost:4012 / 4077，走真实 API），不属离线集。
- 存量入口 `npm run test:seed-flow`、`test:editorial-guards` 在 package.json 存在 ✓。所有脚本 import 的模块均存在，未发现 import 缺失。

## 5. 风险与主会话需要注意的事项

1. **batch 去重在途改动已与设计对齐（v3 更正）**：设计 v3 预核对第 1 条已按工作区现状为基线——卡内硬去重（cardUsedTopicTexts + findSimilarTopic 0.56）+ 跨卡软规避（batchUsedTopicTexts 仍传下一张卡 planTopicsV2.recentAngles，route.ts:135）。本审计确认 diff 与该描述一致，无冲突；早期版本标注的「与设计 3.4 冲突」按 v3 作废。
2. **硬拦集合出现死码**：publish-guard `inner_pages_too_few` 仍在 RELEASE_BLOCKING_ISSUES 但产生源已被替换为程序补齐。设计 6.2 硬拦表需要更新口径（内页不足不再是硬拦，密度契约是否仍覆盖此场景需明确），否则阶段 E 回放测试可能对不上。
3. **商品2/3「零变化」红线需重验**：在途改动把 v1 链路（reference-compose.ts）内页从 4-6 页改为恰好 5 页，并影响 getEditorialIssues 的 `inner_page_count_invalid` 判定。商品2/3 关闭 v2 时走的就是这条链路——阶段 E 的「行为等价」基线应改为「与当前工作区（含在途改动）等价」而非「与上次 commit 等价」，请主会话确认基线锚点。
4. **title-stage 在途改动已部分实现阶段 D**（4 组恒定 + repair 补齐 + targetCount）。阶段 D 派发时应以当前工作区为起点做增量（6 方向池、candidateCount 1-8 clamp、内页摘要、<12 字改警告），不要按设计原文重做已完成部分。
5. **内页程序补齐的质量盲区**：content-stage/publish-guard 两处兜底都是「封面条目复述式造页」，5 页全兜底时产出会很水但闸门全绿。设计 6.2 只拦「布局无法恢复」；建议后续阶段至少给「程序补齐页数 ≥N」加 warnings 可见性（当前无任何警告）。
6. **选题失败信息不满足 §18 第 10 条**：现有 throw 只有计数（`原始X，规则拒绝Y`），逐候选死因只在 console.error 的 JSON 里。阶段 B 必须把它变成结构化失败信息（设计 3.4 明确要求）。
7. 未跟踪 318 个文件（.tmp-*、运行 JSON、日志、.research/、.workbuddy/ 等）建议主会话择机 gitignore/清理，不影响本设计。

