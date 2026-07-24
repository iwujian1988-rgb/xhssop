'use client';

import React from 'react';
import { Stage, Layer, Rect, Text, Line, Group, Circle } from 'react-konva';
import { PageScript } from '@/types/workflow';

interface PageCanvasProps {
  page: PageScript;
  width: number;
  height: number;
  pageNo: number;
}

const colors = {
  bg: '#FFFFFF',
  ink: '#1F2B37',
  muted: '#667788',
  blue: '#1F6FBD',
  blueSoft: '#EEF6FF',
  red: '#C3423F',
  redSoft: '#FFF2F0',
  line: '#D9E2EC',
  panel: '#F7FAFD',
};

export default function PageCanvas({ page, width, pageNo }: PageCanvasProps) {
  const displayWidth = Math.min(width, 340);
  const displayHeight = (displayWidth / 3) * 4;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200" style={{ width: displayWidth }}>
      <Stage width={displayWidth} height={displayHeight}>
        <Layer>
          <Rect x={0} y={0} width={displayWidth} height={displayHeight} fill={colors.bg} />
          <PageChrome width={displayWidth} pageNo={pageNo} role={page.role} />
          <Title width={displayWidth} title={page.page_title} />

          {renderBody(page, displayWidth, displayHeight)}

          <Text
            x={26}
            y={displayHeight - 34}
            text={formatName(page.copy_format_id)}
            fontSize={10}
            fill={colors.muted}
            width={displayWidth - 52}
            align="center"
          />
        </Layer>
      </Stage>
    </div>
  );
}

function PageChrome({ width, pageNo, role }: { width: number; pageNo: number; role: string }) {
  return (
    <Group>
      <Text x={24} y={22} text={String(pageNo).padStart(2, '0')} fontSize={28} fontStyle="bold" fill={colors.blue} opacity={0.24} />
      <Rect x={width - 92} y={24} width={68} height={24} fill={colors.blueSoft} cornerRadius={12} />
      <Text x={width - 82} y={31} text={roleLabel(role)} fontSize={10} fill={colors.blue} fontStyle="bold" width={48} align="center" />
    </Group>
  );
}

function Title({ width, title }: { width: number; title: string }) {
  return (
    <Group>
      <Text
        x={26}
        y={70}
        text={title}
        fontSize={23}
        fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif"
        fontStyle="bold"
        fill={colors.ink}
        width={width - 52}
        lineHeight={1.18}
      />
      <Line points={[26, 132, width - 26, 132]} stroke={colors.line} strokeWidth={1} />
    </Group>
  );
}

function renderBody(page: PageScript, width: number, height: number) {
  if (page.copy_format_id === 'wrong_right') return <WrongRight page={page} width={width} height={height} />;
  if (page.copy_format_id === 'table') return <TablePage page={page} width={width} height={height} />;
  if (page.copy_format_id === 'sample_annotation') return <SamplePage page={page} width={width} height={height} />;
  if (page.copy_format_id === 'steps') return <StepsPage page={page} width={width} height={height} />;
  if (page.role === 'soft_sell') return <DirectoryPage page={page} width={width} height={height} />;
  return <BulletPage page={page} width={width} height={height} />;
}

function BulletPage({ page, width, height }: BodyProps) {
  return (
    <Group>
      <ConclusionBox width={width} y={154} text={page.core_conclusion} tone={page.role === 'bridge' ? 'red' : 'blue'} />
      {page.support_content.slice(0, 4).map((point, i) => (
        <Group key={`${point}-${i}`}>
          <Rect x={28} y={height * (0.44 + i * 0.095)} width={width - 56} height={42} fill={i % 2 ? '#FFFFFF' : colors.panel} stroke={colors.line} strokeWidth={0.8} cornerRadius={10} />
          <Circle x={47} y={height * (0.44 + i * 0.095) + 21} radius={5} fill={colors.blue} opacity={0.85} />
          <Text x={62} y={height * (0.44 + i * 0.095) + 11} text={point} fontSize={12.5} fill={colors.ink} width={width - 96} lineHeight={1.2} />
        </Group>
      ))}
    </Group>
  );
}

