/* eslint-disable no-console */
/**
 * 把 tmp-preview-rendered.html 里每个 .cell 渲染成独立 PNG。
 * 输出到 tmp-cover-screenshots/<card_id>__<job_id>.png
 *
 * 用 Playwright Chromium；container query 需要 Chromium 105+。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const HTML_PATH = path.resolve('tmp-preview-rendered.html');
const OUT_DIR = path.resolve('tmp-cover-screenshots');

const CELL_WIDTH = 600; // 模拟小红书卡片实际渲染宽度（信息流点击后大图）
const CELL_HEIGHT = 800;

async function main() {
  if (!fs.existsSync(HTML_PATH)) {
    throw new Error(`找不到 ${HTML_PATH}，先跑 render-batch-covers.mjs`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // 清空旧 PNG
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: CELL_WIDTH + 80, height: CELL_HEIGHT + 200 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(`file:///${HTML_PATH.replace(/\\/g, '/')}`, { waitUntil: 'load' });
  // 强制每个 cover-wrap 渲染在固定生产宽度下，避免 auto-fill grid 把卡片挤太小
  await page.addStyleTag({
    content: `
      .row { display: block !important; }
      .cell { width: ${CELL_WIDTH}px !important; max-width: ${CELL_WIDTH}px !important; margin: 0 auto 24px !important; }
      .cover-wrap { width: ${CELL_WIDTH}px !important; max-width: ${CELL_WIDTH}px !important; }
      /* 注入与生产一致的 --fit-scale 乘子（生产 CSS 摘自 ReferenceCoverRenderer.tsx），
         让 useAutoFitScale 复刻逻辑能真正生效 */
      .rc-offer-groups h2 { font-size: clamp(15px, calc(3.75cqw * var(--fit-scale, 1)), 31px) !important; }
      .rc-offer-groups p { margin-top: calc(.75cqw * var(--fit-scale, 1)) !important; font-size: clamp(13px, calc(3.48cqw * var(--fit-scale, 1)), 29px) !important; }
      .rc-memo-sections section { margin-bottom: calc(4.1cqw * var(--fit-scale, 1)) !important; }
      .rc-memo-sections h2 { font-size: clamp(14px, calc(4.55cqw * var(--fit-scale, 1)), 34px) !important; }
      .rc-memo-sections p { margin-top: calc(1.15cqw * var(--fit-scale, 1)) !important; font-size: clamp(11px, calc(3.95cqw * var(--fit-scale, 1)), 30px) !important; }
      .rc-word-grid strong { font-size: clamp(14px, calc(6.25cqw * var(--fit-scale, 1)), 50px) !important; }
      .rc-word-grid span { margin-top: calc(1.05cqw * var(--fit-scale, 1)) !important; font-size: clamp(9px, calc(3.05cqw * var(--fit-scale, 1)), 24px) !important; }
      .rc-word-grid em { margin-top: calc(.65cqw * var(--fit-scale, 1)) !important; font-size: clamp(8px, calc(2.55cqw * var(--fit-scale, 1)), 20px) !important; }
      .rc-notebook-lines span { font-size: clamp(12px, calc(4.65cqw * var(--fit-scale, 1)), 37px) !important; }
      .rc-notebook-lines .big span { font-size: clamp(16px, calc(6.4cqw * var(--fit-scale, 1)), 51px) !important; }
      .rc-experience-paragraph { margin-top: calc(5cqw * var(--fit-scale, 1)) !important; font-size: clamp(12px, calc(4.5cqw * var(--fit-scale, 1)), 36px) !important; }
      .rc-doc-content section { margin-top: calc(1.4cqw * var(--fit-scale, 1)) !important; }
      .rc-doc-content h2 { font-size: clamp(9px, calc(2.5cqw * var(--fit-scale, 1)), 20px) !important; }
      .rc-doc-content p { margin-top: calc(.5cqw * var(--fit-scale, 1)) !important; font-size: clamp(9px, calc(3.1cqw * var(--fit-scale, 1)), 25px) !important; }
      .grid-purple-sections h2 { margin-bottom: calc(.65cqw * var(--fit-scale, 1)) !important; font-size: clamp(13px, calc(3.1cqw * var(--fit-scale, 1)), 25px) !important; }
      .grid-purple-table > div { min-height: calc(4.2cqw * var(--fit-scale, 1)) !important; font-size: clamp(10px, calc(2.15cqw * var(--fit-scale, 1)), 17px) !important; }
      .rc-collocation h2 { padding: calc(.6cqw * var(--fit-scale, 1)) !important; font-size: clamp(9px, calc(2.7cqw * var(--fit-scale, 1)), 21px) !important; }
      .rc-collocation section p { font-size: clamp(8.5px, calc(2.3cqw * var(--fit-scale, 1)), 18px) !important; }
    `,
  });
  // 等待 container query 应用 & 字体加载
  await page.waitForTimeout(800);

  // 复刻生产端 useAutoFitScale：对每个带 fit 类的容器逐步降 --fit-scale 直至内容塞得下
  // （生产组件在 React useLayoutEffect 里跑同一段逻辑，见 src/components/templates/useAutoFitScale.ts）
  await page.evaluate(() => {
    const FIT_SELECTORS = [
      '.rc-memo-sections', '.rc-offer-groups', '.rc-word-grid',
      '.rc-notebook-lines', '.rc-experience-body', '.rc-doc-content',
      '.rc-collocation-cols', '.grid-purple-sections',
    ];
    const FIT_CFG = [
      { min: 0.55, max: 1, step: 0.025 },
      { min: 0.55, max: 1, step: 0.025 },
      { min: 0.5, max: 1, step: 0.03 },
      { min: 0.55, max: 1, step: 0.025 },
      { min: 0.5, max: 1, step: 0.025 },
      { min: 0.5, max: 1, step: 0.025 },
      { min: 0.45, max: 1, step: 0.025 },
      { min: 0.5, max: 1, step: 0.025 },
    ];
    document.querySelectorAll(FIT_SELECTORS.join(',')).forEach(el => {
      const cls = el.className;
      const idx = FIT_SELECTORS.findIndex(s => cls.includes(s.replace('.', '')));
      const cfg = idx >= 0 ? FIT_CFG[idx] : { min: 0.5, max: 1, step: 0.025 };
      let scale = cfg.max;
      el.style.setProperty('--fit-scale', String(scale));
      let guard = 0;
      while (el.scrollHeight > el.clientHeight + 1 && scale > cfg.min && guard < 60) {
        scale = Math.max(cfg.min, Number((scale - cfg.step).toFixed(3)));
        el.style.setProperty('--fit-scale', String(scale));
        guard += 1;
      }
    });
  });
  await page.waitForTimeout(200);

  // 抓所有 cell + 元信息
  const cells = await page.$$eval('.cell', (els) =>
    els.map((el) => {
      const productId = el.getAttribute('data-product') || 'unknown_product';
      const cardAttr = el.getAttribute('data-card') || '';
      const jobAttr = el.getAttribute('data-job') || '';
      const coverWrap = el.querySelector('.cover-wrap');
      const jobText = el.querySelector('.job')?.textContent || '';
      const metaText = el.querySelector('.meta')?.textContent || '';
      // 提取 job_xxx
      const jobMatch = jobText.match(/job_\d+/);
      const jobId = jobAttr || (jobMatch ? jobMatch[0] : 'unknown');
      // 提取 card id（meta 格式：resource_xx · renderer_yyy）
      const cardMatch = metaText.match(/(resource_\d+_[a-z_]+)/);
      const cardId = cardAttr || (cardMatch ? cardMatch[1] : 'unknown');
      return { productId, jobId, cardId };
    }),
  );

  console.log(`找到 ${cells.length} 个 cell`);

  // 每个 cell 单独截图：用 boundingBox 抓 cover-wrap 区域
  const cellHandles = await page.$$('.cell');
  for (let i = 0; i < cellHandles.length; i++) {
    const { productId, jobId, cardId } = cells[i];
    const handle = cellHandles[i];
    const coverWrap = await handle.$('.cover-wrap');
    if (!coverWrap) continue;

    // 滚到可见
    await coverWrap.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);

    const out = path.join(OUT_DIR, `${String(i + 1).padStart(2, '0')}__${productId}__${cardId}__${jobId}.png`);
    await coverWrap.screenshot({ path: out, omitBackground: false });
    console.log(`[${i + 1}/${cells.length}] ${path.basename(out)}`);
  }

  await browser.close();
  console.log(`\n截图 ${cells.length} 张到 ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
