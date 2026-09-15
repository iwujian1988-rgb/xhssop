import fs from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'tmp-v2-bridge');
await fs.mkdir(dir, { recursive: true });
console.log(`[v2-bridge] watching ${dir}`);

for (;;) {
  const names = await fs.readdir(dir);
  for (const name of names.filter(name => name.endsWith('.json') && name.startsWith('req-') && !name.endsWith('.resp.json') && !name.endsWith('.error.json'))) {
    const requestPath = path.join(dir, name);
    const responsePath = requestPath.replace(/\.json$/, '.resp.json');
    try {
      await fs.access(responsePath);
      continue;
    } catch {}
    const request = JSON.parse(await fs.readFile(requestPath, 'utf8'));
    const user = JSON.parse(request.messages.find(message => message.role === 'user')?.content || '{}');
    const response = buildResponse(user);
    await fs.writeFile(responsePath, JSON.stringify(response, null, 2), 'utf8');
    console.log(`[v2-bridge] answered ${name}`);
  }
  await new Promise(resolve => setTimeout(resolve, 200));
}

function buildResponse(user) {
  if (user.cover?.accepted_blocks && user.count) return topics(user);
  if (user.cover_contract?.accepted_block_kinds) return content(user);
  if (user.actual_content?.cover) return titles(user);
  if (user.french_segments) return { approved: true, corrections: [], issues: [] };
  throw new Error(`unknown V2 bridge request: ${Object.keys(user).join(',')}`);
}

function topics(user) {
  const productId = user.product.id;
  const templateId = user.cover.id ? rendererFromCard(user.cover.id) : 'parchment_dense_directory';
  const delf = productId === 'delf_b2_writing';
  const base = delf ? 'DELF B2写作' : 'TEF/TCF Canada';
  const specs = [
    ['search', `${base}考前总丢格式分怎么办`, '写完作文却不知道格式哪里错', '考前', '格式自查'],
    ['conversion', `${base}完整备考资料怎么选`, '想少走弯路又不知道资料是否完整', '整理资料时', '知识库总览'],
    ['click', `${base}观点展开总是写不深`, '有观点但解释和例子接不上', '限时写作时', '观点展开'],
    ['save', `${base}考前最后一遍查什么`, '复习内容太多不知道先检查哪里', '考前7天', '考前速查'],
  ];
  return {
    topics: specs.map(([goal, topic, pain, scene, angle], index) => ({
      id: `v2_mock_topic_${index + 1}`,
      productId,
      templateId,
      primaryGoal: goal,
      topic,
      audienceState: delf ? '准备DELF B2写作的考生' : '准备加拿大法语考试的考生',
      scene,
      painOrDesire: pain,
      promise: `给出一套能直接照着查的${angle}方法`,
      contentAngle: `${angle}的短条目与补充解释`,
      productBridge: `需要系统复习时可用完整${base}知识库继续查`,
      seo: { primary: base, related: [angle, delf ? '法语写作' : '加拿大法语'] },
      knowledgeMode: index === 2 ? 'educational_original' : 'mixed',
      factTerms: [angle],
      seedSignals: ['用户搜索词', angle],
      noveltyFingerprint: `${goal}|${angle}|mock-${index}`,
    })),
  };
}

