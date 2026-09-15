'use client';

import type { CreativeCardRenderer, DenseDirectoryCoverPayload } from '@/types/reference-workflow';

type UserRenderer = Extract<CreativeCardRenderer,
  | 'ielts_speaking_toc'
  | 'criminal_law_formula'
  | 'english_grammar_grid'
  | 'french_gender_vocab'
  | 'mao_article_notes'
  | 'english_grammar_notebook'
  | 'french_oral_question_bank'
  | 'french_a1_practice_sheet'
  | 'sat_vocab_dictionary'
  | 'ielts_task1_four_part'>;

export default function UserProvidedCoverRenderer({ renderer, payload, className = '' }: { renderer: UserRenderer; payload: DenseDirectoryCoverPayload; className?: string }) {
  const items = payload.sections.flatMap(section => section.items.map(item => ({ ...item, group: section.heading })));
  const common = { payload, items, className };
  if (renderer === 'ielts_speaking_toc') return <IeltsSpeakingToc {...common} />;
  if (renderer === 'criminal_law_formula') return <CriminalFormula {...common} />;
  if (renderer === 'english_grammar_grid') return <EnglishGrammarGrid {...common} />;
  if (renderer === 'french_gender_vocab') return <FrenchGenderVocab {...common} />;
  if (renderer === 'mao_article_notes') return <MaoArticleNotes {...common} />;
  if (renderer === 'english_grammar_notebook') return <EnglishGrammarNotebook {...common} />;
  if (renderer === 'french_oral_question_bank') return <FrenchOralQuestionBank {...common} />;
  if (renderer === 'french_a1_practice_sheet') return <FrenchA1Practice {...common} />;
  if (renderer === 'sat_vocab_dictionary') return <SatVocabulary {...common} />;
  return <IeltsTaskOne {...common} />;
}

type CoverProps = {
  payload: DenseDirectoryCoverPayload;
  items: Array<{ primary: string; secondary?: string; note?: string; group: string }>;
  className?: string;
};

function Shell({ kind, title, className, children }: { kind: string; title: string; className?: string; children: React.ReactNode }) {
  return <article className={`user-production-cover user-production-cover--${kind} ${className || ''}`} aria-label={title}>{children}<SharedStyles /></article>;
}

function IeltsSpeakingToc({ payload, items, className }: CoverProps) {
  return <Shell kind="ielts-toc" title={payload.title} className={className}>
    <header><h1>{payload.title}</h1><h2>目录</h2></header>
    <div className="toc-groups">{payload.sections.map((section, sectionIndex) => <section key={sectionIndex}><h3>{section.heading}</h3>{section.items.map((item, itemIndex) => <div className="toc-row" key={itemIndex}><span>{item.primary}{item.secondary ? ` - ${item.secondary}` : ''}</span><i /><b>{sectionIndex * 8 + itemIndex + 2}</b></div>)}</section>)}</div>
    <small>{items.length} 个目录条目</small>
  </Shell>;
}

function CriminalFormula({ payload, items, className }: CoverProps) {
  const visibleItems = items.slice(0, 14);
  return <Shell kind="criminal" title={payload.title} className={className}>
    <h1>{payload.title}</h1><div className="criminal-rule" />
    <div className="criminal-list" style={{ gridTemplateRows: `repeat(${Math.max(visibleItems.length, 1)}, minmax(0, 1fr))` }}>{visibleItems.map((item, index) => <p key={index}><b>{index + 1}.</b><strong>{item.primary}</strong><span> = {item.secondary || item.note || '结构 + 动作 + 检查点'}</span></p>)}</div>
  </Shell>;
}

function EnglishGrammarGrid({ payload, items, className }: CoverProps) {
  const cells = payload.sections.flatMap(section => section.items.length ? [{ title: section.heading, body: section.items.map(item => `${item.primary}${item.secondary ? `，${item.secondary}` : ''}`).join('；') }] : []);
  return <Shell kind="grammar-grid" title={payload.title} className={className}>
    <div className="window-bar"><i /><i /><i /><span>⌕</span></div>
    <h1>{splitAccent(payload.title, '顺口溜')}</h1>
    <div className="grammar-grid">{cells.slice(0, 12).map((cell, index) => <section key={index}><h2>• {cell.title}</h2><p>{highlightWords(cell.body)}</p></section>)}</div>
  </Shell>;
}