function WrongRight({ page, width, height }: BodyProps) {
  const points = page.support_content;
  return (
    <Group>
      <ConclusionBox width={width} y={150} text={page.core_conclusion} tone="red" />
      <CompareBlock width={width} y={height * 0.41} label="容易写成" text={points[0] || '表达没错，但很普通'} tone="bad" />
      <Text x={width / 2 - 24} y={height * 0.565} text="换成" fontSize={13} fontStyle="bold" fill={colors.muted} width={48} align="center" />
      <CompareBlock width={width} y={height * 0.63} label="更建议" text={points[1] || points[0] || '更具体、更有层次'} tone="good" />
      <Text x={34} y={height * 0.82} text={points[2] || '判断标准：能不能看出观点、连接和例子'} fontSize={12} fill={colors.muted} width={width - 68} align="center" lineHeight={1.25} />
    </Group>
  );
}

function TablePage({ page, width, height }: BodyProps) {
  const rows = normalizeRows(page.support_content);
  return (
    <Group>
      <Text x={30} y={152} text={page.core_conclusion} fontSize={13} fill={colors.ink} width={width - 60} lineHeight={1.35} />
      <Rect x={24} y={height * 0.34} width={width - 48} height={height * 0.46} fill="#FFFFFF" stroke="#C9D8E8" strokeWidth={1.2} cornerRadius={12} />
      <Rect x={24} y={height * 0.34} width={width - 48} height={32} fill={colors.blueSoft} cornerRadius={[12, 12, 0, 0]} />
      <Text x={38} y={height * 0.358} text="问题" fontSize={11} fill={colors.red} fontStyle="bold" width={(width - 76) / 2} />
      <Text x={width / 2 + 8} y={height * 0.358} text="处理方式" fontSize={11} fill={colors.blue} fontStyle="bold" width={(width - 76) / 2} />
      <Line points={[width / 2, height * 0.34, width / 2, height * 0.80]} stroke="#D5E1EE" strokeWidth={1} />
      {rows.slice(0, 4).map((row, i) => (
        <Group key={`${row[0]}-${i}`}>
          <Line points={[24, height * (0.42 + i * 0.088), width - 24, height * (0.42 + i * 0.088)]} stroke="#E6EDF5" strokeWidth={1} />
          <Text x={38} y={height * (0.435 + i * 0.088)} text={row[0]} fontSize={11.5} fill={colors.ink} width={(width - 88) / 2} lineHeight={1.2} />
          <Text x={width / 2 + 10} y={height * (0.435 + i * 0.088)} text={row[1]} fontSize={11.5} fill={colors.ink} width={(width - 88) / 2} lineHeight={1.2} />
        </Group>
      ))}
    </Group>
  );
}

function SamplePage({ page, width, height }: BodyProps) {
  return (
    <Group>
      <Rect x={28} y={150} width={width - 56} height={height * 0.38} fill="#FFFFFF" stroke="#D8E0EA" strokeWidth={1.2} cornerRadius={12} shadowColor="#B6C2D0" shadowBlur={10} shadowOpacity={0.16} />
      <Text x={44} y={170} text="样张片段" fontSize={12} fill={colors.blue} fontStyle="bold" />
      <Text x={44} y={200} text={page.core_conclusion} fontSize={13} fill={colors.ink} width={width - 88} lineHeight={1.38} />
      {page.support_content.slice(0, 3).map((point, i) => (
        <Group key={`${point}-${i}`}>
          <Rect x={34} y={height * (0.62 + i * 0.075)} width={width - 68} height={28} fill={i === 0 ? colors.blueSoft : colors.panel} cornerRadius={7} />
          <Text x={47} y={height * (0.637 + i * 0.075)} text={point} fontSize={11.5} fill={colors.ink} width={width - 94} />
        </Group>
      ))}
    </Group>
  );
}

function StepsPage({ page, width, height }: BodyProps) {
  const steps = page.support_content.slice(0, 4);
  return (
    <Group>
      <ConclusionBox width={width} y={150} text={page.core_conclusion} tone="blue" />
      {steps.map((step, i) => (
        <Group key={`${step}-${i}`}>
          <Circle x={46} y={height * (0.43 + i * 0.095) + 16} radius={15} fill={i === 0 ? colors.blue : colors.blueSoft} />
          <Text x={38} y={height * (0.43 + i * 0.095) + 8} text={String(i + 1)} fontSize={13} fontStyle="bold" fill={i === 0 ? '#FFFFFF' : colors.blue} width={16} align="center" />
          {i < steps.length - 1 && <Line points={[46, height * (0.43 + i * 0.095) + 34, 46, height * (0.43 + (i + 1) * 0.095)]} stroke={colors.line} strokeWidth={1} />}
          <Text x={74} y={height * (0.43 + i * 0.095) + 7} text={step} fontSize={13} fill={colors.ink} width={width - 106} lineHeight={1.25} />
        </Group>
      ))}
    </Group>
  );
}

