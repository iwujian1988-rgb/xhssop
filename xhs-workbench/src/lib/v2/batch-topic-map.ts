import { callOpenAICompatibleJsonWithUsage, type AiUsageSummary } from '@/lib/ai-client';
import type { ProductId } from '@/types/data';
import {
  DOMAIN_LABELS, PROBLEM_DOMAIN, PROBLEM_MECHANISMS, PROBLEM_OBJECTS, TOPIC_CONTENT_TYPES, TOPIC_DOMAINS, TOPIC_MECHANISMS,
  TOPIC_OBJECTS, TOPIC_PROBLEMS, TOPIC_SCALES, TOPIC_SCENES, coordinateHash, coordinateKey,
  validateCoordinate, type TopicContentType, type TopicCoordinate, type TopicDomainId,
  type TopicMechanismId, type TopicObjectId, type TopicProblemId, type TopicScale, type TopicSceneId,
} from './topic-coordinate-taxonomy';

export interface TopicCoordinateUsageHint {
  coordinateKey: string;
  useCount: number;
  lastSuccessAt?: string;
}

export interface BatchTopicMapInput {
  productId: ProductId;
  count: number;
  userDirection?: string;
  usageHints?: TopicCoordinateUsageHint[];
}

export interface BatchTopicMapResult {
  coordinates: TopicCoordinate[];
  status: 'PASS' | 'PARTIAL_SUCCESS';
  failedCoordinates: CoordinateFailure[];
  usage: AiUsageSummary;
  warnings: string[];
  promptInput: Record<string, unknown>;
}

export interface CoordinateFailure {
  status: 'COORDINATE_UNRECOVERABLE';
  coordId: string;
  reasons: string[];
}

interface CompactUsageSummary {
  componentUseCounts: Record<'domain' | 'problem' | 'object' | 'mechanism' | 'scene', Record<string, number>>;
  recentCoordinates: Array<{ coordinateKey: string; useCount: number; lastSuccessAt?: string }>;
  mostUsedCoordinates: Array<{ coordinateKey: string; useCount: number; lastSuccessAt?: string }>;
}

type RawCoordinate = Record<string, unknown>;
type RawResponse = { coordinates?: RawCoordinate[] };

export type LockedCoordinate = Omit<TopicCoordinate, 'problemNote' | 'outcomeNote' | 'coordinateHash'>;

