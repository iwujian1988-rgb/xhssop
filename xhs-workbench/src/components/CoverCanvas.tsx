'use client';

import React from 'react';
import { Stage, Layer, Rect, Text, Line, Group, Circle } from 'react-konva';
import { CoverVariant } from '@/types/workflow';
import { CoverTemplate } from '@/types/data';

interface CoverCanvasProps {
  variant: CoverVariant;
  coverTemplate: CoverTemplate;
  width: number;
  height: number;
  selected?: boolean;
  onClick?: () => void;
}

type PreviewSet = {
  product: string;
  modules: string[];
  rows: Array<[string, string]>;
  checklist: string[];
  tags: string[];
};

type CoverBlockProps = {
  width: number;
  height: number;
  title: string[];
  preview: PreviewSet;
  styleId?: string;
};

const delfPreview: PreviewSet = {
  product: 'DELF B2 写作知识库',
  modules: ['20篇范文库', '100句法库', '240词汇库', '36项检查'],
  rows: [
    ['普通写法', 'Je pense que...'],
    ['B2写法', 'Il me semble essentiel de...'],
    ['扣分点', '观点散、连接弱、例子少'],
  ],
  checklist: ['范文拆解', '句型迁移', '错题对照', '考前速查'],
  tags: ['B2写作', '范文库', '可迁移'],
};

const tefPreview: PreviewSet = {
  product: 'TEF/TCF Canada 知识库',
  modules: ['选考指南', 'CLB7自测', '50句型', '600主题词'],
  rows: [
    ['TEF', '节奏快，题型固定感强'],
    ['TCF', '机考适应更关键'],
    ['先判断', '目标分、弱项、备考时间'],
  ],
  checklist: ['先测差距', '定考试类型', '拆30天计划', '按弱项补资料'],
  tags: ['CLB7', '移民法语', '30天计划'],
};

export default function CoverCanvas({
  variant,
  coverTemplate,
  width,
  selected = false,
  onClick,
}: CoverCanvasProps) {
  const displayWidth = Math.min(width, 360);
  const displayHeight = (displayWidth / 3) * 4;
  const preview = getPreviewSet(variant);
  const title = normalizeTitle(variant.cover_title_lines, variant.cover_title);
  const styleId = variant.competitor_style_id || inferStyleId(variant.layout_notes, coverTemplate.id);

  return (
    <div
      className={`cursor-pointer overflow-hidden rounded-lg border-2 transition-all ${
        selected ? 'border-blue-500 shadow-lg ring-2 ring-blue-300' : 'border-gray-200 hover:border-gray-400'
      }`}
      onClick={onClick}
      style={{ width: displayWidth }}
    >
      <Stage width={displayWidth} height={displayHeight}>
        <Layer>
          <Rect x={0} y={0} width={displayWidth} height={displayHeight} fill={backgroundFor(styleId)} />
          {renderCover({ width: displayWidth, height: displayHeight, title, preview, styleId })}
        </Layer>
      </Stage>
    </div>
  );
}

function renderCover(props: CoverBlockProps) {
  const style = props.styleId || '';
  if (style === 'list_redblue_dashboard') return <ListDashboard {...props} />;
  if (style === 'list_dense_pack') return <ListDensePack {...props} />;
  if (style === 'table_split_decision') return <DecisionSplit {...props} />;
  if (style === 'table_big_grid') return <TableGrid {...props} />;
  if (style === 'pain_doc_callout') return <PainDoc {...props} />;
  if (style === 'pain_big_words') return <PainBigWords {...props} />;
  if (style === 'doc_feishu_window') return <DocWindow {...props} />;
  if (style === 'doc_stack_sample') return <DocStack {...props} />;
  if (style === 'practice_answer_mark') return <PracticeMarked {...props} />;
  if (style === 'practice_question_sheet') return <PracticeSheet {...props} />;
  if (style === 'rescue_timeline') return <RescueTimeline {...props} />;
  if (style === 'rescue_countdown') return <RescueCountdown {...props} />;
  return <ListDensePack {...props} />;
}

