import { loadJob, saveJob } from '../src/lib/batch-store';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { pickProductShowcasePlan } from '../src/lib/product-showcase-library';
import { auditContentPackage } from '../src/lib/v2/content-stage';
import { compileDraft } from '../src/lib/v2/pipeline';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

const batchId = process.argv[2];
if (!batchId) throw new Error('用法：finalize-commercial-v1-test.mts <batchId>');
const requestedJobIds = process.argv.slice(3);
const jobIds = requestedJobIds.length ? requestedJobIds : ['job_001', 'job_002', 'job_003'];
const facts = await loadProductFacts('delf_b2_writing');
const outputs: Array<Record<string, unknown>> = [];

for (const jobId of jobIds) {
  const job = await loadJob(batchId, jobId);
  if (!job.artifacts?.selectedTopic || !job.artifacts.content || !job.artifacts.titles || !job.draft) {
    throw new Error(`${jobId} 缺少已通过的内容或标题工件`);
  }
  const contentArtifact = structuredClone(job.artifacts.content);
  const content = contentArtifact.data;

  if (jobId === 'job_002') {
    const seenTitles = new Set<string>();
    content.innerPages = content.innerPages.filter(page => {
      const key = page.page_title.replace(/\s+/gu, '');
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    });
    const misconceptionPage = content.innerPages.find(page => page.page_title.includes('精准优于华丽'));
    if (misconceptionPage?.bullets[2]) {
      misconceptionPage.bullets[2] = 'DELF B2 写作至少需要 250 词，但不需要把句子故意写得晦涩。表达原因时，parce que 后接完整句，en raison de 后接名词短语；两种结构都可以使用，不能机械互换。';
    }
    const conversionPage = content.innerPages.find(page => page.page_title === '从口语到书面的转换练习');
    if (conversionPage) {
      conversionPage.bullets = [
        '【原句】On peut voir que ça pose problème pour l’environnement. 【更正式】Il apparaît clairement que cette situation pose un réel problème environnemental. 【说明】原句语法成立，但在正式论证中，明确指代并使用无人称结构更稳妥。',
        '【原句】Beaucoup de gens pensent que le tourisme est mauvais. 【更具体】De nombreuses personnes estiment que le tourisme de masse a des effets négatifs. 【说明】两句都合乎语法；第二句把人群、对象和评价说得更具体。',
        '【原句】C’est bien pour la santé. 【更准确】Cette pratique peut être bénéfique pour la santé publique. 【说明】用 peut être 避免把效果说成既定事实，并把评价对象说清。',
      ];
    }
    const expressionPage = content.innerPages.find(page => page.page_title === '封面条目的完整表达');
    if (expressionPage) {
      expressionPage.lead = '这些不是“口语一律错误”的替换表，而是正式议论文中常见的语体调整。是否替换，要看主语、指代和句子功能。';
      expressionPage.bullets = [
        'on doit → 根据主语改为 il faut、nous devons 或被动结构；on 本身不一定错，关键是避免指代含糊。',
        'ça pose problème → 正式文体可写 cela pose problème，或直接点名 cette situation / cette mesure。',
        'beaucoup de personnes → 可写 de nombreuses personnes；beaucoup de 本身合乎语法，不需要机械替换。',
        'dire → 按语义选择 affirmer（明确断言）、soutenir（主张）或 souligner（强调），不要只为“高级”而换词。',
        'On voit que… → 正式论证中可按语气改为 Il apparaît que… / On constate que…；这属于语体选择，不是假语法纠错。',
        'Mais → 段落转折时可选 cependant / toutefois；句内自然对比仍可使用 mais。',
      ];
    }
    const functionPage = content.innerPages.find(page => page.page_title === '功能表达的分类使用指南');
    if (functionPage?.bullets[0]) {
      functionPage.bullets[0] = '【表达原因】parce que、puisque、du fait que 后接完整句；en raison de 后接名词短语。例如：En raison de la crise économique, certaines entreprises réduisent leurs dépenses. 按后面的语法结构选择，不按“高级程度”机械替换。';
    }
  }

  if (jobId === 'job_003') {
    const openingPage = content.innerPages.find(page => page.page_title.includes('微信聊天'));
    if (openingPage) {
      openingPage.lead = '正式信不仅要语法正确，还要根据收信人、写信目的和双方关系调整语域。on、ça、beaucoup 等表达并非一律错误，但指代含糊、评价笼统或语气随意时，容易削弱正式感。';
      openingPage.bullets = [
        '先看指代：on 和 ça 如果没有清楚指向谁、哪件事，读者需要猜，正式信里更适合直接写明主体或对象。',
        '再看请求语气：直接写 Je veux que… 容易显得生硬，可根据关系改成 Je souhaiterais que… 或 Je vous saurais gré de bien vouloir…',
        '最后看结尾：投诉、建议或申请的正式程度不同，称呼和结束敬语应与收信对象匹配。',
      ];
    }
    const comparisonPage = content.innerPages.find(page => page.page_title.includes('聊天风'));
    if (comparisonPage?.bullets[2]) {
      comparisonPage.bullets[2] = comparisonPage.bullets[2].replace('compte tenu de son importance capitale', 'compte tenu de son importance');
    }
    const checklistPage = content.innerPages.find(page => page.page_title.includes('自查清单'));
    if (checklistPage) {
      checklistPage.lead = '交卷前快速看四处：不是机械禁用某个词，而是检查它在当前收信人和写信目的下是否清楚、礼貌、自然。';
      checklistPage.bullets = [
        '人称：写给机构或不熟悉的收信人时是否保持 vous？若题目设定允许熟人交流，再按关系选择 tu。',
        '代词：ça、y、en 的指代是否清楚？指代不明时，改为 cela、à + 名词或 de + 名词；清楚自然时不必机械替换。',
        '连接：donc、mais 是否重复过多？需要段落级转折或结论时，可换用 cependant、toutefois、par conséquent。',
        '结尾：正式纸质信优先使用完整敬语；Cordialement 更常见于邮件或正式程度较低的往来，要结合任务情境。',
      ];
    }
  }

  content.innerPages = content.innerPages.map((page, index) => ({ ...page, page_no: index + 2 }));
  const audited = await auditContentPackage(contentArtifact, {
    topic: job.artifacts.selectedTopic.data,
    evidence: job.draft.evidence,
  });
  const card = getCompetitorCreativeCard(job.reference_card_id);
  if (!card) throw new Error(`找不到参考卡：${job.reference_card_id}`);
  const draft = compileDraft({
    productId: job.product_id,
    card,
    topic: job.artifacts.selectedTopic.data,
    capability: getCapabilityFallback(card),
    content: audited.data,
    titles: job.artifacts.titles.data,
    evidence: job.draft.evidence,
    auditWarnings: audited.warnings,
    prebuiltTags: job.draft.tags,
    endingShowcasePlan: pickProductShowcasePlan(job.product_id, facts, `commercial-v1-finalize|${job.id}`),
  });
  await saveJob(batchId, {
    ...job,
    draft,
    artifacts: {
      ...job.artifacts,
      content: audited,
      compiledDraft: { ...job.artifacts.compiledDraft!, data: draft, created_at: new Date().toISOString() },
    },
    warnings: [...new Set([...(job.warnings || []), ...audited.warnings, 'COMMERCIAL_V1_PAGE_REPAIR_COMPLETE'])],
  });
  outputs.push({
    jobId,
    contentPages: audited.data.innerPages.length,
    totalRenderedPages: draft.inner_pages.length + 1,
    pageTitles: draft.inner_pages.map(page => page.page_title),
    frenchQaWarnings: audited.warnings.filter(item => /法语|审校/i.test(item)),
  });
  process.stderr.write(`[commercial-v1-finalize] PASS ${jobId} pages=${draft.inner_pages.length}\n`);
}

process.stdout.write(JSON.stringify({ batchId, outputs }, null, 2));