function DirectoryPage({ page, width, height }: BodyProps) {
  const items = page.support_content.slice(0, 5);
  return (
    <Group>
      <Text x={28} y={152} text={page.core_conclusion} fontSize={13} fill={colors.ink} width={width - 56} lineHeight={1.34} />
      <Rect x={26} y={height * 0.33} width={width - 52} height={height * 0.48} fill="#FFFFFF" stroke={colors.line} strokeWidth={1.2} cornerRadius={12} />
      <Rect x={40} y={height * 0.37} width={78} height={height * 0.38} fill={colors.panel} cornerRadius={8} />
      {['目录', '模块', '样张', '检查'].map((nav, i) => (
        <Text key={nav} x={52} y={height * (0.40 + i * 0.07)} text={nav} fontSize={10.5} fill={i === 0 ? colors.blue : colors.muted} fontStyle={i === 0 ? 'bold' : 'normal'} />
      ))}
      {items.map((item, i) => (
        <Group key={`${item}-${i}`}>
          <Rect x={132} y={height * (0.37 + i * 0.07)} width={width - 172} height={24} fill={i % 2 ? '#FFFFFF' : colors.panel} cornerRadius={6} />
          <Text x={142} y={height * (0.384 + i * 0.07)} text={item} fontSize={10.5} fill={colors.ink} width={width - 192} />
        </Group>
      ))}
    </Group>
  );
}

type BodyProps = {
  page: PageScript;
  width: number;
  height: number;
};

function ConclusionBox({ width, y, text, tone }: { width: number; y: number; text: string; tone: 'blue' | 'red' }) {
  const accent = tone === 'red' ? colors.red : colors.blue;
  const fill = tone === 'red' ? colors.redSoft : colors.blueSoft;
  return (
    <Group>
      <Rect x={26} y={y} width={width - 52} height={76} fill={fill} stroke={accent} strokeWidth={1.1} cornerRadius={12} />
      <Rect x={26} y={y} width={5} height={76} fill={accent} cornerRadius={[12, 0, 0, 12]} />
      <Text x={44} y={y + 17} text={text} fontSize={14} fill={colors.ink} width={width - 88} lineHeight={1.32} fontStyle="bold" />
    </Group>
  );
}

function CompareBlock({ width, y, label, text, tone }: { width: number; y: number; label: string; text: string; tone: 'bad' | 'good' }) {
  const bad = tone === 'bad';
  return (
    <Group>
      <Rect x={30} y={y} width={width - 60} height={62} fill={bad ? colors.redSoft : colors.blueSoft} stroke={bad ? '#F0B1AC' : '#BBD8F4'} strokeWidth={1.1} cornerRadius={12} />
      <Text x={46} y={y + 12} text={label} fontSize={11} fontStyle="bold" fill={bad ? colors.red : colors.blue} />
      <Text x={46} y={y + 34} text={text} fontSize={12.5} fill={colors.ink} width={width - 92} lineHeight={1.18} />
    </Group>
  );
}

function normalizeRows(items: string[]): Array<[string, string]> {
  if (!items.length) return [['资料很多', '先按目标筛'], ['只背范文', '拆句型迁移'], ['考前焦虑', '用清单收口']];
  return items.map(item => {
    const parts = item.split(/vs|VS|：|:|->|→/).map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts.slice(1).join(' ')] as [string, string];
    return [item.slice(0, 12), item.slice(12) || '看具体例子判断'] as [string, string];
  });
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    bridge: '痛点',
    value: '干货',
    proof: '样张',
    soft_sell: '资料',
    fit: '适合谁',
  };
  return labels[role] || '内页';
}

function formatName(id: string): string {
  const names: Record<string, string> = {
    conclusion_bullets: '结论清单',
    wrong_right: '错对对照',
    table: '表格对照',
    sample_annotation: '样张标注',
    steps: '步骤路径',
  };
  return names[id] || id;
}