function ListDensePack({ width, height, title, preview }: CoverBlockProps) {
  return (
    <Group>
      <Badge x={22} y={52} text="已整理好" fill="#1F6FBD" />
      <Badge x={width - 104} y={52} text="建议收藏" fill="#FFF2F0" textColor="#C3423F" stroke="#F1B0AA" />
      <TitleBlock width={width} y={94} title={title} color="#101B2B" maxLines={2} />
      <KnowledgePack width={width} height={height} y={height * 0.39} preview={preview} />
      <BottomBar width={width} y={height * 0.87} text="目录 + 样张 + 对照 + 检查清单，一套放进去" />
    </Group>
  );
}

function ListDashboard({ width, height, title, preview }: CoverBlockProps) {
  return (
    <Group>
      <Rect x={0} y={0} width={width} height={height} fill="#FFFFFF" />
      <Rect x={24} y={46} width={width - 48} height={48} fill="#EAF3FF" cornerRadius={14} />
      <Text x={38} y={62} text={preview.product} fontSize={13} fontStyle="bold" fill="#1F6FBD" />
      <TitleBlock width={width} y={116} title={title} color="#101828" maxLines={2} />
      <Group y={height * 0.36}>
        {preview.modules.map((item, i) => (
          <Group key={item} x={28 + (i % 2) * 154} y={Math.floor(i / 2) * 72}>
            <Rect width={140} height={58} fill={i === 0 ? '#142033' : '#F5F8FC'} stroke={i === 0 ? '#142033' : '#D9E2EC'} strokeWidth={1} cornerRadius={12} />
            <Text x={12} y={10} text={item.match(/\d+/)?.[0] || '✓'} fontSize={22} fontStyle="bold" fill={i === 0 ? '#FFFFFF' : '#C3423F'} />
            <Text x={48} y={17} text={item.replace(/\d+/g, '')} fontSize={12} fill={i === 0 ? '#DDE8F6' : '#1D2939'} width={78} />
          </Group>
        ))}
      </Group>
      <Rect x={28} y={height * 0.72} width={width - 56} height={74} fill="#FFF2F0" stroke="#F3B5AF" strokeWidth={1} cornerRadius={14} />
      {preview.checklist.slice(0, 3).map((item, i) => (
        <Text key={item} x={46} y={height * 0.742 + i * 20} text={`✓ ${item}`} fontSize={12} fontStyle="bold" fill="#B42318" width={width - 92} />
      ))}
    </Group>
  );
}

function TableGrid({ width, height, title, preview }: CoverBlockProps) {
  return (
    <Group>
      <Header width={width} preview={preview} />
      <TitleBlock width={width} y={70} title={title} color="#101828" maxLines={2} />
      <Rect x={24} y={height * 0.31} width={width - 48} height={height * 0.52} fill="#FFFFFF" stroke="#C9D8E8" strokeWidth={1.5} cornerRadius={12} />
      <Rect x={24} y={height * 0.31} width={width - 48} height={36} fill="#EAF3FF" cornerRadius={[12, 12, 0, 0]} />
      <Text x={42} y={height * 0.333} text="低效/问题" fontSize={12} fontStyle="bold" fill="#C3423F" />
      <Text x={width / 2 + 14} y={height * 0.333} text="更建议" fontSize={12} fontStyle="bold" fill="#1F6FBD" />
      <Line points={[width / 2, height * 0.31, width / 2, height * 0.83]} stroke="#D5E1EE" strokeWidth={1} />
      {preview.rows.map((row, i) => (
        <Group key={row.join('-')}>
          <Line points={[24, height * (0.405 + i * 0.13), width - 24, height * (0.405 + i * 0.13)]} stroke="#E6EDF5" strokeWidth={1} />
          <Text x={42} y={height * (0.435 + i * 0.13)} text={row[0]} fontSize={12} fill="#52616F" width={(width - 100) / 2} lineHeight={1.25} />
          <Text x={width / 2 + 14} y={height * (0.435 + i * 0.13)} text={row[1]} fontSize={12} fill="#1D2B38" width={(width - 92) / 2} lineHeight={1.25} fontStyle="bold" />
        </Group>
      ))}
    </Group>
  );
}

