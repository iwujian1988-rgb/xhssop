import Link from 'next/link';
import ReferenceCoverRenderer from '@/components/templates/ReferenceCoverRenderer';
import { competitorCreativeCards } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import type { CreativeCardRenderer, DenseDirectoryCoverPayload, DenseDirectorySection } from '@/types/reference-workflow';

const phrasePairs = [['en premier lieu','首先'],['il convient de','适合引出建议'],['en revanche','转向相反观点'],['de plus','补充理由'],['par conséquent','引出结果'],['à mon avis','表达个人观点'],['prendre en compte','把…考虑进去'],['mettre en évidence','突出重点']];

export default function TemplateMatrixPage() {
  const cards = competitorCreativeCards.filter(card => card.supported);
  const directCount = cards.filter(card => templateStatus(card).kind === 'direct').length;
  const limitedCount = cards.filter(card => templateStatus(card).kind === 'limited').length;
  const imageCount = cards.filter(card => templateStatus(card).kind === 'image').length;
  const unavailableCount = cards.filter(card => templateStatus(card).kind === 'unavailable').length;
  return <main className="min-h-screen bg-[#f3f3f1] px-5 py-8 text-neutral-950"><div className="mx-auto max-w-[1500px]"><div className="mb-7 flex items-end justify-between gap-4"><div><p className="text-xs font-bold text-neutral-500">今日新增封面生产池</p><h1 className="text-2xl font-black">封面模板总览</h1><p className="mt-2 text-sm text-neutral-600">只复刻原图的信息组织与视觉版式；生产内容统一来自 DELF / TEF / TCF 法语工作流。</p></div><Link className="text-sm font-bold underline" href="/">回小红书笔记台</Link></div><div className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-300 bg-white p-4 text-sm"><b>当前可用性：</b><StatusLegend kind="direct" label={`通用可用 ${directCount}`} /><StatusLegend kind="limited" label={`限定选题可用 ${limitedCount}`} /><StatusLegend kind="image" label={`需图生图服务 ${imageCount}`} /><StatusLegend kind="unavailable" label={`当前不可用 ${unavailableCount}`} /></div><div className="grid gap-7 md:grid-cols-2 xl:grid-cols-3">{cards.map(card => <section className={`min-w-0 rounded-xl border-2 bg-white p-3 ${templateStatus(card).border}`} key={card.id}><CardHeader card={card} /><ReferenceCoverRenderer renderer={card.renderer_id} payload={fixture(card.renderer_id, card.id)} referenceImage={card.reference_image} /></section>)}</div></div></main>;
}

function CardHeader({ card }: { card: (typeof competitorCreativeCards)[number] }) {
  const spec = getCoverTemplateSpec(card.renderer_id);
  const status = templateStatus(card);
  return <div className="mb-3"><div className="flex items-start justify-between gap-3"><div><h2 className="font-black">{card.name}</h2><span className="text-xs font-bold text-sky-700">生产版式：{spec?.name || '没有对应渲染器'}</span><span className={`mt-1 block text-[10px] font-bold ${workflowStatus(card).kind === 'blocked' ? 'text-red-700' : workflowStatus(card).kind === 'image' ? 'text-amber-700' : 'text-green-700'}`}>{workflowStatus(card).label}</span></div><div className="flex shrink-0 flex-col items-end gap-1"><span className={`px-2 py-1 text-xs font-black ${status.badge}`}>{status.label}</span><span className="text-[10px] font-bold text-neutral-500">{spec?.renderMode === 'image_to_image' ? '图生图' : spec?.renderMode === 'hybrid' ? '去字底图+程序排字' : spec ? 'HTML+CSS程序精排' : '无渲染器'}</span></div></div>{spec?.suitableTopics?.length ? <div className="mt-2 rounded-md bg-neutral-50 p-2 text-[11px] leading-5 text-neutral-700"><b className="text-green-700">适合：</b>{spec.suitableTopics.join(' / ')}<br/><b className="text-red-700">不适合：</b>{spec.incompatibleTopics?.join(' / ')}<br/><b>选错处理：</b>{spec.mismatchAction}</div> : null}</div>;
}

