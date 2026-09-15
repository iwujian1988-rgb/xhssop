import { planBatchTopicMap, type TopicCoordinateUsageHint } from '../src/lib/v2/batch-topic-map';
import { coordinateKey } from '../src/lib/v2/topic-coordinate-taxonomy';

const runs = Math.max(2, Math.min(5, Number(process.argv[2] || 3)));
const count = Math.max(1, Math.min(25, Number(process.argv[3] || 10)));
const usage = new Map<string, TopicCoordinateUsageHint>();
const batches: string[][] = [];

for (let run = 0; run < runs; run += 1) {
  const result = await planBatchTopicMap({
    productId: 'delf_b2_writing',
    count,
    usageHints: [...usage.values()],
  });
  const keys = result.coordinates.map(coordinateKey);
  batches.push(keys);
  for (const key of keys) {
    const previous = usage.get(key);
    usage.set(key, {
      coordinateKey: key,
      useCount: (previous?.useCount || 0) + 1,
      lastSuccessAt: new Date(Date.UTC(2026, 7, 1 + run)).toISOString(),
    });
  }
}

const comparisons = batches.slice(1).map((batch, index) => {
  const previous = new Set(batches[index]);
  return {
    pair: `${index + 1}->${index + 2}`,
    exactCoordinateOverlap: batch.filter(key => previous.has(key)).length,
  };
});
console.log(JSON.stringify({ runs, count, comparisons, uniqueCoordinates: new Set(batches.flat()).size }, null, 2));