function FrenchGenderVocab({ payload, items, className }: CoverProps) {
  const columns = chunk(items.slice(0, 42), 3);
  return <Shell kind="gender-vocab" title={payload.title} className={className}>
    <h1>{payload.title}</h1><div className="gender-columns">{columns.map((column, columnIndex) => <div key={columnIndex}>{column.map((item, index) => <p key={index}><b>{item.primary}</b><span>{item.secondary}</span></p>)}</div>)}</div>
  </Shell>;
}

function MaoArticleNotes({ payload, items, className }: CoverProps) {
  return <Shell kind="mao-notes" title={payload.title} className={className}>
    <img className="paper-photo" src="/generated-cover-backgrounds/article-notes-clean-v1.png" alt="" aria-hidden="true" />
    <div className="paper-overlay"><h1>{payload.title}</h1><p className="note-sub">{payload.subtitle}</p>
      <div className="hand-note-list">{items.slice(0, 8).map((item, index) => <section key={index}><h2>{index + 1}. <mark>{item.primary}</mark></h2><p>{item.secondary || '围绕原句、观点和可迁移用法进行整理。'}</p>{item.note ? <small>{item.note}</small> : null}</section>)}</div>
    </div>
  </Shell>;
}

function EnglishGrammarNotebook({ payload, items, className }: CoverProps) {
  return <Shell kind="grammar-note" title={payload.title} className={className}>
    <img className="paper-photo" src="/generated-cover-backgrounds/grammar-notebook-clean-v1.png" alt="" aria-hidden="true" />
    <div className="paper-overlay"><h1>{payload.title}</h1>
      <div className="grammar-note-list">{items.slice(0, 10).map((item, index) => <section key={index}><h2>{index + 1}. {item.primary}</h2><p>• {highlightWords(item.secondary || item.note || '规则、用法和短例句按考点整理')}</p></section>)}</div>
    </div>
  </Shell>;
}

function FrenchOralQuestionBank({ payload, items, className }: CoverProps) {
  return <Shell kind="oral-bank" title={payload.title} className={className}>
    <h1>{payload.title}</h1><p className="oral-sub">{payload.subtitle}</p>
    <div className="oral-list">{items.slice(0, 15).map((item, index) => <p key={index}><b>{index + 1}</b><span>{item.primary}</span><em>{item.secondary}</em></p>)}</div>
  </Shell>;
}

function FrenchA1Practice({ payload, items, className }: CoverProps) {
  return <Shell kind="a1-practice" title={payload.title} className={className}>
    <div className="practice-side"><span>主题</span><span>用途</span><span>级别</span></div>
    <small>FRENCH STUDY SHEET</small><h1>{payload.title}</h1>{payload.subtitle ? <p className="practice-subtitle">{payload.subtitle}</p> : null}
    <div className="practice-list" style={{ gridTemplateRows: `repeat(${Math.min(items.length, 8)}, 1fr)` }}>{items.slice(0, 8).map((item, index) => {
      const noteParts = typeof item.note === 'string' ? item.note.split(/[·｜|]/).map(value => value.trim()).filter(Boolean) : [];
      const secondaryParts = typeof item.secondary === 'string' ? item.secondary.split(/[·｜|]/).map(value => value.trim()).filter(Boolean) : [];
      const supports = (noteParts.length >= 4 ? noteParts : [...secondaryParts, ...noteParts])
        .map(value => value.replace(/^[A-DＡ-Ｄ][)）.、:\s-]*/iu, '').trim())
        .filter((value, valueIndex, values) => values.indexOf(value) === valueIndex)
        .slice(0, 4);
      return <section key={index}><h2>{index + 1}. {item.primary}</h2><div>{supports.map((support, supportIndex) => <span key={supportIndex}><b>{supportIndex + 1}</b>{support}</span>)}</div></section>;
    })}</div>
  </Shell>;
}

function SatVocabulary({ payload, items, className }: CoverProps) {
  const titleSize = visualLength(payload.title) > 28 ? '3.75cqw' : visualLength(payload.title) > 22 ? '4.35cqw' : '5.2cqw';
  return <Shell kind="sat-vocab" title={payload.title} className={className}>
    <header style={{ '--sat-title': titleSize } as React.CSSProperties}><h1>{payload.title}</h1><b>{payload.subtitle}</b></header>
    <div className="sat-rule" /><div className="sat-list">{items.slice(0, 22).map((item, index) => <p key={index}><strong>{item.primary}</strong><b>{lexicalLabel(item.primary)}</b><mark>{item.secondary || '核心释义'}</mark><span>{item.note || `A concise example explains how ${item.primary} is used in context.`}</span></p>)}</div>
  </Shell>;
}