export async function planBatchTopicMap(input: BatchTopicMapInput): Promise<BatchTopicMapResult> {
  if (input.productId !== 'delf_b2_writing') throw new Error('全批选题坐标地图当前只用于 DELF B2 写作');
  const requestedCount = Math.floor(input.count);
  if (requestedCount < 1 || requestedCount > 50) throw new Error('单批选题名额必须在 1 到 50 之间');
  const count = requestedCount;
  const lockedCoordinates = allocateLockedCoordinates(count, input.usageHints || [], input.userDirection || '');
  const promptInput = {
    productScope: 'DELF B2 法语写作备考；可原创教学内容，但不得伪造官方规则或精确评分承诺。',
    count,
    userDirection: input.userDirection || '',
    taxonomy: {
      domains: TOPIC_DOMAINS.map(id => ({ id, label: DOMAIN_LABELS[id] })),
      problems: TOPIC_PROBLEMS.map(id => ({ id, domainId: PROBLEM_DOMAIN[id], allowedMechanisms: PROBLEM_MECHANISMS[id] })),
      objects: TOPIC_OBJECTS,
      mechanisms: TOPIC_MECHANISMS,
      scenes: TOPIC_SCENES,
      scales: TOPIC_SCALES,
      contentTypes: TOPIC_CONTENT_TYPES,
    },
    historicalUsage: compactUsageHints(input.usageHints || []),
    lockedCoordinates,
  };
  const system = [
    '你是 DELF B2 写作账号的栏目总编辑。当前只分配整批内容坐标，不写标题、正文、情绪、封面或任务单。',
    `一次输出完整的 ${count} 个坐标，必须全局比较后再返回；不得拆批。`,
    'lockedCoordinates 是程序已经完成全局比较后锁定的合法骨架，不得更换、重排或自行创造任何 ID。',
    '你只负责为每个 coordinateId 补写 problemNote 与 outcomeNote，不需要回传其他坐标字段。',
    'problemNote 与 outcomeNote 各不超过24个汉字，只说明该坐标的具体变化；不得出现封面、颜色、材质或模板词。',
    'historicalUsage 是长期使用统计。优先选择使用少、冷却时间长的坐标；不要仅仅改写旧标题。',
    '只返回JSON对象，顶层 coordinates。每项只能有 coordinateId,problemNote,outcomeNote；数量和顺序必须与 lockedCoordinates 完全一致。',
  ].join('\n');

  let lastIssue = '';
  const notePool = new Map<string, RawCoordinate>();
  let combinedUsage: AiUsageSummary = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const missing = missingLockedNotes(notePool, lockedCoordinates);
    const isTargetedRepair = attempt > 0 && missing.length > 0;
    const user = isTargetedRepair
      ? JSON.stringify({
        task: '只补齐以下缺失坐标的 problemNote / outcomeNote，不重写其他坐标。',
        missingCoordinates: missing.map(base => ({
          ...base,
          current: notePool.get(base.coordinateId) || null,
        })),
        lastIssue,
      })
      : JSON.stringify(promptInput);
    const activeSystem = isTargetedRepair
      ? [
        '你只修复 DELF B2 写作坐标地图中缺失的短说明。',
        '只返回JSON对象，顶层 coordinates；每项只能有 coordinateId,problemNote,outcomeNote。',
        '必须逐个返回 missingCoordinates 中的坐标，不得改写或返回其他坐标。',
        'problemNote 与 outcomeNote 各不超过24个汉字，必须具体，不得出现封面、颜色、材质或模板词。',
      ].join('\n')
      : system;
    const result = await callOpenAICompatibleJsonWithUsage<RawResponse>([
      { role: 'system', content: activeSystem }, { role: 'user', content: user },
    ], { maxTokens: Math.max(1800, Math.min(4200, count * 135)), temperature: 0.75, retries: 2 });
    combinedUsage = mergeUsage(combinedUsage, result.usage);
    mergeLockedNotes(notePool, result.data?.coordinates, new Set(missing.map(item => item.coordinateId)));
    const checked = normalizeLockedNotesAndValidate([...notePool.values()], lockedCoordinates);
    if (checked.ok) return {
      coordinates: checked.coordinates,
      status: 'PASS',
      failedCoordinates: [],
      usage: combinedUsage,
      warnings: attempt ? [`全批坐标地图首轮漏项，已仅补齐 ${attempt === 1 ? '缺失坐标' : '剩余缺失坐标'}，未重跑完整地图`] : [],
      promptInput,
    };
    lastIssue = checked.issue;
  }
  const coordinates: TopicCoordinate[] = [];
  const failedCoordinates: CoordinateFailure[] = [];
  for (const base of lockedCoordinates) {
    const checked = normalizeLockedNotesAndValidate(
      notePool.has(base.coordinateId) ? [notePool.get(base.coordinateId)!] : [],
      [base],
    );
    if (checked.ok) coordinates.push(checked.coordinates[0]!);
    else failedCoordinates.push({
      status: 'COORDINATE_UNRECOVERABLE',
      coordId: base.coordinateId,
      reasons: [checked.issue || lastIssue || '坐标定向补全后仍不合格'],
    });
  }
  return {
    coordinates,
    status: failedCoordinates.length ? 'PARTIAL_SUCCESS' : 'PASS',
    failedCoordinates,
    usage: combinedUsage,
    warnings: failedCoordinates.map(item => `${item.coordId}：COORDINATE_UNRECOVERABLE（${item.reasons.join('；')}），已跳过，其余坐标继续`),
    promptInput,
  };
}