function DecisionSplit({ width, height, title, preview }: CoverBlockProps) {
  return (
    <Group>
      <Header width={width} preview={preview} />
      <TitleBlock width={width} y={82} title={title} color="#111827" maxLines={2} />
      <DecisionCard x={28} y={height * 0.37} w={(width - 70) / 2} h={130} title={preview.rows[0][0]} body={preview.rows[0][1]} color="#C3423F" />
      <Text x={width / 2 - 22} y={height * 0.45} text="VS" fontSize={24} fontStyle="bold" fill="#111827" width={44} align="center" />
      <DecisionCard x={width / 2 + 12} y={height * 0.37} w={(width - 70) / 2} h={130} title={preview.rows[1][0]} body={preview.rows[1][1]} color="#1F6FBD" />
      <BottomBar width={width} y={height * 0.78} text={preview.rows[2]?.[1] || '先看差别，再做选择'} />
    </Group>
  );
}

function PainBigWords({ width, height, title, preview }: CoverBlockProps) {
  return (
    <Group>
      <Rect x={0} y={0} width={width} height={height} fill="#FFFFFF" />
      <Text x={28} y={62} text="别再这样备考" fontSize={16} fontStyle="bold" fill="#C3423F" />
      <TitleBlock width={width} y={112} title={title} color="#101828" maxLines={3} />
      <Rect x={28} y={height * 0.56} width={width - 56} height={height * 0.24} fill="#F8FAFC" stroke="#D9E2EC" strokeWidth={1.2} cornerRadius={14} />
      {['资料越囤越多', '题目一换就卡', '考前不知道先看哪份'].map((item, i) => (
        <Text key={item} x={50} y={height * 0.60 + i * 30} text={`× ${item}`} fontSize={14} fontStyle="bold" fill={i === 0 ? '#C3423F' : '#263544'} />
      ))}
      <ModuleStrip width={width} y={height * 0.86} items={preview.tags} color="#1F6FBD" />
    </Group>
  );
}

function PainDoc({ width, height, title, preview }: CoverBlockProps) {
  return (
    <Group>
      <TitleBlock width={width} y={70} title={title} color="#102A43" maxLines={2} />
      <Rect x={40} y={height * 0.34} width={width - 80} height={height * 0.42} fill="#FFFFFF" stroke="#D9E2EC" strokeWidth={1.2} cornerRadius={10} shadowColor="#9AA8B7" shadowBlur={12} shadowOpacity={0.25} />
      <Text x={58} y={height * 0.38} text={preview.rows[0][1]} fontSize={13} fill="#98A2B3" width={width - 116} />
      <Line points={[58, height * 0.46, width - 72, height * 0.46]} stroke="#E5EAF0" strokeWidth={2} />
      <Text x={58} y={height * 0.51} text={preview.rows[1][1]} fontSize={14} fontStyle="bold" fill="#101828" width={width - 116} lineHeight={1.25} />
      <Line points={[width - 78, height * 0.50, width - 42, height * 0.45, width - 58, height * 0.57]} stroke="#C3423F" strokeWidth={3} lineCap="round" />
      <Text x={42} y={height * 0.80} text="问题不在背得少，在于不会拆出来用" fontSize={13} fontStyle="bold" fill="#C3423F" width={width - 84} align="center" />
    </Group>
  );
}

function DocStack({ width, height, title, preview }: CoverBlockProps) {
  return (
    <Group>
      <TitleBlock width={width} y={62} title={title} color="#202A36" maxLines={2} />
      {[0, 1, 2].map(i => (
        <Rect key={i} x={48 - i * 8} y={height * 0.30 + i * 18} width={width - 86} height={height * 0.42} fill={i === 2 ? '#FFFFFF' : '#EEF3F8'} stroke="#D9E2EC" strokeWidth={1} cornerRadius={10} shadowColor="#B6C2D0" shadowBlur={8} shadowOpacity={0.18} />
      ))}
      <Text x={58} y={height * 0.36} text="知识库样张 / 目录结构" fontSize={12} fontStyle="bold" fill="#1F6FBD" />
      {preview.modules.map((item, i) => (
        <Text key={item} x={60} y={height * (0.43 + i * 0.065)} text={`▸ ${item}`} fontSize={12} fill="#263544" />
      ))}
      <Text x={54} y={height * 0.79} text="露出结构，不露完整付费内容" fontSize={12} fill="#C3423F" width={width - 108} align="center" />
    </Group>
  );
}

