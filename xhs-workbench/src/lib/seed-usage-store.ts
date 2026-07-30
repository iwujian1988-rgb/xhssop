import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { ProductId } from '@/types/data';
import type { ReferenceDrivenDraft } from '@/types/reference-workflow';

interface SeedUsageRecord {
  product_id: ProductId;
  card_id: string;
  seed_id: string;
  fingerprint: string;
  used_at: string;
}

const STORE_PATH = path.resolve(process.cwd(), 'data/seed-usage.json');
let writeQueue: Promise<void> = Promise.resolve();

export async function getRecentSeedIds(productId: ProductId, cardId: string, days = 7) {
  const records = await loadRecords();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return Array.from(new Set(records
    .filter(record => record.product_id === productId && record.card_id === cardId)
    .filter(record => Date.parse(record.used_at) >= cutoff)
    .map(record => record.seed_id)));
}

export async function recordSeedUsage(input: {
  productId: ProductId;
  cardId: string;
  draft: ReferenceDrivenDraft;
}) {
  const seedId = input.draft.brief.seed_id;
  if (!seedId) return;
  const record: SeedUsageRecord = {
    product_id: input.productId,
    card_id: input.cardId,
    seed_id: seedId,
    fingerprint: buildDraftFingerprint(input.draft),
    used_at: new Date().toISOString(),
  };
  writeQueue = writeQueue.then(async () => {
    const records = await loadRecords();
    const next = [...records, record].slice(-1000);
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    const tempPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(next, null, 2), 'utf8');
    await fs.rename(tempPath, STORE_PATH);
  });
  await writeQueue;
}

export function buildDraftFingerprint(draft: ReferenceDrivenDraft) {
  const payload = {
    seed_id: draft.brief.seed_id,
    topic: draft.brief.topic,
    evidence_ids: draft.evidence.map(item => item.id).sort(),
    cover: draft.cover.sections.map(section => ({
      heading: section.heading,
      items: section.items.map(item => `${item.primary}|${item.secondary || ''}`),
    })),
    pages: draft.inner_pages.map(page => `${page.page_type}|${page.page_title}`),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 20);
}

async function loadRecords(): Promise<SeedUsageRecord[]> {
  const raw = await fs.readFile(STORE_PATH, 'utf8').catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return '[]';
    throw cause;
  });
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as SeedUsageRecord[] : [];
  } catch {
    return [];
  }
}