export function mergeLockedNotes(pool: Map<string, RawCoordinate>, raw: unknown, allowedCoordinateIds?: ReadonlySet<string>) {
  if (!Array.isArray(raw)) return;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const incoming = item as RawCoordinate;
    const coordinateId = clean(incoming.coordinateId);
    if (!coordinateId) continue;
    if (allowedCoordinateIds && !allowedCoordinateIds.has(coordinateId)) continue;
    const previous = pool.get(coordinateId) || {};
    pool.set(coordinateId, {
      coordinateId,
      problemNote: clean(previous.problemNote) || clean(incoming.problemNote),
      outcomeNote: clean(previous.outcomeNote) || clean(incoming.outcomeNote),
    });
  }
}

export function missingLockedNotes(pool: Map<string, RawCoordinate>, locked: LockedCoordinate[]) {
  return locked.filter(base => {
    const note = pool.get(base.coordinateId);
    return !clean(note?.problemNote) || !clean(note?.outcomeNote);
  });
}

export function allocateLockedCoordinates(count: number, hints: TopicCoordinateUsageHint[], userDirection = ''): LockedCoordinate[] {
  const usage = compactUsageHints(hints).componentUseCounts;
  const exactUsage = new Map(hints.map(hint => [hint.coordinateKey, hint]));
  const directionIntent = inferDirectionIntent(userDirection);
  const domains = [...TOPIC_DOMAINS].sort((a, b) =>
    Number(directionIntent.domains.has(b)) - Number(directionIntent.domains.has(a))
      || (usage.domain[a] || 0) - (usage.domain[b] || 0));
  const selectedPairs: Array<{ domainId: TopicDomainId; problemId: TopicProblemId; mechanismId: TopicMechanismId }> = [];

  // 用户明确点名某个内容方向时，先给该领域不同机制的名额；其余名额仍保持跨领域覆盖。
  for (const domainId of domains.filter(domain => directionIntent.domains.has(domain))) {
    const problemId = TOPIC_PROBLEMS.find(problem => PROBLEM_DOMAIN[problem] === domainId)!;
    for (const mechanismId of [...PROBLEM_MECHANISMS[problemId]].sort((a, b) => (usage.mechanism[a] || 0) - (usage.mechanism[b] || 0))) {
      if (selectedPairs.length >= count) break;
      selectedPairs.push({ domainId, problemId, mechanismId });
    }
  }

  // 第一轮优先让每个领域各占一个名额；后续才使用同一问题的其他解决机制。
  // 这使“覆盖面”由程序保证，不再要求模型同时记住 25 个组合。
  for (const domainId of domains) {
    if (selectedPairs.length >= count) break;
    if (selectedPairs.some(item => item.domainId === domainId)) continue;
    const problemId = TOPIC_PROBLEMS.find(problem => PROBLEM_DOMAIN[problem] === domainId)!;
    const mechanismId = [...PROBLEM_MECHANISMS[problemId]]
      .sort((a, b) => (usage.mechanism[a] || 0) - (usage.mechanism[b] || 0))[0]!;
    selectedPairs.push({ domainId, problemId, mechanismId });
  }
  const remainingPairs = TOPIC_PROBLEMS.flatMap(problemId =>
    PROBLEM_MECHANISMS[problemId].map(mechanismId => ({
      domainId: PROBLEM_DOMAIN[problemId], problemId, mechanismId,
    })),
  )
    .filter(candidate => !selectedPairs.some(item => item.problemId === candidate.problemId && item.mechanismId === candidate.mechanismId))
    .sort((a, b) => pairUsage(a) - pairUsage(b));
  while (selectedPairs.length < count && remainingPairs.length) selectedPairs.push(remainingPairs.shift()!);
  const allPairs = TOPIC_PROBLEMS.flatMap(problemId =>
    PROBLEM_MECHANISMS[problemId].map(mechanismId => ({
      domainId: PROBLEM_DOMAIN[problemId], problemId, mechanismId,
    })),
  ).sort((a, b) => pairUsage(a) - pairUsage(b));
  let repeatedPairIndex = 0;
  while (selectedPairs.length < count) {
    selectedPairs.push(allPairs[repeatedPairIndex % allPairs.length]!);
    repeatedPairIndex += 1;
  }
  if (selectedPairs.length !== count) throw new Error(`合法问题与机制组合只有 ${selectedPairs.length} 个，无法分配 ${count} 个名额`);

  const selectedFullKeys = new Set<string>();
  const selectedSceneCounts = new Map<string, number>();
  return selectedPairs.map((pair, index) => {
    const objects = [...PROBLEM_OBJECTS[pair.problemId]]
      .sort((a, b) => (usage.object[a] || 0) - (usage.object[b] || 0) || lexicalTie(a, b, index));
    const scenes = [...TOPIC_SCENES]
      .sort((a, b) => (usage.scene[a] || 0) - (usage.scene[b] || 0) || lexicalTie(a, b, index));
    const combinations = objects.flatMap(objectId => scenes.map(sceneId => ({ objectId, sceneId })))
      .filter(candidate => !selectedFullKeys.has(fullKey(pair, candidate)))
      .sort((a, b) => combinationScore(pair, a) - combinationScore(pair, b)
        || lexicalTie(`${a.objectId}|${a.sceneId}`, `${b.objectId}|${b.sceneId}`, index));
    const { objectId, sceneId } = combinations[0]!;
    selectedFullKeys.add(fullKey(pair, { objectId, sceneId }));
    selectedSceneCounts.set(sceneId, (selectedSceneCounts.get(sceneId) || 0) + 1);
    const scale = directionIntent.scale || TOPIC_SCALES[index % TOPIC_SCALES.length]!;
    const contentType = directionIntent.contentType || TOPIC_CONTENT_TYPES[index % TOPIC_CONTENT_TYPES.length]!;
    return {
      coordinateId: `coord_${String(index + 1).padStart(2, '0')}`,
      ...pair,
      objectId,
      sceneId,
      scale,
      contentType,
    };
  });

  function pairUsage(pair: { domainId: TopicDomainId; problemId: TopicProblemId; mechanismId: TopicMechanismId }) {
    return (usage.domain[pair.domainId] || 0) + (usage.problem[pair.problemId] || 0) + (usage.mechanism[pair.mechanismId] || 0);
  }

  function fullKey(
    pair: { domainId: TopicDomainId; problemId: TopicProblemId; mechanismId: TopicMechanismId },
    candidate: { objectId: TopicObjectId; sceneId: TopicSceneId },
  ) {
    return `${pair.domainId}|${pair.problemId}|${candidate.objectId}|${pair.mechanismId}|${candidate.sceneId}`;
  }

  function combinationScore(
    pair: { domainId: TopicDomainId; problemId: TopicProblemId; mechanismId: TopicMechanismId },
    candidate: { objectId: TopicObjectId; sceneId: TopicSceneId },
  ) {
    const hint = exactUsage.get(fullKey(pair, candidate));
    const lastUsedAt = Date.parse(hint?.lastSuccessAt || '');
    const inThirtyDayCooldown = Number.isFinite(lastUsedAt) && Date.now() - lastUsedAt < 30 * 24 * 60 * 60 * 1000;
    return (inThirtyDayCooldown ? 1_000_000 : 0)
      + (hint?.useCount || 0) * 10_000
      + (usage.object[candidate.objectId] || 0)
      + (usage.scene[candidate.sceneId] || 0)
      + (selectedSceneCounts.get(candidate.sceneId) || 0) * 25_000
      - (directionIntent.objects.has(candidate.objectId) ? 100_000 : 0);
  }
}