function DocWindow(props: CoverBlockProps) {
  return (
    <Group>
      <TitleBlock width={props.width} y={58} title={props.title} color="#202A36" maxLines={2} />
      <KnowledgePack width={props.width} height={props.height} y={props.height * 0.32} preview={props.preview} />
    </Group>
  );
}

function PracticeSheet({ width, height, title, preview }: CoverBlockProps) {
  return (
    <Group>
      <TitleBlock width={width} y={60} title={title} color="#101828" maxLines={2} />
      <Rect x={34} y={height * 0.30} width={width - 68} height={height * 0.50} fill="#FFFFFF" stroke="#D7DEE8" strokeWidth={1.2} cornerRadius={12} />
      <Text x={54} y={height * 0.35} text="EXERCICE 01" fontSize={13} fontStyle="bold" fill="#1F6FBD" />
      {preview.checklist.slice(0, 4).map((item, i) => (
        <Group key={item}>
          <Circle x={58} y={height * (0.43 + i * 0.075)} radius={9} stroke="#98A2B3" strokeWidth={1.2} />
          <Text x={78} y={height * (0.414 + i * 0.075)} text={item} fontSize={12} fill="#263544" width={width - 120} />
        </Group>
      ))}
    </Group>
  );
}

function PracticeMarked({ width, height, title, preview }: CoverBlockProps) {
  return (
    <Group>
      <PracticeSheet width={width} height={height} title={title} preview={preview} />
      <Line points={[width - 90, height * 0.38, width - 48, height * 0.33, width - 68, height * 0.48]} stroke="#C3423F" strokeWidth={3} lineCap="round" />
      <Text x={width - 136} y={height * 0.52} text="这里最容易丢分" fontSize={12} fontStyle="bold" fill="#C3423F" width={100} align="center" />
    </Group>
  );
}

function RescueCountdown({ width, height, title, preview }: CoverBlockProps) {
  return (
    <Group>
      <Text x={28} y={48} text="考前急救" fontSize={16} fontStyle="bold" fill="#C3423F" />
      <TitleBlock width={width} y={92} title={title} color="#101828" maxLines={2} />
      <Text x={34} y={height * 0.34} text="10" fontSize={86} fontStyle="bold" fill="#C3423F" />
      <Text x={132} y={height * 0.405} text="天\n倒计时" fontSize={22} fontStyle="bold" fill="#101828" lineHeight={1.15} />
      <Rect x={28} y={height * 0.60} width={width - 56} height={height * 0.22} fill="#FFFFFF" stroke="#F0B1AC" strokeWidth={1.2} cornerRadius={14} />
      {preview.checklist.slice(0, 3).map((item, i) => (
        <Text key={item} x={48} y={height * 0.635 + i * 25} text={`优先 ${i + 1}: ${item}`} fontSize={12} fontStyle="bold" fill="#1D2939" />
      ))}
    </Group>
  );
}

function RescueTimeline({ width, height, title, preview }: CoverBlockProps) {
  return (
    <Group>
      <TitleBlock width={width} y={66} title={title} color="#101828" maxLines={2} />
      <Line points={[62, height * 0.34, 62, height * 0.79]} stroke="#1F6FBD" strokeWidth={3} />
      {['摸底', '专项', '模考'].map((phase, i) => (
        <Group key={phase}>
          <Circle x={62} y={height * (0.38 + i * 0.16)} radius={16} fill={i === 0 ? '#1F6FBD' : '#EAF3FF'} />
          <Text x={52} y={height * (0.38 + i * 0.16) - 7} text={String(i + 1)} fontSize={14} fontStyle="bold" fill={i === 0 ? '#FFFFFF' : '#1F6FBD'} width={20} align="center" />
          <Text x={94} y={height * (0.38 + i * 0.16) - 14} text={`${phase}：${preview.checklist[i] || '按模块推进'}`} fontSize={13} fill="#1D2939" width={width - 126} lineHeight={1.2} />
        </Group>
      ))}
      <BottomBar width={width} y={height * 0.85} text="先排顺序，再谈效率" />
    </Group>
  );
}

