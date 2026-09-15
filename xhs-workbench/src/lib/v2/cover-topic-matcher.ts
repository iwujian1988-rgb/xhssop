import type { CompetitorCreativeCard, ContentShape } from '@/types/reference-workflow';
import type { TemplateCapability } from './contracts';
import type { TopicContentType, TopicCoordinate, TopicScale } from './topic-coordinate-taxonomy';

/**
 * A slot is one user-selected cover occurrence. The same card may appear more than
 * once, but every occurrence needs its own stable slotId.
 */
export interface CoverCapabilitySlot {
  slotId: string;
  card: CompetitorCreativeCard;
  capability: TemplateCapability;
}

export interface CoverTopicMatch {
  slotId: string;
  card: CompetitorCreativeCard;
  capability: TemplateCapability;
  coordinate: TopicCoordinate;
  coordinateId: string;
  coordinateHash: string;
  score: number;
  reasons: string[];
}

export interface CoverTopicMatchWarning {
  code: 'unsupported_card' | 'renderer_mismatch' | 'weak_content_type_fit' | 'weak_scale_fit';
  slotId: string;
  coordinateId?: string;
  message: string;
}

export interface CoverTopicMatchResult {
  matches: CoverTopicMatch[];
  warnings: CoverTopicMatchWarning[];
}

type RankedPreferences<T extends string> = Record<ContentShape, readonly T[]>;

const CONTENT_TYPE_PREFERENCES: RankedPreferences<TopicContentType> = {
  directory: ['summary', 'reference', 'guide', 'exercise', 'hack', 'pain'],
  phrase: ['reference', 'summary', 'exercise', 'guide', 'hack', 'pain'],
  offer: ['pain', 'guide', 'summary', 'hack', 'reference', 'exercise'],
  flashcard: ['reference', 'summary', 'exercise', 'guide', 'hack', 'pain'],
  book: ['summary', 'guide', 'reference', 'hack', 'pain', 'exercise'],
  pain: ['pain', 'hack', 'guide', 'summary', 'exercise', 'reference'],
  experience: ['pain', 'guide', 'hack', 'summary', 'exercise', 'reference'],
  document: ['reference', 'exercise', 'guide', 'summary', 'hack', 'pain'],
  table: ['reference', 'summary', 'exercise', 'guide', 'hack', 'pain'],
  roadmap: ['guide', 'hack', 'summary', 'exercise', 'pain', 'reference'],
};

const SCALE_PREFERENCES: RankedPreferences<TopicScale> = {
  directory: ['reference', 'broad', 'strategy', 'specific'],
  phrase: ['reference', 'specific', 'strategy', 'broad'],
  offer: ['broad', 'strategy', 'reference', 'specific'],
  flashcard: ['reference', 'specific', 'strategy', 'broad'],
  book: ['broad', 'strategy', 'reference', 'specific'],
  pain: ['broad', 'strategy', 'specific', 'reference'],
  experience: ['broad', 'strategy', 'specific', 'reference'],
  document: ['reference', 'specific', 'strategy', 'broad'],
  table: ['reference', 'specific', 'strategy', 'broad'],
  roadmap: ['strategy', 'broad', 'specific', 'reference'],
};

const CONTENT_TYPE_SCORES = [64, 48, 34, 22, 10, 0] as const;
const SCALE_SCORES = [32, 24, 14, 4] as const;

/**
 * Assigns the complete locked coordinate list to the complete user-selected slot
 * list. It is deterministic, makes no AI/network calls, and never mutates either
 * input. A maximum-weight assignment is used so an early slot cannot greedily
 * consume a coordinate that is substantially better for a later slot.
 */