function inferDirectionIntent(direction: string): {
  domains: Set<TopicDomainId>;
  objects: Set<TopicObjectId>;
  scale?: TopicScale;
  contentType?: TopicContentType;
} {
  const text = direction.toLocaleLowerCase();
  const domains = new Set<TopicDomainId>();
  const objects = new Set<TopicObjectId>();
  const rules: Array<[RegExp, TopicDomainId]> = [
    [/审题|指令|跑题/, 'task_decoding'], [/观点|思路|没话写/, 'idea_generation'],
    [/论证|理由|展开/, 'argument_development'], [/例子|案例|证据/, 'evidence_examples'],
    [/结构|衔接|连接词/, 'structure_cohesion'], [/书信|写信|语域|文体|正式信/, 'register_genre'],
    [/语法|时态|虚拟式|条件式/, 'grammar_accuracy'], [/词汇|搭配|表达/, 'lexical_precision'],
    [/修改|纠错|自查|反馈/, 'revision_feedback'], [/时间|考场|模考/, 'exam_execution'],
    [/复习|刷题|攻略|邪修/, 'study_strategy'], [/范文|迁移|资料/, 'material_transfer'],
    [/焦虑|信心|复读|崩溃|破防/, 'confidence_rebuild'],
  ];
  for (const [pattern, domain] of rules) if (pattern.test(text)) domains.add(domain);
  if (/正式信|书信|写信/.test(text)) objects.add('formal_letter');
  if (/论坛|forum/.test(text)) objects.add('forum_post');
  if (/报告|文章/.test(text)) objects.add('article_report');
  if (/范文/.test(text)) objects.add('model_essay');
  if (/词汇|搭配/.test(text)) objects.add('vocabulary_collocation');
  if (/邪修|技巧|速成/.test(text)) return { domains, objects, scale: 'strategy', contentType: 'hack' };
  if (/攻略|步骤|路径/.test(text)) return { domains, objects, scale: 'strategy', contentType: 'guide' };
  if (/汇总|清单|速查|资料/.test(text)) return { domains, objects, scale: 'reference', contentType: 'summary' };
  return { domains, objects };
}