function Header({ width, preview }: { width: number; preview: PreviewSet }) {
  return (
    <Group>
      <Rect x={18} y={18} width={width - 36} height={28} fill="#FFFFFF" cornerRadius={14} />
      <Text x={30} y={25} text={preview.product} fontSize={11} fontStyle="bold" fill="#1E2E3E" />
      <Text x={width - 92} y={25} text="资料预览" fontSize={11} fill="#6B7A8A" align="right" width={62} />
    </Group>
  );
}

function KnowledgePack({ width, height, y, preview }: { width: number; height: number; y: number; preview: PreviewSet }) {
  const panelX = 28;
  const panelW = width - 56;
  const panelH = height * 0.42;
  return (
    <Group>
      <Rect x={panelX + 12} y={y + 16} width={panelW - 24} height={panelH} fill="#DCE7F4" cornerRadius={16} opacity={0.9} />
      <Rect x={panelX + 6} y={y + 8} width={panelW - 12} height={panelH} fill="#E9F0F8" cornerRadius={16} />
      <Rect x={panelX} y={y} width={panelW} height={panelH} fill="#FFFFFF" stroke="#B9C8D9" strokeWidth={1.4} cornerRadius={16} shadowColor="#8FA1B6" shadowBlur={16} shadowOpacity={0.22} />
      <Rect x={panelX} y={y} width={panelW} height={34} fill="#152238" cornerRadius={[16, 16, 0, 0]} />
      <Circle x={panelX + 20} y={y + 17} radius={4} fill="#EF6B61" />
      <Circle x={panelX + 34} y={y + 17} radius={4} fill="#F3BF4C" />
      <Circle x={panelX + 48} y={y + 17} radius={4} fill="#5DBD73" />
      <Text x={panelX + 66} y={y + 10} text="Knowledge Base / 资料库" fontSize={10} fill="#D9E5F2" />
      <Rect x={panelX + 14} y={y + 48} width={88} height={panelH - 64} fill="#F4F7FB" stroke="#E1E8F1" strokeWidth={1} cornerRadius={10} />
      <Text x={panelX + 26} y={y + 62} text="目录" fontSize={12} fontStyle="bold" fill="#1F6FBD" />
      {preview.modules.slice(0, 4).map((item, i) => (
        <Group key={item}>
          <Rect x={panelX + 24} y={y + 88 + i * 31} width={58} height={18} fill={i === 0 ? '#DCEBFF' : '#FFFFFF'} cornerRadius={5} />
          <Text x={panelX + 31} y={y + 93 + i * 31} text={item.replace(/\d+/g, '')} fontSize={8.5} fill={i === 0 ? '#1F6FBD' : '#58687A'} width={47} />
        </Group>
      ))}
      <Group x={panelX + 116} y={y + 50}>
        {preview.modules.slice(0, 4).map((item, i) => {
          const x = (i % 2) * 80;
          const yy = Math.floor(i / 2) * 72;
          return (
            <Group key={item}>
              <Rect x={x} y={yy} width={70} height={60} fill={i === 0 ? '#EEF6FF' : '#FBFCFE'} stroke="#DCE5EF" strokeWidth={1} cornerRadius={9} />
              <Text x={x + 8} y={yy + 9} text={item.match(/\d+/)?.[0] || '✓'} fontSize={20} fontStyle="bold" fill={i === 0 ? '#1F6FBD' : '#263544'} />
              <Text x={x + 8} y={yy + 36} text={item.replace(/\d+/g, '')} fontSize={10} fill="#4C5D70" width={54} />
            </Group>
          );
        })}
      </Group>
      <Rect x={panelX + 116} y={y + panelH - 50} width={panelW - 134} height={30} fill="#FFF2F0" stroke="#F0B1AC" strokeWidth={1} cornerRadius={8} />
      <Text x={panelX + 130} y={y + panelH - 40} text="不是零散文件，是成套资料包" fontSize={11} fontStyle="bold" fill="#C3423F" width={panelW - 162} />
      <Line points={[width - 64, y + 62, width - 38, y + 38, width - 48, y + 86]} stroke="#C3423F" strokeWidth={3} lineCap="round" lineJoin="round" />
    </Group>
  );
}

