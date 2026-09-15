import { planBatchTopicMap } from '../src/lib/v2/batch-topic-map';

const count = Math.max(1, Math.min(25, Number(process.argv[2] || 10)));
const result = await planBatchTopicMap({
  productId: 'delf_b2_writing',
  count,
  usageHints: [],
});

console.log(JSON.stringify({
  count: result.coordinates.length,
  domains: new Set(result.coordinates.map(item => item.domainId)).size,
  causalPairs: new Set(result.coordinates.map(item => `${item.problemId}|${item.mechanismId}`)).size,
  fullCoordinates: new Set(result.coordinates.map(item => item.coordinateHash)).size,
  scales: Object.fromEntries(result.coordinates.map(item => item.scale).map(key => [key, result.coordinates.filter(item => item.scale === key).length])),
  contentTypes: Object.fromEntries(result.coordinates.map(item => item.contentType).map(key => [key, result.coordinates.filter(item => item.contentType === key).length])),
  warnings: result.warnings,
  usage: result.usage,
}, null, 2));
