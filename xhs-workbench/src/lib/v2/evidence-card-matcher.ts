import cardsJson from '../../../data/evidence-cards/delf-b2-inner-facts.json';
import type { EvidenceSnippet } from '@/types/reference-workflow';
import type { UserVisiblePagePlan } from './contracts';

export interface EvidenceCardSource {
  name: string;
  section: string;
  url: string;
  verifiedBasis: string;
}

export interface EvidenceCard {
  id: string;
  category: string;
  fact: string;
  boundary: string;
  exactTriggers: string[];
  triggerGroups: string[][];
  broadTriggers: string[];
  negativeTriggers: string[];
  /** Legacy input accepted while the existing 14 cards are migrated in place. */
  applicableTriggers?: string[];
  source: EvidenceCardSource;
}

export interface EvidenceCardMatch extends EvidenceSnippet {
  applicablePageIds: string[];
  matchedTriggers: string[];
  matchLevel: 'exact' | 'combination';
}

const LEGACY_BROAD_TRIGGERS = new Set([
  '正式', '逻辑', '连贯', '语气', '高分', '表达', '阅卷人', '考官', '写作', '语法',
  '必须', '不能', '得分', '扣分', '失分', '因果关系', '改写', '仿写', '语域', '衔接',
  '语域与语气的适切性判断', '语域与语气适切', '语域语气适切', '语域与语气', '语域语气',
  '连接词改写', '解释原因', '结果关系', '达标示例', '失分示例',
].map(normalize));
const CARDS = validateCards(cardsJson);

export function listDelfB2InnerEvidenceCards(): EvidenceCard[] {
  return CARDS.map(card => ({
    ...card,
    exactTriggers: [...card.exactTriggers],
    triggerGroups: card.triggerGroups.map(group => [...group]),
    broadTriggers: [...card.broadTriggers],
    negativeTriggers: [...card.negativeTriggers],
    source: { ...card.source },
  }));
}

export function matchDelfB2InnerEvidenceCards(
  pages: UserVisiblePagePlan[],
  options: { maxPerPage?: number; maxTotal?: number } = {},
): EvidenceCardMatch[] {
  const maxPerPage = Math.max(0, options.maxPerPage ?? 4);
  const maxTotal = Math.max(0, options.maxTotal ?? 10);
  if (!maxPerPage || !maxTotal) return [];

  const aggregated = new Map<string, {
    card: EvidenceCard;
    pageIds: Set<string>;
    triggers: Set<string>;
    score: number;
    matchLevel: EvidenceCardMatch['matchLevel'];
  }>();

  for (const page of pages) {
    const pageText = `${page.pageGoal} ${page.userGets} ${page.pageContentPlan}`;
    const pageMatches = CARDS.map(card => scoreCard(card, pageText))
      .filter((match): match is { card: EvidenceCard; score: number; matchedTriggers: string[]; matchLevel: EvidenceCardMatch['matchLevel'] } => Boolean(match))
      .sort((left, right) => {
        if (left.matchLevel !== right.matchLevel) return left.matchLevel === 'exact' ? -1 : 1;
        return right.score - left.score || categoryPriority(right.card.category) - categoryPriority(left.card.category)
          || left.card.id.localeCompare(right.card.id);
      })
      .slice(0, maxPerPage);

    for (const match of pageMatches) {
      const current = aggregated.get(match.card.id) || {
        card: match.card,
        pageIds: new Set<string>(),
        triggers: new Set<string>(),
        score: 0,
        matchLevel: match.matchLevel,
      };
      current.pageIds.add(page.pageId);
      match.matchedTriggers.forEach(trigger => current.triggers.add(trigger));
      current.score += match.score;
      if (match.matchLevel === 'exact') current.matchLevel = 'exact';
      aggregated.set(match.card.id, current);
    }
  }

  return [...aggregated.values()]
    .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id))
    .slice(0, maxTotal)
    .map(({ card, pageIds, triggers, score, matchLevel }) => ({
      id: card.id,
      category: card.category,
      text: card.fact,
      evidence: card.fact,
      source_file: card.source.url,
      source_section: `${card.source.name} · ${card.source.section}`,
      score,
      source_role: 'dynamic',
      source_excerpt: card.source.verifiedBasis,
      usage_caution: card.boundary,
      applicablePageIds: [...pageIds],
      matchedTriggers: [...triggers],
      matchLevel,
    }));
}

