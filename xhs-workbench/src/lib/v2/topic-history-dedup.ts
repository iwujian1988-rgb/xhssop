import { jaccardSimilarity, tokenizeTopic } from '@/lib/title-usage-store';

export type TopicHistoryDedupMode = 'off' | 'shadow' | 'enforce';

export interface HistoricalTopicMatch {
  similar: string;
  score: number;
  reason: 'same_causal_pair' | 'same_content_mechanism' | 'near_duplicate_wording';
}

const DOMAIN_WORDS = /(?:delf|b2|法语|写作|作文|备考|考试|考生)/giu;

const PAIN_FACETS: Array<[string, RegExp]> = [
  ['word_count', /(?:250\s*词|字数|写不够|写不满|凑字|内容单薄)/iu],
  ['register', /(?:中式法语|中式直译|翻译腔|语体|正式文体|口语词)/iu],
  ['time_pressure', /(?:1\s*小时|时间不够|来不及|考前|冲刺|最后一个月)/iu],
  ['argument_stuck', /(?:论证|观点.{0,8}(?:展开|卡|单薄)|没话说|思路.{0,5}(?:卡|断))/iu],
  ['grammar_error', /(?:虚拟式|直陈式|性数配合|时态|语法.{0,6}(?:错|错误))/iu],
  ['revision_blind', /(?:不知道怎么改|不会检查|自查.{0,5}(?:漏|不会)|写完.{0,8}(?:没底|慌|不知道))/iu],
  ['transfer_failure', /(?:背了范文.{0,8}不会|换题.{0,8}不会|模板.{0,8}套不上|不会迁移)/iu],
  // 大痛点型的新表达不能因为没有“250词/连接词”等旧标签就绕过批内去重。
  ['practice_plateau', /(?:写了\s*\d+\s*篇|刷了.{0,6}(?:题|篇)|无效练习|无效刷题|原地踏步|卡在.{0,5}(?:分|档)|(?:分数|写作).{0,6}瓶颈|练了.{0,12}(?:没进步|没有进步))/iu],
  ['sprint_stop_loss', /(?:考前\s*\d+\s*天|考前止损|冲刺.{0,8}(?:止损|排雷)|最后.{0,5}(?:天|周))/iu],
];

const SOLUTION_FACETS: Array<[string, RegExp]> = [
  ['argument_expansion', /(?:原因.{0,4}例子|观点.{0,6}例子|因果链|让步.{0,5}转折|扩句|扩写|展开公式|组合拳)/iu],
  ['expression_bank', /(?:高级词|词汇|词块|句型|连接词|表达|搭配|替换词)/iu],
  ['workflow', /(?:流程|路线图|节奏|从审题到|骨架搭建|复习顺序|步骤)/iu],
  ['self_check', /(?:自查|检查清单|排雷|雷区|避坑|对照表)/iu],
  ['grammar_rule', /(?:虚拟式|直陈式|性数配合|语法规则|时态|语式)/iu],
  ['model_transfer', /(?:范文.{0,6}(?:拆|迁移|仿写)|模板.{0,6}(?:改|迁移)|旧信改新题)/iu],
  ['task_drill', /(?:题型|刷题|练习题|题库|真题)/iu],
  ['diagnostic_feedback', /(?:精准诊断|自我诊断|评分维度|反馈闭环|评估标准|定位短板)/iu],
  ['stop_loss_strategy', /(?:停掉|低效动作|时间留给|优先(?:练|做)|止损指南|冲刺排雷)/iu],
  ['register_rewrite', /(?:中式直译|地道法语|法言法语|(?:口语|微信体).{0,8}(?:正式|投诉信)|改成.{0,8}(?:地道|正式))/iu],
];

const OBJECT_FACETS: Array<[string, RegExp]> = [
  ['formal_letter', /(?:正式信|建议信|投诉信|申请信)/iu],
  ['argument_paragraph', /(?:议论文|论证段|观点段|段落)/iu],
  ['opening_ending', /(?:开头|结尾|称呼|落款)/iu],
  ['cohesion', /(?:连贯|衔接|连接)/iu],
  ['scoring', /(?:评分|得分|丢分|扣分|评分维度)/iu],
];

