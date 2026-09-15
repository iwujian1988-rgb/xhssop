import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HUMANIZER_PAIRS_FILENAME = 'data/title-humanizer-user-approved.json';

export interface TitleHumanizerPair {
  before: string;
  after: string;
  clickReason: string;
  voiceTags: string[];
  topicKeywords: string[];
  track: string;
}

interface RawTitleHumanizerPair {
  before?: unknown;
  after?: unknown;
  click_reason?: unknown;
  voice_tags?: unknown;
  topic_keywords?: unknown;
  track?: unknown;
}

let testOverride: TitleHumanizerPair[] | null = null;

export function setTitleHumanizerPairsForTest(pairs: TitleHumanizerPair[] | null): void {
  testOverride = pairs;
}

function resolvePairsPath(): string {
  const cwdCandidate = path.resolve(process.cwd(), HUMANIZER_PAIRS_FILENAME);
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const moduleCandidate = path.resolve(moduleDir, '../../../', HUMANIZER_PAIRS_FILENAME);
    if (fs.existsSync(moduleCandidate)) return moduleCandidate;
  } catch {
    // Bundled runtimes may not expose a usable import.meta.url.
  }
  return cwdCandidate;
}

function readPairs(): TitleHumanizerPair[] {
  if (testOverride !== null) return testOverride.slice();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvePairsPath(), 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const pairs: TitleHumanizerPair[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as RawTitleHumanizerPair;
    if (typeof raw.before !== 'string' || !raw.before.trim()) continue;
    if (typeof raw.after !== 'string' || !raw.after.trim()) continue;
    if (typeof raw.click_reason !== 'string' || !raw.click_reason.trim()) continue;
    pairs.push({
      before: raw.before.trim(),
      after: raw.after.trim(),
      clickReason: raw.click_reason.trim(),
      voiceTags: Array.isArray(raw.voice_tags) ? raw.voice_tags.filter((value): value is string => typeof value === 'string') : [],
      topicKeywords: Array.isArray(raw.topic_keywords) ? raw.topic_keywords.filter((value): value is string => typeof value === 'string') : [],
      track: typeof raw.track === 'string' ? raw.track.trim() : '',
    });
  }
  return pairs;
}

export function getTitleHumanizerPairs(productId: string, cues: string, limit = 6): TitleHumanizerPair[] {
  const normalizedCues = cues.toLocaleLowerCase();
  return readPairs()
    .filter(pair => pair.track === '' || pair.track === productId)
    .map((pair, index) => ({
      pair,
      index,
      score: pair.topicKeywords.reduce(
        (sum, keyword) => sum + (normalizedCues.includes(keyword.toLocaleLowerCase()) ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map(item => item.pair);
}

export function formatTitleHumanizerPair(pair: TitleHumanizerPair): Record<string, unknown> {
  return {
    editor_voice: pair.before,
    human_voice: pair.after,
    unchanged_click_reason: pair.clickReason,
    voice_tags: pair.voiceTags,
  };
}