function content(user) {
  const topic = user.topic;
  const kind = user.cover_contract.accepted_block_kinds[0];
  const dense = user.cover_contract.density_tiers.find(tier => tier.id === 'dense');
  const sectionCount = dense.sectionRange[1];
  const itemCount = dense.itemRange[0];
  const delf = topic.productId === 'delf_b2_writing';
  const keyword = topic.seo.primary;
  const blocks = Array.from({ length: sectionCount }, (_, sectionIndex) => ({
    id: `block_${sectionIndex + 1}`,
    kind,
    heading: ['任务格式', '结构展开', '衔接表达', '交卷自查', '例子落地'][sectionIndex] || `重点${sectionIndex + 1}`,
    priority: sectionIndex < 2 ? 1 : sectionIndex < 4 ? 2 : 3,
    sourceMode: sectionIndex === 0 ? 'product_fact' : 'general_advice',
    sourceIds: sectionIndex === 0 ? user.evidence.slice(0, 1).map(item => item.id) : [],
    items: Array.from({ length: itemCount }, (_, itemIndex) => ({
      primary: delf ? `写作检查点${sectionIndex + 1}-${itemIndex + 1}` : `备考检查点${sectionIndex + 1}-${itemIndex + 1}`,
      secondary: ['先确认要求', '再补具体原因', '加一个真实场景', '最后回扣观点', '交卷前再查'][itemIndex % 5],
    })),
  }));
  return {
    topicSnapshotHash: 'mock',
    coverBlocks: blocks,
    innerPages: [
      { page_no: 1, page_type: 'steps', page_title: '先按这4步检查', lead: '不要从第一句重新读到最后一句。', bullets: ['先看任务要求', '再看段落结构', '检查每段有没有解释', '最后检查称呼和结尾'], source_ids: [] },
      { page_no: 2, page_type: 'example_explain', page_title: '一段内容怎么展开', lead: '观点后面至少接上原因和场景。', bullets: ['先说清楚观点', '补一个具体原因', '用生活场景说明', '结尾回到题目'], source_ids: [] },
    ],
    captionParts: {
      opening: `${keyword}写完以后，最怕的不是不会写，而是不知道该从哪里检查。`,
      value: ['先核对任务和格式，再看每段有没有观点、解释和例子。', '连接词不用堆很多，关键是前后关系能不能一眼读懂。', '考前把检查顺序固定下来，比每次从头通读更省时间。'],
      productBridge: topic.productBridge,
      cta: '先把这套顺序拿去检查一篇自己的文章。',
    },
    tagMaterial: [keyword, '考前自查', '法语备考', '写作结构', '学习资料', '考试经验'],
    factualClaims: user.evidence.length ? [{ text: user.evidence[0].text, type: 'product', sourceIds: [user.evidence[0].id] }] : [],
    frenchSegments: [],
  };
}

function titles(user) {
  const delf = user.product.identity.includes('DELF');
  const identity = delf ? 'DELF B2写作' : 'TEF/TCF备考';
  const object = user.topic.contentAngle.includes('格式') ? '格式' : user.topic.contentAngle.includes('知识库') ? '资料' : '检查';
  const variants = [
    [`${identity}考前先查${object}`, `考前总丢分的人先查${object}`, '考前自查'],
    [`${identity}${object}别漏这几项`, `写完不知道查哪就看这里`, '损失规避'],
    [`${identity}最后5分钟查什么`, `交卷前5分钟先查${object}`, '时间场景'],
    [`${identity}${object}整理好了`, `正在备考的人把这页存好`, '资料获得感'],
    [`${identity}总写不好先查${object}`, `反复写不好的人先停一下`, '痛点拦截'],
    [`${identity}${object}比背句型更急`, `考前别只顾着背句型`, '反常识'],
    [`${identity}想少丢分先查${object}`, `格式分老丢的人看这里`, '结果导向'],
    [`${identity}${object}一页速查`, `考前7天先把这页查完`, '行动钩子'],
  ];
  return {
    candidates: variants.map(([textTitle, coverTitle, mechanism], index) => ({
      textTitle,
      coverTitle,
      coverSubtitle: index % 2 ? '写完按顺序过一遍' : '容易漏的地方都列出来了',
      mechanism,
      userRelation: `面向${user.topic.audienceState}在${user.topic.scene}使用`,
      seoKeyword: user.topic.seo.primary,
      noveltyFingerprint: `${mechanism}|${object}|${index}`,
    })),
  };
}

function rendererFromCard(cardId) {
  const map = {
    resource_01_grammar_parchment_red: 'parchment_dense_directory',
    resource_02_grammar_white_green: 'white_green_directory',
  };
  return map[cardId] || 'parchment_dense_directory';
}