function workflowStatus(card: (typeof competitorCreativeCards)[number]): { kind: 'direct' | 'image' | 'blocked'; label: string } {
  const spec = getCoverTemplateSpec(card.renderer_id);
  if (!spec) return { kind: 'blocked', label: '工作流阻断：无渲染器' };
  if (spec.renderMode === 'image_to_image') {
    return card.reference_image
      ? { kind: 'image', label: '工作流已接通：底图 → 生图 → 轮询 → 导出（需 IMAGE_API_KEY）' }
      : { kind: 'blocked', label: '工作流阻断：缺少参考底图' };
  }
  return { kind: 'direct', label: '工作流已接通：内容 → 编译 → 导出' };
}

type TemplateStatusKind = 'direct' | 'limited' | 'image' | 'unavailable';
function templateStatus(card: (typeof competitorCreativeCards)[number]): { kind: TemplateStatusKind; label: string; badge: string; border: string } {
  const spec = getCoverTemplateSpec(card.renderer_id);
  const mode = spec?.renderMode;
  if (!mode) return { kind: 'unavailable', label: '✕ 当前不可用', badge: 'bg-red-100 text-red-800', border: 'border-red-300' };
  if (spec?.productionFit === 'disabled') return { kind: 'unavailable', label: '✕ 当前不可用', badge: 'bg-red-100 text-red-800', border: 'border-red-300' };
  if (spec?.productionFit === 'limited') return { kind: 'limited', label: '△ 限定选题可用', badge: 'bg-orange-100 text-orange-900', border: 'border-orange-300' };
  if (mode === 'image_to_image') return { kind: 'image', label: '△ 需图生图服务', badge: 'bg-amber-100 text-amber-900', border: 'border-amber-300' };
  return { kind: 'direct', label: '✓ 当前可直接生成', badge: 'bg-green-100 text-green-800', border: 'border-green-300' };
}

function StatusLegend({ kind, label }: { kind: TemplateStatusKind; label: string }) {
  const cls = kind === 'direct' ? 'bg-green-100 text-green-800' : kind === 'limited' ? 'bg-orange-100 text-orange-900' : kind === 'image' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800';
  return <span className={`rounded px-2 py-1 text-xs font-black ${cls}`}>{label}</span>;
}