function IeltsTaskOne({ payload, items, className }: CoverProps) {
  const sections = payload.sections.slice(0, 4);
  return <Shell kind="ielts-task1" title={payload.title} className={className}>
    <h1>{payload.title}</h1><p className="task-sub">{payload.subtitle}</p>
    <div className="task-sections">{sections.map((section, index) => <section key={index}><h2>{circled(index + 1)} {cleanStepHeading(section.heading)}</h2>{section.items.map((item, itemIndex) => <p key={itemIndex} className={itemIndex > 0 ? 'pink' : ''}>{item.primary}{item.secondary ? ` / ${item.secondary}` : ''}</p>)}</section>)}</div>
  </Shell>;
}

function chunk<T>(items: T[], count: number) { return Array.from({ length: count }, (_, index) => items.filter((_, itemIndex) => itemIndex % count === index)); }
function circled(index: number) { return ['①', '②', '③', '④'][index - 1] || String(index); }
function cleanStepHeading(value: string) { return value.replace(/^\s*(?:[①②③④]|\d+[.、]|第[一二三四1234]步)\s*/u, '').replace(/^[:：·\s]+/u, '').trim(); }
function visualLength(value: string) { return Array.from(value).reduce((sum, char) => sum + (/[^\x00-\xff]/u.test(char) ? 2 : 1), 0); }
function splitAccent(value: string, accent: string) { const index = value.indexOf(accent); return index < 0 ? value : <>{value.slice(0, index)}<em>{accent}</em>{value.slice(index + accent.length)}</>; }
function highlightWords(value: string) {
  const grammarTerm = /^(subjonctif|indicatif|conditionnel|infinitif|participe|gérondif|bien que|afin de|tandis que|cependant|pourtant)$/i;
  return value
    .split(/(subjonctif|indicatif|conditionnel|infinitif|participe|gérondif|bien que|afin de|tandis que|cependant|pourtant)/gi)
    .map((part, index) => grammarTerm.test(part) ? <mark key={index}>{part}</mark> : part);
}
function lexicalLabel(value: string) {
  const normalized = value.trim().toLocaleLowerCase('fr');
  if (/\s/u.test(normalized)) return 'EXPR.';
  if (/(?:er|ir|re)$/u.test(normalized)) return 'V.';
  return 'MOT';
}