export function matchTopicCoordinatesToCoverSlots(
  coordinates: readonly TopicCoordinate[],
  slots: readonly CoverCapabilitySlot[],
): CoverTopicMatchResult {
  validateInputs(coordinates, slots);
  if (coordinates.length === 0) return { matches: [], warnings: [] };

  const evaluations = slots.map(slot => coordinates.map(coordinate => evaluateFit(coordinate, slot.capability.family)));
  const assignment = maximumWeightAssignment(evaluations.map(row => row.map(item => item.score)));
  const warnings: CoverTopicMatchWarning[] = [];

  const matches = slots.map((slot, slotIndex): CoverTopicMatch => {
    const coordinateIndex = assignment[slotIndex]!;
    const coordinate = coordinates[coordinateIndex]!;
    const fit = evaluations[slotIndex]![coordinateIndex]!;

    if (!slot.card.supported) {
      warnings.push({ code: 'unsupported_card', slotId: slot.slotId, coordinateId: coordinate.coordinateId, message: `名额 ${slot.slotId} 的封面 ${slot.card.id} 标记为不可用；为保持名额一次且仅一次，仍保留匹配。` });
    }
    if (slot.card.renderer_id !== slot.capability.renderer) {
      warnings.push({ code: 'renderer_mismatch', slotId: slot.slotId, coordinateId: coordinate.coordinateId, message: `名额 ${slot.slotId} 的 card renderer 与 capability renderer 不一致。` });
    }
    if (fit.contentTypeRank >= 3) {
      warnings.push({ code: 'weak_content_type_fit', slotId: slot.slotId, coordinateId: coordinate.coordinateId, message: `${coordinate.contentType} 与 ${slot.capability.family} 模板的信息组织方式适配较弱。` });
    }
    if (fit.scaleRank >= 3) {
      warnings.push({ code: 'weak_scale_fit', slotId: slot.slotId, coordinateId: coordinate.coordinateId, message: `${coordinate.scale} 规模与 ${slot.capability.family} 模板适配较弱。` });
    }

    return {
      slotId: slot.slotId,
      card: slot.card,
      capability: slot.capability,
      coordinate,
      coordinateId: coordinate.coordinateId,
      coordinateHash: coordinate.coordinateHash,
      score: fit.score,
      reasons: fit.reasons,
    };
  });

  return { matches, warnings };
}

/** Short alias for callers that already describe their inputs as locked. */
export const matchLockedCoordinatesToCovers = matchTopicCoordinatesToCoverSlots;

function validateInputs(coordinates: readonly TopicCoordinate[], slots: readonly CoverCapabilitySlot[]) {
  if (coordinates.length !== slots.length) {
    throw new Error(`坐标数量 ${coordinates.length} 与封面名额数量 ${slots.length} 不一致，无法保证每个名额一次且仅一次`);
  }
  const coordinateIds = coordinates.map(item => item.coordinateId);
  if (new Set(coordinateIds).size !== coordinateIds.length) throw new Error('锁定坐标列表存在重复 coordinateId');
  const coordinateHashes = coordinates.map(item => item.coordinateHash);
  if (new Set(coordinateHashes).size !== coordinateHashes.length) throw new Error('锁定坐标列表存在重复 coordinateHash');
  const slotIds = slots.map(item => item.slotId);
  if (slotIds.some(id => !id.trim())) throw new Error('封面名额缺少 slotId');
  if (new Set(slotIds).size !== slotIds.length) throw new Error('封面名额存在重复 slotId');
}

function evaluateFit(coordinate: TopicCoordinate, family: ContentShape) {
  const contentTypeRank = CONTENT_TYPE_PREFERENCES[family].indexOf(coordinate.contentType);
  const scaleRank = SCALE_PREFERENCES[family].indexOf(coordinate.scale);
  const contentScore = CONTENT_TYPE_SCORES[contentTypeRank] ?? 0;
  const scaleScore = SCALE_SCORES[scaleRank] ?? 0;
  return {
    score: contentScore + scaleScore,
    contentTypeRank,
    scaleRank,
    reasons: [
      `contentType=${coordinate.contentType}→family=${family}（优先级${contentTypeRank + 1}）`,
      `scale=${coordinate.scale}→family=${family}（优先级${scaleRank + 1}）`,
    ],
  };
}

/**
 * Hungarian algorithm for a square maximum-weight assignment. Returns, for each
 * row (cover slot), the selected column (coordinate). O(n^3), suitable for 10–25.
 */
function maximumWeightAssignment(weights: readonly (readonly number[])[]): number[] {
  const size = weights.length;
  const maxWeight = Math.max(...weights.flat());
  const u = Array<number>(size + 1).fill(0);
  const v = Array<number>(size + 1).fill(0);
  const p = Array<number>(size + 1).fill(0);
  const way = Array<number>(size + 1).fill(0);

  for (let row = 1; row <= size; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minValue = Array<number>(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array<boolean>(size + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = p[column0]!;
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= size; column += 1) {
        if (used[column]) continue;
        const cost = maxWeight - weights[row0 - 1]![column - 1]!;
        const current = cost - u[row0]! - v[column]!;
        if (current < minValue[column]!) {
          minValue[column] = current;
          way[column] = column0;
        }
        if (minValue[column]! < delta) {
          delta = minValue[column]!;
          column1 = column;
        }
      }
      for (let column = 0; column <= size; column += 1) {
        if (used[column]) {
          u[p[column]!] += delta;
          v[column]! -= delta;
        } else {
          minValue[column]! -= delta;
        }
      }
      column0 = column1;
    } while (p[column0] !== 0);

    do {
      const column1 = way[column0]!;
      p[column0] = p[column1]!;
      column0 = column1;
    } while (column0 !== 0);
  }

  const assignment = Array<number>(size).fill(-1);
  for (let column = 1; column <= size; column += 1) assignment[p[column]! - 1] = column - 1;
  return assignment;
}