function fixture(renderer:CreativeCardRenderer, cardId?: string):DenseDirectoryCoverPayload {
  const spec=getCoverTemplateSpec(renderer)||getCoverTemplateSpec('parchment_dense_directory')!;
  const titles:Record<string,[string,string]>={blackboard_phrase:['法语写作衔接短语','能直接放进作文的表达'],blackboard_offer:['DELF B2写作资料怎么用','按薄弱点找到对应模块'],memo_offer:['DELF B2格式分老丢的人先看','这份资料先帮你把结构查清'],word_flashcard:['法语写作常用连接词','按功能记，写作时更好调用'],book_cover:['法语B2写作实用手册','从观点到自查的完整路径'],notebook_big_words:['法语写作练了很久','落笔时还是没有思路'],plain_experience:['低精力备考法语B2，到底该怎么练？','备考不是每天硬撑得越久越好。'],document_analysis:['DELF B2写作素材解析','环保主题观点如何展开'],vocab_table:['DELF B2主题词汇','按场景整理的写作表达'],course_roadmap:['法语B2写作复习路径','从会写到会检查的4阶段'],collocation_dense:['法语写作高频固定搭配','按功能分组，写作时更好调用'],official_notice:['关于做好DELF B2写作考前自查的通知','交卷前先核对最容易漏的三处'],pain_quote_big:['DELF B2作文没少写，分数怎么还卡着','问题往往不在练得少'],showcase_screenshot:['DELF B2写作资料终于能按问题查了','范文、句型和自查都在同一套知识库里']};
  const cardTitles: Record<string, [string, string]> = {
    production_user_toc_dense: ['DELF B2写作高频主题目录', '按任务、观点与表达功能分类整理'],
    production_user_formula_sheet: ['DELF B2写作结构公式', '审题、展开、举例与检查一页速记'],
    production_user_three_column_phrase: ['法语B2语法速记格', '时态、语式、代词与衔接一页看清'],
    production_user_vocab_table: ['法语写作主题词汇密表', '按环境、教育与职场场景分类'],
    production_user_handwritten_history: ['DELF B2范文手写精读', '原句、段落功能与迁移写法'],
    production_user_handwritten_grammar: ['法语语法手账口诀', '高频规则、易错点与短例句'],
    production_user_question_bank: ['TEF/TCF法语双语题库', '高频主题问题与中文对照'],
    production_user_practice_sheet: ['DELF B2观点四维拆解', '一个观点配四类佐证，写作更好展开'],
    production_user_dictionary_dense: ['法语B2进阶词汇必备', '词义、用法与法语例句密集速查'],
    production_user_roadmap_four_steps: ['DELF B2作文四段框架', '引入、立场、论证与结尾写作路径'],
  };
  const [title,subtitle]=cardTitles[cardId || ''] || titles[renderer]||['DELF B2写作知识体系',`${spec.sectionCount}组核心内容一页看清`];
  const itemRange = spec.itemRange || [spec.itemsPerSection, spec.itemsPerSection];
  const sectionCounts = allocateFixtureCounts(spec.sectionCount, itemRange, spec.minTotalItems, spec.maxTotalItems);
  return {kind:'dense_directory',title,subtitle,sections:Array.from({length:spec.sectionCount},(_,i)=>{
    return makeSection(renderer, i, sectionCounts[i] || itemRange[0], cardId);
  })};
}

function allocateFixtureCounts(sectionCount: number, range: [number, number], minTotal: number, maxTotal?: number) {
  const counts = Array.from({ length: sectionCount }, () => range[0]);
  const target = Math.min(maxTotal ?? Number.POSITIVE_INFINITY, Math.max(minTotal, sectionCount * range[0]));
  let cursor = 0;
  while (counts.reduce((sum, count) => sum + count, 0) < target) {
    if (counts[cursor % sectionCount] < range[1]) counts[cursor % sectionCount] += 1;
    cursor += 1;
    if (cursor > sectionCount * (range[1] - range[0] + 1) + 1) break;
  }
  return counts;
}

