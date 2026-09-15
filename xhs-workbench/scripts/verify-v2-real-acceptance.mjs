import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const htmlPath = path.join(root, 'v2-real-acceptance.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const images = [...html.matchAll(/src="([^"]+)/g)].map((match) => match[1]);
const missing = images.filter((image) => !fs.existsSync(path.resolve(root, image)));
if (missing.length) throw new Error(`Missing images: ${missing.join(', ')}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.goto(`file:///${htmlPath.replaceAll('\\', '/')}`);
const jobs = await page.locator('article.job').count();
await page.screenshot({ path: path.join(root, 'v2-real-acceptance-page.png'), fullPage: true });
await browser.close();
if (jobs !== 10) throw new Error(`Expected 10 jobs, got ${jobs}`);
console.log(JSON.stringify({ ok: true, jobs, images: images.length, missing, title: 'V2 DeepSeek 真实链路验收' }, null, 2));
