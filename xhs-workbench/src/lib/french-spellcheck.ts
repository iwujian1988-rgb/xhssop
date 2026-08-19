import nspell from 'nspell';
import frenchDictionary from 'dictionary-fr';

/**
 * The LLM-based audit in route.ts is inherently probabilistic: it can miss
 * malformed French (e.g. two connectors glued together into one nonsense
 * token like "en dépit denonobstant") because it is judging plausibility,
 * not checking against a real word list. This module adds a second,
 * deterministic layer: every Latin-script token is checked against a real
 * Hunspell French dictionary. A token either exists as a real word or it
 * doesn't - there is no ambiguity, so this catches the specific "malformed
 * word" bug class with certainty instead of relying on the model to notice.
 */

type Speller = { correct: (word: string) => boolean };

let spellerPromise: Promise<Speller> | null = null;

function getSpeller(): Promise<Speller> {
  if (!spellerPromise) {
    spellerPromise = Promise.resolve(
      nspell({ aff: Buffer.from(frenchDictionary.aff), dic: Buffer.from(frenchDictionary.dic) }) as Speller,
    );
  }
  return spellerPromise;
}

const TOKEN_PATTERN = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g;

// Brand/exam/product terms and template chrome that legitimately show up in
// Latin script but are not French vocabulary to be spell-checked.
const ALLOWLIST = new Set([
  'delf', 'tef', 'tcf', 'dalf', 'fle', 'b1', 'b2', 'c1', 'c2', 'a1', 'a2',
  'xiaohongshu', 'canada', 'québec', 'quebec', 'france', 'ok', 'subj', 'cond',
  'ircc', 'ee', 'express', 'entry', 'selection', 'category-based', 'category', 'based',
  'federal', 'immigration', 'minister', 'ministerial', 'public', 'consultation',
  // Legitimate French words that dictionary-fr incorrectly reports as
  // concatenation bugs because both halves happen to be valid words.
  // "distracteurs" = distractors (common in TEF/TCF listening/reading); split
  // into "dis"+"tracteurs" is grammatically possible but semantically absurd.
  'distracteur', 'distracteurs',
]);

function isKnownWord(speller: Speller, token: string) {
  if (speller.correct(token)) return true;
  const lower = token.toLowerCase();
  if (speller.correct(lower)) return true;
  // Elisions like "qu'il" / "d'abord" are sometimes tokenised by the
  // dictionary as separate entries either side of the apostrophe/hyphen.
  const parts = lower.split(/['’-]/).filter(Boolean);
  if (parts.length > 1 && parts.every(part => part.length <= 2 || speller.correct(part))) return true;
  return false;
}

/** Looks for a split point where a failed token decomposes into two real
 * French words glued together with no space - the exact shape of the
 * concatenation bug seen in production (e.g. "denonobstant" -> "de nonobstant"). */
function findConcatenationSplit(speller: Speller, lowerToken: string): string | null {
  for (let i = 3; i <= lowerToken.length - 3; i += 1) {
    const left = lowerToken.slice(0, i);
    const right = lowerToken.slice(i);
    if (speller.correct(left) && speller.correct(right)) return `${left} ${right}`;
  }
  return null;
}

export interface FrenchDictionaryFinding {
  location: string;
  token: string;
  /** true = high-confidence concatenation bug, should block approval; false = plain "not in dictionary", human-review-only. */
  certain: boolean;
  suggestion?: string;
}

export interface FrenchCheckTarget {
  text: string;
  location: string;
}

export async function findSuspiciousFrenchTokens(targets: FrenchCheckTarget[]): Promise<FrenchDictionaryFinding[]> {
  const speller = await getSpeller();
  const findings: FrenchDictionaryFinding[] = [];
  const seen = new Set<string>();
  for (const { text, location } of targets) {
    if (!text) continue;
    const tokens = text.match(TOKEN_PATTERN) || [];
    for (const token of tokens) {
      if (token.length < 4) continue;
      if (/^[A-Z0-9]+$/.test(token)) continue; // acronyms / all-caps
      const lower = token.toLowerCase();
      if (ALLOWLIST.has(lower)) continue;
      if (isKnownWord(speller, token)) continue;
      const key = `${location}:${lower}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const suggestion = token.length >= 7 ? findConcatenationSplit(speller, lower) : null;
      findings.push({ location, token, certain: !!suggestion, suggestion: suggestion || undefined });
    }
  }
  return findings;
}

interface CoverLike { sections: { items: { primary: string; secondary?: string }[] }[] }
interface InnerPageLike { lead: string; bullets: string[] }

export function collectFrenchCheckTargets(cover: CoverLike, innerPages: InnerPageLike[]): FrenchCheckTarget[] {
  const targets: FrenchCheckTarget[] = [];
  cover.sections.forEach((section, sectionIndex) => {
    section.items.forEach((item, itemIndex) => {
      targets.push({ text: item.primary, location: `cover.sections[${sectionIndex}].items[${itemIndex}].primary` });
      if (item.secondary) targets.push({ text: item.secondary, location: `cover.sections[${sectionIndex}].items[${itemIndex}].secondary` });
    });
  });
  innerPages.forEach((page, pageIndex) => {
    targets.push({ text: page.lead, location: `inner_pages[${pageIndex}].lead` });
    page.bullets.forEach((bullet, bulletIndex) => {
      targets.push({ text: bullet, location: `inner_pages[${pageIndex}].bullets[${bulletIndex}]` });
    });
  });
  return targets;
}