function makeSection(renderer:CreativeCardRenderer,index:number,count:number, cardId?: string):DenseDirectorySection {
  let headings=['任务与格式','观点展开','衔接表达','常见错误','交卷自查','句型替换'];
  let rows=[['正式信','称呼与结尾'],['论坛投稿','表达立场'],['观点句','先说清主张'],['解释句','补充原因'],['例子句','落到具体场景'],['让步句','承认另一面'],['结论句','回扣主题'],['自查项','检查一致性']];
  if(renderer==='blackboard_phrase'||renderer==='collocation_dense')rows=phrasePairs;
  if(renderer==='word_flashcard')rows=[['cependant','然而'],['pourtant','不过'],['ainsi','因此'],['donc','所以'],["d'abord",'首先'],['ensuite','接着'],['enfin','最后'],['puisque','既然'],['bien que','尽管']];
  if(renderer==='document_analysis')rows=[['Il est essentiel de réduire les déchets.','有必要减少垃圾'],['Cette mesure peut améliorer la vie quotidienne.','该措施能改善日常生活'],['Cependant, son coût doit être pris en compte.','仍需考虑成本'],['观点','先明确支持或反对'],['解释','说明为什么'],['例子','给出具体场景'],['迁移','替换主题词继续使用'],['检查','注意语域与搭配']];
  if(renderer==='document_analysis')rows=[
    ['Il est essentiel de réduire les déchets dans la vie quotidienne.','在日常生活中减少垃圾很有必要。'],
    ['Cette mesure peut améliorer durablement la qualité de vie.','这项措施能长期改善生活质量。'],
    ['Cependant, son coût doit également être pris en compte.','不过，也必须把实施成本考虑进去。'],
    ['Une solution efficace doit rester accessible à tous.','有效方案也应该让所有人都能采用。'],
    ['观点展开','先明确立场，再解释原因并补充具体例子。'],
    ['表达迁移','替换主题词后，可以继续用于环境与公共生活话题。'],
    ['论证检查','确认观点、理由和例子之间存在清晰的逻辑关系。'],
    ['语域检查','正式写作避免口语缩写，并保持称呼与结尾一致。'],
  ];
  if(renderer==='notebook_big_words')rows=[['背了很多句型','写的时候还是想不起来'],['真正缺的是调用路径','先按任务和功能分组'],['写完马上做一轮自查','把常错项逐个排除']];
  if(renderer==='course_roadmap')rows=[['先测当前薄弱点','确定本周重点'],['拆解范文结构','看懂段落作用'],['限时完成一篇','记录真实卡点'],['按清单复查','只改最常犯的问题']];
  if(renderer==='blackboard_offer'||renderer==='memo_offer')rows=[['适合人群','写完不知道哪里有问题'],['使用场景','日常练习与考前复盘'],['范文库','对照结构与语域'],['句型库','按功能查找表达'],['观点库','补足主题思路'],['检查清单','写完逐项排查']];
  if(renderer==='plain_experience')rows=[['没办法每天长时间专注，就把练习拆成二十分钟的小任务','一天只解决结构、观点或表达中的一个问题，不追求一次写完整篇'],['真正影响进步的不是练得少，而是每次都不知道自己在改什么','保留同一份检查清单，连续几次只观察最常犯的两类错误'],['状态好时再做完整限时写作，状态差时只拆范文和改旧稿','让每天的任务足够小，反而更容易坚持到考试前'],['复盘时记录下一次具体要检查什么','不要只写一句继续努力，也别用无效打卡感动自己']];
  if(cardId === 'production_user_formula_sheet') rows=[['正式信开头','称呼 + 写信目的 + 事件背景'],['立场段','明确观点 + 限定条件 + 段落方向'],['理由展开','中心句 + 原因解释 + 具体影响'],['举例论证','真实场景 + 具体动作 + 可观察结果'],['让步转折','承认另一面 + 指出限制 + 回到主张'],['建议表达','问题诊断 + 可行动建议 + 预期作用'],['段落衔接','逻辑关系 + 连接词 + 新信息'],['正式语域','礼貌条件式 + 客观措辞 + 避免口语'],['结尾收束','重申立场 + 行动期待 + 礼貌结尾'],['交卷检查','任务完成度 + 结构 + 语法与拼写']];
  if(cardId === 'production_user_toc_dense') { headings=['任务与格式','高频主题','表达功能']; rows=[['Lettre formelle','正式信'],['Contribution au forum','论坛投稿'],['Article argumentatif','议论文'],['Réclamation','投诉信'],['Candidature','申请信'],['Proposition','建议信'],['Environnement','环境'],['Éducation','教育'],['Travail','职场'],['Technologie','科技'],['Vie urbaine','城市生活'],['Consommation','消费'],['exprimer son opinion','表达观点'],['justifier une idée','解释理由'],['donner un exemple','举例'],['concéder','让步'],['nuancer','限定观点'],['conclure','总结']]; }
  if(cardId === 'production_user_three_column_phrase') { headings=['直陈式现在时','复合过去时','未完成过去时','简单将来时','条件式现在时','虚拟式现在时','直接宾语代词','间接宾语代词','关系代词','原因表达','让步表达','正式语域']; rows=[['现在事实与普遍判断','主语 + 变位动词 + 补语'],['完成事件看结果','avoir或être + 过去分词'],['背景习惯看过程','词干nous去ons + 词尾'],['将来计划与预测','不定式 + ai、as、a、ons、ez、ont'],['礼貌建议与假设','将来词干 + 未完成过去时词尾'],['必要愿望与评价','que后按主语变位'],['le、la、les提前','放在变位动词前'],['lui、leur指向人','回答à qui'],['qui作主语，que作宾语','dont替代de引出的成分'],['parce que说明直接原因','puisque说明已知原因'],['bien que后接虚拟式','même si后接直陈式'],['避免ça与口语缩写','优先使用cela和完整否定']]; }
  if(cardId === 'production_user_vocab_table') { headings=['环境与公共生活','教育与数字化','职场与社会']; rows=[['réduire les déchets','减少垃圾'],['préserver les ressources','保护资源'],['favoriser le recyclage','促进回收'],['limiter la pollution','限制污染'],['améliorer le cadre de vie','改善生活环境'],['sensibiliser le public','提高公众意识'],['adopter une mesure','采取措施'],['un enjeu majeur','重大议题'],['l’accès à la formation','接受培训的机会'],['développer une compétence','培养能力'],['réduire les inégalités','减少不平等'],['l’apprentissage à distance','远程学习'],['un outil numérique','数字工具'],['encourager l’autonomie','鼓励自主性'],['protéger les données','保护数据'],['un esprit critique','批判性思维'],['concilier vie et travail','平衡生活与工作'],['améliorer les conditions','改善条件'],['une charge de travail','工作负担'],['favoriser l’insertion','促进就业融入'],['l’égalité professionnelle','职场平等'],['un emploi stable','稳定工作'],['renforcer la cohésion','增强凝聚力'],['soutenir une initiative','支持倡议'],['mettre en place','实施'],['prendre en compte','考虑'],['avoir accès à','能够获得'],['faire face à','面对'],['jouer un rôle clé','发挥关键作用'],['à long terme','从长远看']]; }
  if(cardId === 'production_user_handwritten_history') { headings=['原句','段落功能','迁移写法']; rows=[['Il est essentiel de repenser nos habitudes de consommation.','中心句先明确主张，为后文原因展开定方向。'],['Cette évolution profiterait à l’ensemble de la société.','条件式让建议更审慎，也能自然引出公共收益。'],['Certes, cette mesure représente un coût initial.','先承认成本，建立让步关系。'],['Cependant, ses bénéfices à long terme sont considérables.','转折后回到主张，并把论证落在长期影响。'],['À titre d’exemple, les transports publics réduisent la congestion.','用具体场景替代空泛的“有很多好处”。'],['Il convient donc d’agir de manière progressive.','结论给出可执行方向，避免只重复开头。']]; }
  if(cardId === 'production_user_handwritten_grammar') { headings=['语法口诀']; rows=[['复合过去时','完成动作看结果：助动词 + 过去分词。'],['未完成过去时','背景、状态和习惯，用nous词干换词尾。'],['条件式现在时','建议更礼貌：将来词干接过去时词尾。'],['虚拟式现在时','必要、愿望、评价后，que引出虚拟式。'],['直接宾语代词','le、la、les放在变位动词前。'],['关系代词','qui作主语，que作宾语，dont接de。'],['原因连接','parce que给原因，puisque接已知事实。'],['让步连接','bien que接虚拟式，même si接直陈式。'],['否定结构','ne与pas夹住变位动词，正式写作不省略ne。'],['主谓一致','先找主语中心词，再决定动词人称与数。']]; }
  if(cardId === 'production_user_question_bank') { headings=['Technologie et société 科技与社会']; rows=[['Selon vous, le numérique améliore-t-il vraiment la vie quotidienne ?','您认为数字技术真的改善了日常生活吗？'],['Quels risques les réseaux sociaux présentent-ils pour les jeunes ?','社交网络会给年轻人带来哪些风险？'],['Faut-il limiter le temps passé devant les écrans ?','是否应该限制屏幕使用时间？'],['Le télétravail est-il une solution durable ?','远程办公是可持续的解决方案吗？'],['Comment protéger les données personnelles en ligne ?','如何保护网络个人数据？'],['Les outils numériques réduisent-ils les inégalités ?','数字工具会减少不平等吗？'],['Quelle place l’intelligence artificielle devrait-elle occuper à l’école ?','人工智能在学校中应占据什么位置？'],['Peut-on encore vivre sans smartphone ?','人们还能离开智能手机生活吗？']]; }
  if(cardId === 'production_user_practice_sheet') { headings=['观点与四项佐证']; rows=[['发展公共交通','A) 减少拥堵 · B) 降低污染 · C) 改善通勤 · D) 促进公平'],['限制一次性用品','A) 减少垃圾 · B) 节省资源 · C) 改变习惯 · D) 带动回收'],['推广远程办公','A) 节省通勤 · B) 提高灵活性 · C) 扩大招聘 · D) 平衡生活'],['加强数字教育','A) 扩大资源 · B) 支持自主学习 · C) 培养技能 · D) 缩小差距'],['建设城市绿地','A) 改善空气 · B) 缓解压力 · C) 增加交流 · D) 调节温度'],['鼓励终身学习','A) 更新技能 · B) 适应就业 · C) 保持自主 · D) 增强信心'],['保护个人数据','A) 明确同意 · B) 限制收集 · C) 加强加密 · D) 提高意识'],['支持本地消费','A) 稳定就业 · B) 缩短运输 · C) 维护社区 · D) 促进多样性']]; }
  if(cardId === 'production_user_dictionary_dense') { headings=['Vocabulaire B2']; rows=[['pertinent','恰当的；相关的','Cette solution semble pertinente dans ce contexte.'],['durable','可持续的','Nous devons adopter une approche durable.'],['enjeu','议题；挑战','Le logement constitue un enjeu majeur.'],['favoriser','促进','Cette mesure favorise l’égalité des chances.'],['préserver','保护','Il faut préserver les ressources naturelles.'],['renforcer','加强','Le projet peut renforcer la cohésion sociale.'],['sensibiliser','提高意识','La campagne vise à sensibiliser le public.'],['nuancer','使观点更审慎','Il convient de nuancer cette affirmation.'],['souligner','强调','Je souhaite souligner un point essentiel.'],['remédier à','补救；解决','Cette action peut remédier au problème.'],['mettre en œuvre','实施','La ville doit mettre en œuvre ce plan.'],['tenir compte de','考虑','Il faut tenir compte des besoins locaux.'],['accessible','可获得的','Le service doit rester accessible à tous.'],['contraignant','限制性强的','Ce règlement paraît trop contraignant.'],['bénéfique','有益的','Cette évolution serait bénéfique aux élèves.'],['incontournable','不可忽视的','Le numérique est devenu incontournable.'],['accroître','增加','Cette politique risque d’accroître les écarts.'],['atténuer','减轻','Ces mesures pourraient atténuer les effets.'],['cohérent','连贯的','Votre argumentation doit rester cohérente.'],['convaincant','有说服力的','Un exemple précis rend le propos convaincant.'],['néanmoins','然而','Néanmoins, certaines limites subsistent.'],['davantage','更多地','Il faudrait investir davantage dans la formation.']]; }
  if(cardId === 'production_user_roadmap_four_steps') { headings=['引入：交代背景','立场：明确主张','论证：理由与例子','结尾：收束与建议']; rows=[['De nos jours, la question de ... suscite de nombreux débats.','用背景句引出主题，不照抄题干'],['Dans ce contexte, il convient de se demander si ...','把题目转成清晰的问题'],['Pour ma part, je considère que ...','明确立场并限定范围'],['Tout d’abord, cette mesure permet de ...','第一理由先写中心句'],['En effet, ...','解释理由产生作用的机制'],['À titre d’exemple, ...','加入具体可验证的场景'],['Certes, ... ; cependant, ...','承认限制后回到主张'],['En définitive, il paraît nécessaire de ...','总结判断并提出可执行建议']]; }
  const items=Array.from({length:count},(_,j)=>{const r=rows[(index*count+j)%rows.length];return {primary:r[0],secondary:r[1],note:r[2] || (renderer==='word_flashcard'?(j%2?'转折':'衔接'):undefined)};});
  return {side_label:`第${index+1}组`,heading:headings[index%headings.length],columns:3,items,source_type:'mixed',source_ids:[]};
}
