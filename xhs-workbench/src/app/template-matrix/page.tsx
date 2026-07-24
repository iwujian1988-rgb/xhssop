import Link from 'next/link';
import ReferenceCoverRenderer from '@/components/templates/ReferenceCoverRenderer';
import { competitorCreativeCards } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import type { CreativeCardRenderer, DenseDirectoryCoverPayload, DenseDirectorySection } from '@/types/reference-workflow';

const phrasePairs = [['en premier lieu','首先'],['il convient de','适合引出建议'],['en revanche','转向相反观点'],['de plus','补充理由'],['par conséquent','引出结果'],['à mon avis','表达个人观点'],['prendre en compte','把…考虑进去'],['mettre en évidence','突出重点']];

export default function TemplateMatrixPage() {
  const cards=competitorCreativeCards.filter(card=>card.supported);
  return <main className="min-h-screen bg-[#f3f3f1] px-5 py-8 text-neutral-950"><div className="mx-auto max-w-[1500px]"><div className="mb-7 flex items-end justify-between gap-4"><div><p className="text-xs font-bold text-neutral-500">离线视觉验收</p><h1 className="text-2xl font-black">封面模板总览</h1><p className="mt-2 text-sm text-neutral-600">程序模板看真实排版；文生图模板展示风格参考图，成品由「模板提示词+本篇文案」直接生成。</p></div><Link className="text-sm font-bold underline" href="/">回小红书笔记台</Link></div><div className="grid gap-7 md:grid-cols-2 xl:grid-cols-3">{cards.map(card=>{const spec=getCoverTemplateSpec(card.renderer_id);return <section className="min-w-0" key={card.id}><div className="mb-2 flex items-end justify-between gap-3"><div><h2 className="font-black">{card.name}</h2><span className="text-xs text-neutral-500">{spec?.name}</span></div><span className={`shrink-0 px-2 py-1 text-xs font-black ${spec?.renderMode==='image_to_image'?'bg-fuchsia-100 text-fuchsia-800':spec?.renderMode==='hybrid'?'bg-blue-100 text-blue-800':'bg-green-100 text-green-800'}`}>{spec?.renderMode==='image_to_image'?'文生图':spec?.renderMode==='hybrid'?'底图+程序排字':'程序精排'}</span></div><ReferenceCoverRenderer renderer={card.renderer_id} payload={fixture(card.renderer_id)} referenceImage={card.reference_image}/></section>})}</div></div></main>;
}

function fixture(renderer:CreativeCardRenderer):DenseDirectoryCoverPayload {
  const spec=getCoverTemplateSpec(renderer)||getCoverTemplateSpec('parchment_dense_directory')!;
  const titles:Record<string,[string,string]>={blackboard_phrase:['法语写作衔接短语','20个能直接用的表达'],blackboard_offer:['DELF B2写作资料怎么用','按薄弱点找到对应模块'],memo_offer:['法语B2写作资料说明','适合写完不会改的人'],word_flashcard:['法语写作常用连接词','按功能记，比单独背更好用'],book_cover:['法语B2写作实用手册','从观点到自查的完整路径'],notebook_big_words:['法语写作练了很久','落笔时还是没有思路'],plain_experience:['低精力备考法语B2，到底该怎么练？','先说一个前提：备考不是每天硬撑得越久越好。'],document_analysis:['DELF B2写作素材解析','环保主题观点如何展开'],vocab_table:['DELF B2主题词汇','按场景整理的写作表达'],course_roadmap:['法语B2写作复习路径','从会写到会检查的4阶段'],collocation_dense:['法语写作高频固定搭配','按功能分组，写作时更好调用']};
  const [title,subtitle]=titles[renderer]||['DELF B2写作知识体系','5组核心内容一页看清'];
  return {kind:'dense_directory',title,subtitle,sections:Array.from({length:spec.sectionCount},(_,i)=>makeSection(renderer,i,spec.itemsPerSection))};
}

function makeSection(renderer:CreativeCardRenderer,index:number,count:number):DenseDirectorySection {
  const headings=['任务与格式','观点展开','衔接表达','常见错误','交卷自查','句型替换'];
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
  const items=Array.from({length:count},(_,j)=>{const r=rows[(index*count+j)%rows.length];return {primary:r[0],secondary:r[1],note:renderer==='word_flashcard'?(j%2?'转折':'衔接'):undefined};});
  return {side_label:`第${index+1}组`,heading:headings[index%headings.length],columns:3,items,source_type:'mixed',source_ids:[]};
}