function lexicalTie(a: string, b: string, offset: number) {
  return `${offset}:${a}`.localeCompare(`${offset}:${b}`);
}

export function normalizeLockedNotesAndValidate(
  raw: unknown,
  locked: LockedCoordinate[],
): { ok: true; coordinates: TopicCoordinate[] } | { ok: false; issue: string; coordinates: TopicCoordinate[] } {
  if (!Array.isArray(raw)) return { ok: false, issue: '缺少coordinates数组', coordinates: [] };
  const byId = new Map(raw
    .filter((item): item is RawCoordinate => Boolean(item) && typeof item === 'object')
    .map(item => [clean(item.coordinateId), item]));
  const coordinates: TopicCoordinate[] = [];
  for (const base of locked) {
    const note = byId.get(base.coordinateId);
    const problemNote = clean(note?.problemNote);
    const outcomeNote = clean(note?.outcomeNote);
    if (!problemNote || !outcomeNote) {
      return { ok: false, issue: `${base.coordinateId} 缺少具体问题或结果`, coordinates };
    }
    const coordinate: TopicCoordinate = {
      ...base,
      problemNote,
      outcomeNote,
      coordinateHash: coordinateHash(base),
    };
    const failures = validateCoordinate(coordinate);
    if (failures.length) return { ok: false, issue: `${base.coordinateId}:${failures.join(',')}`, coordinates };
    coordinates.push(coordinate);
  }
  return { ok: true, coordinates };
}

function compactUsageHints(hints: TopicCoordinateUsageHint[]): CompactUsageSummary {
  const componentUseCounts: CompactUsageSummary['componentUseCounts'] = {
    domain: {}, problem: {}, object: {}, mechanism: {}, scene: {},
  };
  for (const hint of hints) {
    const parts = hint.coordinateKey.split('|');
    if (parts.length !== 5) continue;
    const count = Math.max(0, Math.floor(Number(hint.useCount) || 0));
    const names = ['domain', 'problem', 'object', 'mechanism', 'scene'] as const;
    names.forEach((name, index) => {
      const id = parts[index]!;
      componentUseCounts[name][id] = (componentUseCounts[name][id] || 0) + count;
    });
  }
  const normalized = hints
    .filter(item => item.coordinateKey.split('|').length === 5)
    .map(item => ({
      coordinateKey: item.coordinateKey,
      useCount: Math.max(0, Math.floor(Number(item.useCount) || 0)),
      ...(item.lastSuccessAt ? { lastSuccessAt: item.lastSuccessAt } : {}),
    }));
  const recentCoordinates = [...normalized]
    .sort((a, b) => Date.parse(b.lastSuccessAt || '') - Date.parse(a.lastSuccessAt || ''))
    .slice(0, 60);
  const mostUsedCoordinates = [...normalized]
    .sort((a, b) => b.useCount - a.useCount || Date.parse(b.lastSuccessAt || '') - Date.parse(a.lastSuccessAt || ''))
    .slice(0, 20);
  return { componentUseCounts, recentCoordinates, mostUsedCoordinates };
}

