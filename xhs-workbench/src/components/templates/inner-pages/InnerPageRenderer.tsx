'use client';

import type { CSSProperties } from 'react';
import type { GeneratedInnerPage, InnerPageStyleVariant, StructuredRenderPayload } from '@/types/reference-workflow';
import { useAutoFitScale } from '@/components/templates/useAutoFitScale';
import {readableItemLabel,readableStyles} from '@/lib/readable-inner-layout';
import {inlineRuns,publicInnerTitle,type InlineRun} from '@/lib/inner-display-text';

function InlineText({runs}:{runs:InlineRun[]}){return <>{runs.map((run,i)=>run.kind==='strong'?<strong key={i}>{run.text}</strong>:run.kind==='em'?<em key={i}>{run.text}</em>:<span key={i}>{run.text}</span>)}</>;}

import {STYLE_CONFIGS} from '@/lib/inner-paper-styles';

const PUNCH_HOLE_STYLE: CSSProperties = {
  position: 'absolute',
  left: '8px',
  width: '14px',
  height: '14px',
  borderRadius: '50%',
  background: 'rgba(40, 60, 50, 0.20)',
  border: '1px solid rgba(40,60,50,.18)',
};

export interface InnerPageRendererProps {
  page: GeneratedInnerPage;
  registerNode?: (node: HTMLElement | null) => void;
  /** When provided, the renderer will also expose its scaled node via this ref. */
  fitRefOverride?: ReturnType<typeof useAutoFitScale<HTMLElement>>;
}