function SharedStyles() { return <style>{`
.user-production-cover{position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;container-type:inline-size;background:#fff;color:#151515;box-shadow:0 18px 44px rgba(0,0,0,.16);font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif}
.user-production-cover *{box-sizing:border-box}.user-production-cover h1,.user-production-cover h2,.user-production-cover h3,.user-production-cover p{margin:0}.user-production-cover mark{color:inherit}
.user-production-cover--ielts-toc{display:flex;flex-direction:column;padding:3.5cqw 6.5cqw 3cqw}.user-production-cover--ielts-toc header{text-align:center}.user-production-cover--ielts-toc h1{color:#e21b12;font-size:7.2cqw;font-weight:500;line-height:1.08}.user-production-cover--ielts-toc h2{margin:1.2cqw 0 1.5cqw;font-size:4.8cqw}.toc-groups{display:flex;min-height:0;flex:1;flex-direction:column;justify-content:space-around;font-size:3.05cqw}.toc-groups section{margin:0}.toc-groups h3{color:#9e3539;font-size:3.35cqw}.toc-row{display:flex;align-items:baseline;gap:.6cqw;line-height:1.52}.toc-row span{flex:0 1 auto}.toc-row i{min-width:2cqw;flex:1;border-bottom:.23cqw dotted #3b3b3b}.toc-row b{font-weight:500}.user-production-cover--ielts-toc>small{position:absolute;right:4cqw;bottom:1.2cqw;color:#777;font-size:2.1cqw}
.user-production-cover--criminal{display:flex;flex-direction:column;padding:4.2cqw 4.5cqw}.user-production-cover--criminal h1{text-align:center;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;font-size:6.15cqw;font-weight:950;line-height:1.08}.criminal-rule{height:.55cqw;margin:1.8cqw 0 1.2cqw;background:#bd101b}.criminal-list{display:grid;min-height:0;flex:1;grid-template-rows:repeat(10,minmax(0,1fr));font-family:"LXGW WenKai","KaiTi","STKaiti",cursive}.criminal-list p{display:grid;min-height:0;grid-template-columns:4cqw minmax(15cqw,.8fr) minmax(0,1.55fr);align-items:center;column-gap:.8cqw;margin:0;border-bottom:.1cqw solid rgba(174,34,40,.18);font-size:2.72cqw;font-weight:700;line-height:1.08}.criminal-list strong,.criminal-list span{overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}.criminal-list strong{color:#ae2228}.criminal-list span{font-weight:600}
.user-production-cover--criminal{padding:3.6cqw 4.5cqw}.user-production-cover--criminal h1{font-size:5.8cqw}.criminal-rule{height:.5cqw;margin:1.25cqw 0 .8cqw}.criminal-list p{grid-template-columns:3.5cqw minmax(14cqw,.82fr) minmax(0,1.65fr);column-gap:.7cqw;font-size:2.32cqw;line-height:1.05}
.user-production-cover--grammar-grid{padding-top:5cqw}.window-bar{position:absolute;top:0;right:0;left:0;display:flex;align-items:center;gap:1.1cqw;height:4.2cqw;padding:0 3.6cqw;background:#e6e6e6}.window-bar i{width:1.6cqw;height:1.6cqw;border-radius:50%;background:#ef5d57}.window-bar i:nth-child(2){background:#f5bd3f}.window-bar i:nth-child(3){background:#54c653}.window-bar span{margin-left:auto}.user-production-cover--grammar-grid>h1{padding:3cqw 5cqw 2.6cqw;font-size:8.4cqw;line-height:1}.user-production-cover--grammar-grid>h1 em{color:#f32969;font-style:normal}.grammar-grid{display:grid;grid-template-columns:repeat(3,1fr);border-top:.18cqw solid #222}.grammar-grid section{min-height:23.5cqw;padding:2.1cqw 2.2cqw;border-right:.18cqw solid #222;border-bottom:.18cqw solid #222}.grammar-grid section:nth-child(3n){border-right:0}.grammar-grid h2{text-align:center;font-size:2.8cqw}.grammar-grid p{margin-top:1.35cqw;font-size:2.4cqw;line-height:1.55}.grammar-grid mark,.grammar-note-list mark{padding:0 .15em;background:#dbf4e8}
.user-production-cover--gender-vocab{display:flex;flex-direction:column;padding:3.2cqw}.user-production-cover--gender-vocab h1{margin-bottom:1.3cqw;text-align:center;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;font-size:4.7cqw;font-weight:900}.gender-columns{display:grid;min-height:0;flex:1;grid-template-columns:repeat(3,1fr);gap:1.7cqw}.gender-columns>div{display:grid;min-height:0;grid-auto-rows:minmax(0,1fr)}.gender-columns p{display:grid;min-height:0;grid-template-columns:minmax(0,1fr) minmax(0,.72fr);align-items:end;gap:.5cqw;padding:.18cqw 0;border-bottom:.12cqw solid #555;font-family:Georgia,"PingFang SC","Microsoft YaHei",sans-serif;font-size:2.35cqw;line-height:1.05}.gender-columns b,.gender-columns span{align-self:end;overflow:hidden;padding-bottom:.12cqw;text-overflow:ellipsis;white-space:nowrap}.gender-columns b{font-weight:600}.gender-columns span{color:#555;text-align:right}
.user-production-cover--mao-notes,.user-production-cover--grammar-note{background:#f7f3e8}.paper-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.paper-overlay{position:absolute;inset:0;padding:5.7cqw 4.8cqw 2.5cqw 12.5cqw;font-family:"LXGW WenKai","KaiTi",cursive}.user-production-cover--mao-notes h1{height:4.55cqw;overflow:hidden;color:#8f1f23;font-size:4.1cqw;line-height:4.55cqw;white-space:nowrap;text-overflow:ellipsis}.note-sub{height:4.55cqw;overflow:hidden;color:#294369;font-size:2.35cqw;line-height:4.55cqw;white-space:nowrap;text-overflow:ellipsis}.hand-note-list,.grammar-note-list{margin:0}.hand-note-list section,.grammar-note-list section{height:9.1cqw;overflow:hidden;margin:0}.hand-note-list h2,.hand-note-list p,.grammar-note-list h2,.grammar-note-list p{height:4.55cqw;overflow:hidden;line-height:4.55cqw;white-space:nowrap;text-overflow:ellipsis}.hand-note-list h2{color:#7e2226;font-size:2.65cqw}.hand-note-list h2 mark{background:linear-gradient(transparent 46%,#f1d15b 46% 86%,transparent 86%)}.hand-note-list p{padding-left:2.8cqw;font-size:2.18cqw}.user-production-cover--grammar-note h1{height:9.1cqw;overflow:hidden;text-align:center;font-size:4.8cqw;line-height:4.55cqw}.grammar-note-list h2{color:#368d18;font-size:2.62cqw;font-weight:800}.grammar-note-list p{font-size:2.2cqw}
.user-production-cover--oral-bank{display:flex;flex-direction:column;padding:3.2cqw 3.6cqw;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif}.user-production-cover--oral-bank h1{font-size:5.35cqw;font-weight:950;line-height:1.08}.oral-sub{margin:.65cqw 0 1cqw;border-bottom:.25cqw solid #222;padding-bottom:.8cqw;font-size:2.7cqw;font-weight:700}.oral-list{display:grid;min-height:0;flex:1;grid-template-rows:repeat(15,minmax(0,1fr))}.oral-list p{display:grid;min-height:0;grid-template-columns:3.7cqw minmax(0,1fr);align-content:center;gap:.08cqw 1.1cqw;margin:0;border-bottom:.1cqw solid #ddd;font-size:2.72cqw;line-height:1.08}.oral-list b{grid-row:1 / span 2;font-family:Georgia,serif;font-weight:700}.oral-list span,.oral-list em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.oral-list em{grid-column:2;color:#555;font-style:normal}
.user-production-cover--a1-practice{display:flex;flex-direction:column;padding:3cqw 3.5cqw 3cqw 10cqw;font-family:Arial,"Microsoft YaHei",sans-serif}.practice-side{position:absolute;top:17cqw;bottom:3cqw;left:2.2cqw;display:flex;width:5.4cqw;flex-direction:column;justify-content:space-around;border-right:.2cqw dotted #222;writing-mode:vertical-rl}.practice-side span{font-family:"KaiTi",serif;font-size:2.8cqw}.user-production-cover--a1-practice>small{font-size:2.25cqw;font-weight:800}.user-production-cover--a1-practice>h1{margin:.5cqw 0 .25cqw;font-family:"KaiTi",serif;font-size:7.1cqw;font-weight:900;letter-spacing:.02em}.practice-subtitle{margin:0 0 .55cqw;color:#555;font-size:2.55cqw;font-weight:700}.practice-list{display:grid;min-height:0;flex:1}.practice-list section{display:flex;min-height:0;flex-direction:column;justify-content:center;margin:0}.practice-list h2{font-size:3.75cqw;font-style:italic;font-weight:900}.practice-list section>div{display:grid;grid-template-columns:1fr 1fr;gap:.55cqw 3.2cqw;padding:.45cqw 0 0 3cqw;font-size:3.45cqw;font-style:italic}
.user-production-cover--sat-vocab{display:flex;flex-direction:column;padding:3.5cqw 4.2cqw;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif}.user-production-cover--sat-vocab header{display:grid;grid-template-columns:minmax(0,1fr) 28cqw;align-items:end;gap:2cqw}.user-production-cover--sat-vocab h1{overflow:hidden;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;font-size:var(--sat-title,5.2cqw);font-weight:950;line-height:1.08;text-overflow:ellipsis;white-space:nowrap}.user-production-cover--sat-vocab header b{color:#a52024;font-family:Georgia,serif;font-size:2.65cqw;line-height:1.2;text-align:right}.sat-rule{height:.35cqw;margin:1.2cqw -4.2cqw 1.2cqw;background:#a52024}.sat-list{display:grid;min-height:0;flex:1;grid-template-rows:repeat(22,minmax(0,1fr))}.sat-list p{display:grid;min-height:0;grid-template-columns:21.5cqw 6.5cqw 16cqw 1fr;align-items:center;gap:.5cqw;margin:0;font-size:2.02cqw;line-height:1.12}.sat-list strong{color:#c31d26;font-family:Georgia,serif;font-size:2.05cqw;overflow-wrap:anywhere}.sat-list b{color:#344ca0;font-size:1.8cqw;white-space:nowrap}.sat-list mark{background:transparent;color:#16884b}.sat-list span{font-family:Arial,sans-serif;overflow-wrap:anywhere}
.user-production-cover--ielts-task1{display:flex;flex-direction:column;padding:3.7cqw 4.5cqw}.user-production-cover--ielts-task1>h1{font-size:5.4cqw;font-weight:950}.task-sub{margin:.8cqw 0 1.4cqw;color:#555;font-size:2.55cqw;font-weight:650}.task-sections{display:grid;min-height:0;flex:1;grid-template-rows:repeat(4,1fr)}.task-sections section{display:flex;min-height:0;flex-direction:column;justify-content:center;margin:0}.task-sections h2{display:table;padding:.35cqw .7cqw;background:#a7e7f6;font-size:3.25cqw;font-weight:900}.task-sections p{margin-top:1.25cqw;font-size:3.05cqw;line-height:1.42}.task-sections p.pink{display:table;padding:.1cqw .4cqw;background:linear-gradient(transparent 12%,#f2a9ef 12% 88%,transparent 88%)}
/* The 12-cell grammar master must fit inside the fixed 3:4 canvas instead of growing the article. */
.user-production-cover--grammar-grid{display:flex;height:auto;flex-direction:column;padding-top:4.2cqw}.window-bar span{font-size:2.35cqw;line-height:1}.user-production-cover--grammar-grid>h1{flex:0 0 auto;padding:2.2cqw 4cqw 1.8cqw;font-size:7.1cqw}.grammar-grid{display:grid;overflow:hidden;min-height:0;flex:1;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(4,minmax(0,1fr))}.grammar-grid section{overflow:hidden;min-height:0;padding:1.2cqw 1.45cqw}.grammar-grid h2{font-size:2.35cqw;line-height:1.18}.grammar-grid p{overflow:hidden;display:-webkit-box;margin-top:.7cqw;font-size:2.05cqw;line-height:1.3;-webkit-box-orient:vertical;-webkit-line-clamp:5}
/* Production readability overrides, matched against the supplied masters. */
.user-production-cover--ielts-toc{padding:3cqw 5.3cqw 2.8cqw}.user-production-cover--ielts-toc h1{font-size:clamp(30px,9.3cqw,68px);font-weight:850;line-height:1.04}.user-production-cover--ielts-toc h2{margin:.8cqw 0 1.1cqw;font-size:clamp(18px,5.35cqw,40px);font-weight:850}.toc-groups{font-size:clamp(10px,3.65cqw,23px)}.toc-groups h3{font-size:clamp(11px,3.8cqw,25px);font-weight:850}.toc-row{line-height:1.35}.toc-row b{font-weight:700}
.user-production-cover--grammar-grid>h1{padding:2.5cqw 4cqw 2.8cqw;text-align:center;font-family:"STXinwei","FZShuTi","LXGW WenKai","KaiTi",cursive;font-size:7.6cqw;font-weight:850;line-height:1.02}.grammar-grid h2{font-size:2.5cqw;font-weight:900}.grammar-grid p{font-size:2.2cqw;line-height:1.28;-webkit-line-clamp:6}
.hand-note-list section{height:13.65cqw}.hand-note-list h2,.hand-note-list p,.hand-note-list small{display:block;height:4.55cqw;overflow:hidden;line-height:4.55cqw;white-space:nowrap;text-overflow:ellipsis}.hand-note-list h2{font-size:2.9cqw}.hand-note-list h2 mark{display:inline-block;overflow:hidden;max-width:86%;vertical-align:bottom;text-overflow:ellipsis}.hand-note-list p{padding-left:2.8cqw;font-size:2.35cqw}.hand-note-list small{padding-left:5.2cqw;color:#294369;font-size:2.05cqw}
.user-production-cover--a1-practice{padding:2.6cqw 3.5cqw 2.6cqw 9.2cqw}.practice-side{width:4.8cqw;writing-mode:horizontal-tb}.practice-side span{writing-mode:vertical-rl}.user-production-cover--a1-practice>small{font-size:clamp(9px,2.45cqw,16px)}.user-production-cover--a1-practice>h1{margin:.4cqw 0 .2cqw;font-size:clamp(27px,8.4cqw,54px);letter-spacing:0;line-height:1.06}.practice-subtitle{margin-bottom:.35cqw;font-size:clamp(10px,2.8cqw,18px)}.practice-list h2{font-size:clamp(13px,4.15cqw,27px);font-style:normal;font-weight:950;line-height:1.14}.practice-list section>div{gap:.5cqw 2.2cqw;padding:.4cqw 0 0 2.2cqw;font-size:clamp(11px,3.75cqw,24px);font-style:normal;line-height:1.18}.practice-list section>div span{display:grid;grid-template-columns:2.4cqw minmax(0,1fr);gap:.35cqw}.practice-list section>div b{color:#b72a32;font-family:Georgia,serif;font-size:.8em}
`}</style>; }