function facets(text: string, rules: Array<[string, RegExp]>) {
  return new Set(rules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name));
}

function sharedCount(a: Set<string>, b: Set<string>) {
  let count = 0;
  for (const value of a) if (b.has(value)) count += 1;
  return count;
}

function noveltyTokens(text: string) {
  return tokenizeTopic(text.replace(DOMAIN_WORDS, ''));
}

/**
 * Cross-day comparison deliberately checks a causal pair instead of sampling
 * independent labels. The same pain with a genuinely different intervention
 * is allowed; wording-only rewrites or the same pain+mechanism are rejected.
 */
export function findHistoricalTopicMatch(topic: string, recentTopics: readonly string[]): HistoricalTopicMatch | null {
  if (!topic || recentTopics.length === 0) return null;
  const topicPain = facets(topic, PAIN_FACETS);
  const topicSolution = facets(topic, SOLUTION_FACETS);
  const topicObject = facets(topic, OBJECT_FACETS);
  const topicTokens = noveltyTokens(topic);
  let best: HistoricalTopicMatch | null = null;

  for (const recent of recentTopics) {
    if (!recent || recent === topic) {
      if (recent === topic) return { similar: recent, score: 1, reason: 'near_duplicate_wording' };
      continue;
    }
    const recentPain = facets(recent, PAIN_FACETS);
    const recentSolution = facets(recent, SOLUTION_FACETS);
    const recentObject = facets(recent, OBJECT_FACETS);
    const sharedPain = sharedCount(topicPain, recentPain);
    const sharedSolution = sharedCount(topicSolution, recentSolution);
    const sharedObject = sharedCount(topicObject, recentObject);
    const lexical = jaccardSimilarity(topicTokens, noveltyTokens(recent));

    // If both topics name different concrete interventions, sharing a symptom
    // alone is not repetition (e.g. word-count pain + vocabulary vs argument expansion).
    const hasDistinctSolutions = topicSolution.size > 0 && recentSolution.size > 0 && sharedSolution === 0;
    let match: HistoricalTopicMatch | null = null;
    if (sharedPain > 0 && sharedSolution > 0) {
      match = { similar: recent, score: Math.max(0.88, lexical), reason: 'same_causal_pair' };
    } else if (!hasDistinctSolutions && sharedSolution > 0 && sharedObject > 0) {
      match = { similar: recent, score: Math.max(0.82, lexical), reason: 'same_content_mechanism' };
    } else if (!hasDistinctSolutions && lexical >= 0.58) {
      match = { similar: recent, score: lexical, reason: 'near_duplicate_wording' };
    }
    if (match && (!best || match.score > best.score)) best = match;
  }
  return best;
}

/** Fixed-size prompt sample: one recent representative per causal signature. */
export function selectRecentTopicRepresentatives(recentTopics: readonly string[], limit = 10) {
  const selected: string[] = [];
  const signatures = new Set<string>();
  for (const topic of [...recentTopics].reverse()) {
    const signature = [
      [...facets(topic, PAIN_FACETS)].sort().join(','),
      [...facets(topic, SOLUTION_FACETS)].sort().join(','),
      [...facets(topic, OBJECT_FACETS)].sort().join(','),
    ].join('|');
    const key = signature === '||' ? topic.replace(DOMAIN_WORDS, '').slice(0, 24) : signature;
    if (signatures.has(key)) continue;
    signatures.add(key);
    selected.push(topic);
    if (selected.length >= limit) break;
  }
  return selected.reverse();
}

export function resolveTopicHistoryDedupMode(): TopicHistoryDedupMode {
  const value = (process.env.XHS_TOPIC_HISTORY_DEDUP_MODE || 'enforce').trim().toLowerCase();
  if (value === 'off' || value === 'shadow') return value;
  return 'enforce';
}