export function InnerPageRenderer({ page, registerNode }: InnerPageRendererProps) {
  const variant: InnerPageStyleVariant = page.style_variant ?? 'lined-notebook';
  const cfg = STYLE_CONFIGS[variant];

  const fingerprint = `${page.page_title}|${page.lead}|${page.bullets.join('|')}|${variant}`;
  const fitRef = useAutoFitScale<HTMLElement>([fingerprint], { min: 0.4, max: 1, step: 0.025 });
  // 身份必须由生产数据明确传入；旧草稿缺字段时宁可使用中性标签，不能把
  // DELF B2 静默灌进 TEF/TCF 页面。
  const productLabel = page.product_identity || '法语考试学习资料';
  if(page.readableLayout){
    const s=readableStyles('cqw',variant,page.semanticLayoutType);
    return <div style={{containerType:'inline-size'}}><article ref={registerNode} style={s.article} data-readable-layout="1" data-source-page-no={page.readableLayout.sourcePageNo} data-readable-part={page.readableLayout.part} data-readable-total={page.readableLayout.total}>
      <header style={s.header}>P{page.page_no} · {productLabel}</header>
      <h3 style={s.title}><InlineText runs={inlineRuns(publicInnerTitle(page.page_title))} /></h3>
      <div style={s.divider} />
      {page.lead && <p style={{...s.text,...s.lead}}><InlineText runs={page.readableLayout.leadRuns} /></p>}
      <div data-source-item-count={page.bullets.length}>{page.bullets.map((text,index)=><p key={index} data-render-item="true" style={{...s.text,...s.item}}><span style={s.number}>{readableItemLabel(page.semanticLayoutType,page.readableLayout!.bulletNumbers[index]-1)}</span><span><InlineText runs={page.readableLayout!.bulletRuns[index]} /></span></p>)}</div>
    </article></div>;
  }
  const productIdentity = productLabel.toUpperCase();
  const isProductLibraryBridge = page.showcase_asset_image?.includes('tef-tcf-product-library-collage')
    || page.showcase_asset_image?.includes('tcf-writing-7day-product-library-collage')
    || page.showcase_asset_id?.includes('tef_tcf_canada')
    || page.showcase_asset_id?.includes('tcf_canada_writing_7day');

  if (page.page_type === 'product_bridge') {
    return (
      <article
        ref={(node) => { fitRef.current = node; registerNode?.(node); }}
        className="relative aspect-[3/4] overflow-hidden border border-[#dedbd3] bg-[#ececeb] text-[#2F2F2F]"
        style={{ containerType: 'inline-size', fontFamily: '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif' }}
      >
        {page.showcase_asset_image ? <img
          src={page.showcase_asset_image}
          alt={`${productLabel}内容总览`}
          className="absolute inset-0 h-full w-full object-contain object-center"
        /> : <div className="absolute inset-0 bg-[linear-gradient(135deg,#f3eee1,#d7e2db)]" />}

        <section className="absolute right-[3.5%] top-[47%] w-[43%] text-left">
          <header className="font-bold tracking-[0.12em] text-[#b93535]" style={{ fontSize: isProductLibraryBridge ? 'clamp(10px, 1.8cqw, 20px)' : 'clamp(7px, 1.8cqw, 11px)' }}>
            {productIdentity}
          </header>
          <h3 className="mt-[4%] font-black leading-[1.16] text-[#171717]" style={{ fontSize: isProductLibraryBridge ? 'clamp(22px, 4.8cqw, 52px)' : 'clamp(18px, 4.8cqw, 29px)', overflowWrap: 'anywhere', textShadow: '0 1px 0 rgba(255,255,255,.9)' }}>{page.page_title || `${productLabel}资料库`}</h3>
          <p className="mt-[5%] font-bold leading-[1.5] text-[#d94716]" style={{ fontSize: isProductLibraryBridge ? 'clamp(15px, 2.65cqw, 29px)' : 'clamp(10px, 2.65cqw, 16px)', textShadow: '0 1px 0 rgba(255,255,255,.95)' }}>
            {page.lead}
          </p>
          {isProductLibraryBridge ? <p className="mt-[5%] font-semibold leading-[1.55] text-[#262626]" style={{ fontSize: 'clamp(13px, 2.25cqw, 24px)', textShadow: '0 1px 0 rgba(255,255,255,.95)' }}>
            {page.bullets.slice(0, 2).join('。')}。
          </p> : <div className="mt-[4%] space-y-[3%] font-semibold leading-[1.55] text-[#262626]" style={{ fontSize: 'clamp(9px, 2.25cqw, 14px)', textShadow: '0 1px 0 rgba(255,255,255,.95)' }}>
            {page.bullets.slice(0, 3).map((bullet, index) => <p key={`${bullet}-${index}`}>· {bullet}</p>)}
          </div>}
          <footer className="mt-[6%] inline box-decoration-clone bg-[#ffe06a] px-[2%] py-[1%] font-black leading-[1.65] text-[#111111]" style={{ fontSize: isProductLibraryBridge ? 'clamp(14px, 2.55cqw, 28px)' : 'clamp(10px, 2.55cqw, 15px)' }}>
            完整资料请点击下方链接查看 ⬇️⬇️⬇️⬇️⬇️
          </footer>
        </section>
      </article>
    );
  }

  if (page.showcase_asset_id) {
    return (
      <article
        ref={(node) => { fitRef.current = node; registerNode?.(node); }}
        className="aspect-[3/4] overflow-hidden border border-[#E0E0E0] bg-[#F5F5F0] p-[7%] text-[#2F2F2F]"
        style={{ containerType: 'inline-size', fontFamily: '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif' }}
      >
        <div className="flex items-center justify-between font-semibold text-[#888888]" style={{ fontSize: 'clamp(8px, 2cqw, 11px)' }}>
          <span>知识库 · {page.showcase_asset_label || '资料卡'}</span><span>P{page.page_no}</span>
        </div>
        {page.showcase_asset_image ? (
          <div className="mt-[3%] overflow-hidden border border-[#E0E0E0] bg-white" style={{ height: '58%' }}>
            <img src={page.showcase_asset_image} alt={page.showcase_asset_label || '商品资料截图'} className="h-full w-full object-contain" />
          </div>
        ) : null}
        <div className="mt-[3%] border-b border-[#D8D5CF] pb-[2%] font-semibold text-[#A64B4B]" style={{ fontSize: 'clamp(8px, 2cqw, 11px)' }}>
          商品资料页
        </div>
        <h3 className="mt-[3%] font-bold leading-[1.35]" style={{ fontSize: 'clamp(15px, 5.2cqw, 20px)' }}>{page.page_title}</h3>
        <p className="mt-[2%] font-medium leading-[1.8] text-[#66635F]" style={{ fontSize: 'clamp(9px, 3.4cqw, 14px)' }}>{page.lead}</p>
        <div className="mt-[2%] space-y-[1.5%]" style={{ fontSize: 'clamp(9px, 3.25cqw, 13px)' }}>
          {page.bullets.slice(0, 2).map((bullet, index) => <div key={`${bullet}-${index}`} className="flex gap-2 leading-[1.75]"><span className="font-bold text-[#A64B4B]">{String(index + 1).padStart(2, '0')}</span><span>{bullet}</span></div>)}
        </div>
      </article>
    );
  }

  // 只有 schema 已验证的 payload 才能接管可见内容。旧/返修页面常同时带有
  // INS UFFICIENT 状态与残缺 payload；此前仍进入专用布局，结果把完整 bullets
  // 隐藏成空白页。状态不为 VALID 时安全回退到普通知识卡片。
  if (page.renderPayloadStatus === 'VALID' && page.renderPayload && (page.semanticLayoutType === 'comparison' || page.semanticLayoutType === 'checklist' || page.semanticLayoutType === 'expression_bank')) {
    return <SemanticLayoutPage page={page} layoutType={page.semanticLayoutType} registerNode={registerNode} />;
  }

  const articleStyle: CSSProperties = {
    containerType: 'inline-size',
    backgroundColor: cfg.backgroundColor,
    backgroundImage: cfg.backgroundImage,
    backgroundSize: cfg.backgroundSize,
    // Keep the 3:4 production canvas, but reserve a little more usable area
    // for long bilingual cards at the phone-width preview size.
    padding: 'calc(5% * var(--fit-scale, 1))',
    fontFamily: '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif',
    ...cfg.wrapperStyle,
  };

  return (
    <article
      ref={(node) => { fitRef.current = node; registerNode?.(node); }}
      className={`aspect-[3/4] overflow-hidden border ${cfg.borderColor} ${cfg.articleClass ?? ''} flex flex-col relative`}
      style={articleStyle}
    >
      {cfg.showPunchHoles ? (
        <>
          <span style={{ ...PUNCH_HOLE_STYLE, top: '14%' }} />
          <span style={{ ...PUNCH_HOLE_STYLE, top: '50%' }} />
          <span style={{ ...PUNCH_HOLE_STYLE, top: '86%' }} />
        </>
      ) : null}

      <div className={`flex flex-shrink-0 items-center justify-between font-semibold ${cfg.headerColor}`} style={{ fontSize: 'clamp(8px, calc(2cqw * var(--fit-scale, 1)), 11px)' }}>
        <span>P{page.page_no}</span>
        <span>{productLabel}</span>
      </div>
      {page.showcase_asset_image ? (
        <div className="mt-3 flex-shrink-0 overflow-hidden border border-black/10 bg-white/70" style={{ height: '25%', minHeight: 70 }}>
          <img src={page.showcase_asset_image} alt={page.showcase_asset_label || '商品资料截图'} className="h-full w-full object-cover" />
        </div>
      ) : null}
      <h3 className={`flex-shrink-0 font-bold leading-[1.35] ${cfg.titleColor}`} style={{ marginTop: 'calc(1rem * var(--fit-scale, 1))', fontSize: 'clamp(15px, calc(5.2cqw * var(--fit-scale, 1)), 20px)' }}>
        {page.page_title}
      </h3>
      <div className={`h-px flex-shrink-0 ${cfg.dividerColor}`} style={{ marginTop: 'calc(0.6rem * var(--fit-scale, 1))' }} />
      <p className={`flex-shrink-0 font-medium leading-[1.5] ${cfg.leadColor}`} style={{ marginTop: 'calc(0.5rem * var(--fit-scale, 1))', fontSize: 'clamp(10px, calc(3.55cqw * var(--fit-scale, 1)), 16px)', letterSpacing: '0.01em' }}>
        {page.lead}
      </p>
      <ul data-source-item-count={page.bullets.length} className={`flex-shrink-0 leading-[1.5] ${cfg.bulletColor}`} style={{ marginTop: 'calc(0.5rem * var(--fit-scale, 1))', fontSize: 'clamp(10px, calc(3.65cqw * var(--fit-scale, 1)), 16px)', letterSpacing: '0.01em' }}>
        {page.bullets.map((bullet, index) => (
          <li data-render-item="true" className="grid grid-cols-[22px_1fr] gap-2" style={{ marginBottom: 'calc(0.26rem * var(--fit-scale, 1))' }} key={`${bullet}-${index}`}>
            <span className={`font-black ${cfg.bulletAccent}`}>{String(index + 1).padStart(2, '0')}</span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function SemanticLayoutPage({ page, layoutType, registerNode }: { page: GeneratedInnerPage; layoutType: 'comparison' | 'checklist' | 'expression_bank'; registerNode?: (node: HTMLElement | null) => void }) {
  const payload = page.renderPayload;
  const productLabel = page.product_identity || '法语考试学习资料';
  const fingerprint = `${page.page_title}|${page.lead}|${page.bullets.join('|')}|${layoutType}`;
  const fitRef = useAutoFitScale<HTMLElement>([fingerprint], { min: 0.72, max: 1, step: 0.025 });
  return (
    <article
      ref={(node) => { fitRef.current = node; registerNode?.(node); }}
      className="relative flex aspect-[3/4] flex-col overflow-hidden border border-[#E0E0E0] bg-[#F5F5F0] p-[7%] text-[#2F2F2F]"
      style={{ containerType: 'inline-size', fontFamily: '"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif', padding: 'calc(6% * var(--fit-scale, 1))' }}
      data-semantic-layout={layoutType}
    >
      <div className="flex flex-shrink-0 items-center justify-between text-[clamp(8px,2cqw,11px)] font-semibold text-[#888888]"><span>P{page.page_no}</span><span>{productLabel}</span></div>
      <h3 className="mt-[3%] flex-shrink-0 font-bold leading-[1.3]" style={{ fontSize: 'clamp(15px, calc(5.2cqw * var(--fit-scale, 1)), 22px)' }}>{page.page_title}</h3>
      <div className="mt-[3%] h-px flex-shrink-0 bg-[#D8D5CF]" />
      <p className="mt-[2.5%] flex-shrink-0 font-medium leading-[1.55] text-[#66635F]" style={{ fontSize: 'clamp(9px, calc(3.25cqw * var(--fit-scale, 1)), 15px)' }}>{page.lead}</p>
      {!payload ? <div className="mt-[5%] border border-[#A64B4B] p-[4%] text-sm text-[#A64B4B]">INSUFFICIENT_STRUCTURED_CONTENT</div> : layoutType === 'comparison' ? (
        <ComparisonPayload payload={payload} />
      ) : layoutType === 'checklist' ? (
        <div className="mt-[3%] grid min-h-0 flex-1 grid-cols-2 gap-[3%] content-start">
          {(payload.items || []).map((item, index) => <div className="border border-[#E0E0E0] bg-white/55 p-[4%] leading-[1.5]" style={{ fontSize: 'clamp(9px, calc(3.1cqw * var(--fit-scale, 1)), 14px)' }} key={`${item.check}-${index}`}><div className="font-bold text-[#A64B4B]">✓ {item.check}</div><div className="mt-[3%]">{item.criterion}</div><div className="mt-[3%] text-[#66635F]">不通过时：{item.actionIfFail}</div></div>)}
        </div>
      ) : (
        <div className="mt-[3%] grid min-h-0 flex-1 grid-cols-2 gap-[3%] content-start">{(payload.groups || []).flatMap((group) => group.items).map((item, index) => <div className="border-l-[3px] border-[#A64B4B] bg-white/55 p-[4%] leading-[1.5]" style={{ fontSize: 'clamp(9px, calc(3.1cqw * var(--fit-scale, 1)), 14px)' }} key={`${item.fr}-${index}`}><div className="font-bold text-[#2F2F2F]">{item.fr}</div><div className="mt-[3%] text-[#66635F]">{item.zh}</div>{item.note ? <div className="mt-[3%] text-[#A64B4B]">{item.note}</div> : null}</div>)}</div>
      )}
    </article>
  );
}

function ComparisonPayload({ payload }: { payload: StructuredRenderPayload }) {
  const columns = [payload.left, payload.right].filter(Boolean) as Array<{ label: string; items: Array<{ text: string; note?: string }> }>;
  return <div className="mt-[3%] min-h-0 flex-1">
    <div className="grid grid-cols-2 gap-[3%]">
      {columns.map((column) => <div className="min-w-0 border border-[#D8D5CF] bg-white/55 p-[4%]" key={column.label}>
        <div className="mb-[5%] border-b border-[#A64B4B] pb-[3%] text-[clamp(10px,3cqw,14px)] font-bold text-[#A64B4B]">{column.label}</div>
        <div className="space-y-[6%] text-[clamp(9px,2.8cqw,13px)] leading-[1.55]">{column.items.map((item, index) => <p key={`${item.text}-${index}`}>{item.text}{item.note ? <span className="mt-1 block text-[#66635F]">{item.note}</span> : null}</p>)}</div>
      </div>)}
    </div>
    {payload.takeaway ? <p className="mt-[3%] border-t border-[#D8D5CF] pt-[3%] text-[clamp(9px,2.8cqw,13px)] leading-[1.5] text-[#66635F]">{payload.takeaway}</p> : null}
  </div>;
}