function scoreCard(card: EvidenceCard, pageText: string) {
  if (card.negativeTriggers.some(trigger => matchesTrigger(pageText, trigger))) return null;
  const exactMatches = card.exactTriggers.filter(trigger => matchesTrigger(pageText, trigger));
  const groupMatches = card.triggerGroups.filter(group => group.every(trigger => matchesTrigger(pageText, trigger)));
  if (!exactMatches.length && !groupMatches.length) return null;
  const broadMatches = card.broadTriggers.filter(trigger => matchesTrigger(pageText, trigger));
  const matchedTriggers = Array.from(new Set([...exactMatches, ...groupMatches.flat(), ...broadMatches]));
  const exactScores = exactMatches.map(trigger => 100 + normalize(trigger).length + (isSpecificLatinPhrase(trigger) ? 100 : 0));
  const groupScores = groupMatches.map(group => 50 + group.reduce((length, trigger) => length + normalize(trigger).length, 0));
  const score = (exactScores.length ? Math.max(...exactScores) + Math.max(0, exactScores.length - 1) * 5 : 0)
    + (groupScores.length ? Math.max(...groupScores) + Math.max(0, groupScores.length - 1) * 2 : 0)
    + broadMatches.length;
  return { card, score, matchedTriggers, matchLevel: exactMatches.length ? 'exact' as const : 'combination' as const };
}

function isSpecificLatinPhrase(trigger: string) {
  return /[a-zà-ÿ]/iu.test(trigger) && /[\s'’]/u.test(trigger.trim());
}

function categoryPriority(category: string) {
  if (category === 'grammar_form') return 4;
  if (category === 'official_exam_fact') return 3;
  if (category === 'connector_semantics') return 2;
  return 1;
}

function validateCards(value: unknown): EvidenceCard[] {
  if (!Array.isArray(value)) throw new Error('INVALID_DELF_B2_EVIDENCE_CARDS:not_array');
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`INVALID_DELF_B2_EVIDENCE_CARD:${index}`);
    const item = raw as Partial<EvidenceCard>;
    const source = item.source as Partial<EvidenceCardSource> | undefined;
    const legacyTriggers = cleanStrings(item.applicableTriggers);
    const exactTriggers = cleanStrings(item.exactTriggers).concat(
      legacyTriggers.filter(trigger => !LEGACY_BROAD_TRIGGERS.has(normalize(trigger))),
    );
    const triggerGroups = Array.isArray(item.triggerGroups)
      ? item.triggerGroups.map(group => cleanStrings(group)).filter(group => group.length >= 2)
      : [];
    if (!item.id || !item.category || !item.fact || !item.boundary
      || (!exactTriggers.length && !triggerGroups.length)
      || !source?.name || !source.section || !source.url) {
      throw new Error(`INVALID_DELF_B2_EVIDENCE_CARD:${item.id || index}`);
    }
    if (ids.has(item.id)) throw new Error(`DUPLICATE_DELF_B2_EVIDENCE_CARD:${item.id}`);
    ids.add(item.id);
    return {
      id: item.id,
      category: item.category,
      fact: item.fact,
      boundary: item.boundary,
      exactTriggers,
      triggerGroups,
      broadTriggers: Array.from(new Set(cleanStrings(item.broadTriggers).concat(
        legacyTriggers.filter(trigger => LEGACY_BROAD_TRIGGERS.has(normalize(trigger))),
      ))),
      negativeTriggers: cleanStrings(item.negativeTriggers),
      source: {
        name: source.name,
        section: source.section,
        url: source.url,
        verifiedBasis: source.verifiedBasis || `已按“${source.section}”核对该事实边界。`,
      },
    };
  });
}

function cleanStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim())
    : [];
}

function matchesTrigger(text: string, trigger: string) {
  const trimmed = trigger.trim();
  if (/^[\p{L}\p{N}'’ -]+$/u.test(trimmed) && /[a-zà-ÿ]/iu.test(trimmed)) {
    const escaped = trimmed.normalize('NFKC').toLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
      .replace(/[’']/gu, "['’]")
      .replace(/\s+/gu, '\\s+');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu')
      .test(text.normalize('NFKC').toLowerCase());
  }
  return normalize(text).includes(normalize(trimmed));
}

function normalize(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[\s'’“”"`·—–\-_/：:；;，,。.!！?？()（）\[\]{}]/gu, '');
}