export function normalizeAndValidate(raw: unknown, expectedCount: number): { ok: true; coordinates: TopicCoordinate[] } | { ok: false; issue: string; coordinates: TopicCoordinate[] } {
  if (!Array.isArray(raw)) return { ok: false, issue: '缺少coordinates数组', coordinates: [] };
  const coordinates = raw.map((item, index) => normalizeCoordinate(item as RawCoordinate, index));
  if (coordinates.some(item => !item)) return { ok: false, issue: '存在无法解析的坐标', coordinates: coordinates.filter(Boolean) as TopicCoordinate[] };
  const valid = coordinates as TopicCoordinate[];
  if (valid.length !== expectedCount) return { ok: false, issue: `坐标数量${valid.length}，要求${expectedCount}`, coordinates: valid };
  for (const coordinate of valid) {
    const failures = validateCoordinate(coordinate);
    if (failures.length) return { ok: false, issue: `${coordinate.coordinateId}:${failures.join(',')}`, coordinates: valid };
  }
  const fullKeys = valid.map(coordinateKey);
  if (new Set(fullKeys).size !== fullKeys.length) return { ok: false, issue: '出现完整坐标重复', coordinates: valid };
  const causalKeys = valid.map(item => `${item.problemId}|${item.mechanismId}`);
  const requiredCausalPairs = Math.min(
    expectedCount,
    TOPIC_PROBLEMS.reduce((sum, problem) => sum + PROBLEM_MECHANISMS[problem].length, 0),
  );
  if (new Set(causalKeys).size < requiredCausalPairs) return { ok: false, issue: `问题与机制组合只有${new Set(causalKeys).size}组，至少需要${requiredCausalPairs}组`, coordinates: valid };
  const domainCount = new Set(valid.map(item => item.domainId)).size;
  const minDomains = expectedCount >= 25 ? 11 : expectedCount >= 10 ? 7 : Math.min(expectedCount, 3);
  if (domainCount < minDomains) return { ok: false, issue: `领域覆盖${domainCount}，至少需要${minDomains}`, coordinates: valid };
  return { ok: true, coordinates: valid };
}

function normalizeCoordinate(raw: RawCoordinate, index: number): TopicCoordinate | null {
  if (!raw || typeof raw !== 'object') return null;
  const domainId = clean(raw.domainId) as TopicDomainId;
  const problemId = clean(raw.problemId) as TopicProblemId;
  const objectId = clean(raw.objectId) as TopicObjectId;
  const mechanismId = clean(raw.mechanismId) as TopicMechanismId;
  const sceneId = clean(raw.sceneId) as TopicSceneId;
  const base = { domainId, problemId, objectId, mechanismId, sceneId };
  return {
    coordinateId: clean(raw.coordinateId) || `coord_${index + 1}`,
    ...base,
    scale: clean(raw.scale) as TopicScale,
    contentType: clean(raw.contentType) as TopicContentType,
    problemNote: clean(raw.problemNote), outcomeNote: clean(raw.outcomeNote),
    coordinateHash: coordinateHash(base),
  };
}

function clean(value: unknown) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''; }
function mergeUsage(a: AiUsageSummary, b: AiUsageSummary): AiUsageSummary {
  return { prompt_tokens: a.prompt_tokens + b.prompt_tokens, completion_tokens: a.completion_tokens + b.completion_tokens, total_tokens: a.total_tokens + b.total_tokens, calls: a.calls + b.calls, autofix_count: a.autofix_count + b.autofix_count, autofix_events: [...a.autofix_events, ...b.autofix_events] };
}
