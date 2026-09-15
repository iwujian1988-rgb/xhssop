/* eslint-disable no-console */
import fs from 'node:fs/promises';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { resolveProductEvidence } from '../src/lib/product-fact-retrieval';

const inputPath = process.env.TEST_INPUT || 'v2-real-smoke-tef-latest.json';
const productId = (process.env.TEST_PRODUCT_ID || 'tef_tcf_canada') as 'delf_b2_writing' | 'tef_tcf_canada';
const source = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const row = Array.isArray(source) ? source.find(item => item.product_id === productId) : source;
if (!row?.topic) throw new Error(`No reusable topic for ${productId} in ${inputPath}`);
const facts = await loadProductFacts(productId);
const evidence = await resolveProductEvidence(productId, facts, row.topic, 10);
console.log(JSON.stringify(evidence.map(item => ({ id: item.id, category: item.category, text: item.text })), null, 2));