function DecisionCard({ x, y, w, h, title, body, color }: { x: number; y: number; w: number; h: number; title: string; body: string; color: string }) {
  return (
    <Group x={x} y={y}>
      <Rect width={w} height={h} fill="#FFFFFF" stroke={color} strokeWidth={1.4} cornerRadius={14} />
      <Text x={14} y={18} text={title} fontSize={18} fontStyle="bold" fill={color} width={w - 28} align="center" />
      <Text x={14} y={62} text={body} fontSize={12} fill="#1D2939" width={w - 28} align="center" lineHeight={1.25} />
    </Group>
  );
}

function Badge({ x, y, text, fill, textColor = '#FFFFFF', stroke }: { x: number; y: number; text: string; fill: string; textColor?: string; stroke?: string }) {
  return (
    <Group>
      <Rect x={x} y={y} width={82} height={30} fill={fill} stroke={stroke} strokeWidth={stroke ? 1 : 0} cornerRadius={15} />
      <Text x={x + 12} y={y + 9} text={text} fontSize={11} fontStyle="bold" fill={textColor} />
    </Group>
  );
}

function BottomBar({ width, y, text }: { width: number; y: number; text: string }) {
  return (
    <Group>
      <Rect x={28} y={y} width={width - 56} height={38} fill="#142033" cornerRadius={11} />
      <Text x={42} y={y + 14} text={text} fontSize={12} fontStyle="bold" fill="#FFFFFF" width={width - 84} align="center" />
    </Group>
  );
}

function TitleBlock({ width, y, title, color, maxLines }: { width: number; y: number; title: string[]; color: string; maxLines: number }) {
  const lines = title.slice(0, maxLines);
  const longest = Math.max(...lines.map(line => line.length), 0);
  const fontSize = longest > 9 ? 26 : lines.length > 2 ? 25 : 30;
  return (
    <Group>
      {lines.map((line, i) => (
        <Text
          key={`${line}-${i}`}
          x={28}
          y={y + i * (fontSize + 6)}
          text={line}
          fontSize={fontSize}
          fontStyle="bold"
          fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif"
          fill={color}
          width={width - 56}
          align="center"
          lineHeight={1.08}
        />
      ))}
    </Group>
  );
}

function ModuleStrip({ width, y, items, color }: { width: number; y: number; items: string[]; color: string }) {
  return (
    <Group>
      {items.slice(0, 3).map((item, i) => (
        <Group key={item}>
          <Rect x={28 + i * ((width - 56) / 3)} y={y} width={(width - 72) / 3} height={28} fill="#FFFFFF" stroke={color} strokeWidth={1} cornerRadius={14} />
          <Text x={34 + i * ((width - 56) / 3)} y={y + 8} text={item} fontSize={10} fill={color} width={(width - 84) / 3} align="center" fontStyle="bold" />
        </Group>
      ))}
    </Group>
  );
}

function normalizeTitle(lines: string[], fallback: string) {
  const clean = lines.filter(Boolean).map(line => line.replace(/\\n/g, ' ').trim()).filter(Boolean);
  if (clean.length) return clean;
  return fallback.split(/\n|，|,| /).filter(Boolean).slice(0, 3);
}

function getPreviewSet(variant: CoverVariant): PreviewSet {
  const text = `${variant.cover_title} ${variant.xhs_title} ${variant.migration_logic} ${variant.seo_keywords.join(' ')}`;
  return /TEF|TCF|CLB7|Canada/i.test(text) ? tefPreview : delfPreview;
}

function inferStyleId(layoutNotes: string, templateId: string) {
  const match = layoutNotes.match(/style_id=([a-z_]+)/);
  if (match) return match[1];
  if (templateId === 'table_compare' || templateId === 'mistake_compare') return 'table_big_grid';
  if (templateId === 'white_blue_pain') return 'pain_big_words';
  if (templateId === 'document_sample') return 'doc_stack_sample';
  if (templateId === 'plan_table') return 'rescue_countdown';
  if (templateId === 'case_review') return 'practice_question_sheet';
  return 'list_dense_pack';
}

function backgroundFor(styleId?: string) {
  if (styleId?.startsWith('pain')) return '#FFFFFF';
  if (styleId?.startsWith('rescue')) return '#FFF8F6';
  if (styleId?.startsWith('practice')) return '#F7F8F6';
  if (styleId?.startsWith('doc')) return '#F6F8FB';
  return '#F3F7FC';
}
