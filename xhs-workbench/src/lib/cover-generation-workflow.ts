import type { SampleNote } from './sample-note-generator';
import { resourceCoverRefs, type ResourceCoverRef } from './resource-cover-library';

export type CoverGenerationMode =
  | 'resource_full_text'
  | 'experience_photo_big_title'
  | 'annotation_bg_big_title';

export interface WorkflowCoverRef {
  id: string;
  name: string;
  image: string;
  category: CoverGenerationMode;
  fit: string[];
  risk: string;
  promptRecipe: string;
  density?: ResourceCoverRef['density'];
  layout?: string;
}

export interface CoverGenerationPlan {
  sample_id: string;
  note_title: string;
  cover_title: string;
  cover_subtitle: string;
  pages: SampleNote['pages'];
  mode: CoverGenerationMode;
  mode_name: string;
  reason: string;
  references: WorkflowCoverRef[];
  image_prompt: string;
  negative_prompt: string;
  postcheck: string[];
  api_needed: boolean;
}

const experienceRefs: WorkflowCoverRef[] = [
  {
    id: 'experience_01_desk_book_tablet',
    name: '桌面书本平板经验感',
    image: '/reference-covers/experience/experience_01_desk_book_tablet.png',
    category: 'experience_photo_big_title',
    fit: ['备考经验', '过级复盘', '学习氛围', '低广告感'],
    risk: '容易太精致像库存图，必须保留真实桌面杂物和轻微虚化。',
    promptRecipe: '参考桌面、打开的法语书、平板资料、自然窗光，生成真实学习桌面照片感。',
  },
  {
    id: 'experience_02_text_story',
    name: '白底长文经验页',
    image: '/reference-covers/experience/experience_02_text_story.png',
    category: 'experience_photo_big_title',
    fit: ['真人复盘', '自学路径', '长文观点'],
    risk: '太依赖文案，AI味文案会直接露馅。',
    promptRecipe: '参考白底大字长文笔记，标题强，正文只做氛围，不承担关键干货。',
  },
  {
    id: 'experience_03_person_books',
    name: '真人学习+书墙',
    image: '/reference-covers/experience/experience_03_person_books.png',
    category: 'experience_photo_big_title',
    fit: ['学习强度', '资料量', '真实备考'],
    risk: '人物和书本容易太摆拍，避免过度网红感。',
    promptRecipe: '参考真人低头写笔记和一排法语教材，生成真实学习场景照片。',
  },
  {
    id: 'experience_04_library_big_text',
    name: '图书馆资料桌大字',
    image: '/reference-covers/experience/experience_04_library_big_text.png',
    category: 'experience_photo_big_title',
    fit: ['强度科普', 'B2真实难度', '学习状态'],
    risk: '大字标题必须足够猛，否则只是普通图书馆照片。',
    promptRecipe: '参考图书馆桌面、电脑、打印资料、黄色黑边大标题，生成学习实拍封面。',
  },
  {
    id: 'experience_05_library_plan_text',
    name: '图书馆计划痛点大字',
    image: '/reference-covers/experience/experience_05_library_plan_text.png',
    category: 'experience_photo_big_title',
    fit: ['没计划', '努力程度', '备考误区'],
    risk: '适合痛点，不适合展示具体资料清单。',
    promptRecipe: '参考图书馆学习场景和三行大字压屏，标题用黑黄白红描边制造冲突。',
  },
  {
    id: 'experience_06_materials_flatlay',
    name: '资料实拍摊开',
    image: '/reference-covers/experience/experience_06_materials_flatlay.png',
    category: 'experience_photo_big_title',
    fit: ['资料实拍', '学习痕迹', '备考材料'],
    risk: '接近资源展示，但不适合塞完整目录。',
    promptRecipe: '参考多份法语资料、笔记、键盘的实拍平铺，突出资料真实感。',
  },
  {
    id: 'experience_07_window_notebook',
    name: '窗边手写笔记',
    image: '/reference-covers/experience/experience_07_window_notebook.png',
    category: 'experience_photo_big_title',
    fit: ['经验观点', '学习idea', '过来人分享'],
    risk: '标题要短，否则压住画面。',
    promptRecipe: '参考窗边咖啡、教材、手写笔记，生成有生活感的法语学习实拍。',
  },
  {
    id: 'experience_08_study_blogger_flatlay',
    name: '博主学习桌仿拍',
    image: '/reference-covers/experience/experience_08_study_blogger_flatlay.png',
    category: 'experience_photo_big_title',
    fit: ['学习博主感', '方法演示', '资料+手写'],
    risk: '小红书感强，但容易像摆拍，需要控制滤镜。',
    promptRecipe: '参考教材、黄色便签、手写纠错和手部入镜，生成真实学习博主视角。',
  },
];

const annotationRefs: WorkflowCoverRef[] = [
  {
    id: 'annotation_01_full_hand_mark',
    name: '满屏红笔批改感',
    image: '/reference-covers/annotation/annotation_01_full_hand_mark.jpg',
    category: 'annotation_bg_big_title',
    fit: ['作文批改', '低分原因', '范文拆解', '句子不像B2'],
    risk: '不要要求手写内容全部可读，封面只承担批改信任感。',
    promptRecipe: '参考满屏红笔手写批注、英文/法文作文页、箭头、圈画，生成批改感底图。',
  },
  {
    id: 'annotation_02_highlight_margin',
    name: '高亮+边注批改页',
    image: '/reference-covers/annotation/annotation_02_highlight_margin.jpg',
    category: 'annotation_bg_big_title',
    fit: ['句子修改', '段落问题', '结构批注', '精批案例'],
    risk: '蓝色高亮和边注要像真实批改，不要变成整齐PPT。',
    promptRecipe: '参考作文正文蓝色高亮、红蓝手写边注、箭头和底部总结，生成真实精批底图。',
  },
];

export function buildCoverGenerationPlans(samples: SampleNote[]): CoverGenerationPlan[] {
  return samples.map(sample => {
    const mode = chooseMode(sample);
    const references = pickReferences(sample, mode);
    return {
      sample_id: sample.id,
      note_title: sample.title,
      cover_title: sample.cover_title,
      cover_subtitle: sample.cover_subtitle,
      pages: sample.pages,
      mode,
      mode_name: modeName(mode),
      reason: modeReason(sample, mode),
      references,
      image_prompt: buildImagePrompt(sample, mode, references[0]),
      negative_prompt: buildNegativePrompt(mode),
      postcheck: buildPostcheck(mode),
      api_needed: true,
    };
  });
}

function chooseMode(sample: SampleNote): CoverGenerationMode {
  const text = `${sample.title} ${sample.cover_title} ${sample.cover_subtitle} ${sample.evidence}`;
  if (/批改|低分|扣分|不像B2|范文|背了|改后|原句|句子/.test(text)) return 'annotation_bg_big_title';
  if (/经验|强度|努力|计划|没话|过来人|自学|3个月|低精力|焦虑/.test(text)) return 'experience_photo_big_title';
  return 'resource_full_text';
}

function pickReferences(sample: SampleNote, mode: CoverGenerationMode): WorkflowCoverRef[] {
  if (mode === 'annotation_bg_big_title') return annotationRefs;
  if (mode === 'experience_photo_big_title') {
    if (/计划|努力|强度/.test(sample.title)) return [experienceRefs[4], experienceRefs[3], experienceRefs[6], experienceRefs[7]];
    if (/资料|范文|背了/.test(sample.title)) return [experienceRefs[5], experienceRefs[7], experienceRefs[0], experienceRefs[2]];
    return [experienceRefs[0], experienceRefs[6], experienceRefs[7], experienceRefs[3]];
  }
  const mapped: WorkflowCoverRef[] = sample.recommended_resource_covers.map(mapResourceRef);
  return mapped.length > 0 ? mapped : resourceCoverRefs.slice(0, 4).map(mapResourceRef);
}

function mapResourceRef(ref: ResourceCoverRef): WorkflowCoverRef {
  return {
    id: ref.id,
    name: ref.name,
    image: ref.image,
    category: 'resource_full_text',
    fit: [...ref.contentFit.slice(0, 4), ...ref.titleFit.slice(0, 2)],
    risk: ref.qualityRisk,
    promptRecipe: ref.promptRecipe,
    density: ref.density,
    layout: ref.layout,
  };
}

function buildImagePrompt(sample: SampleNote, mode: CoverGenerationMode, ref?: WorkflowCoverRef): string {
  const titleLines = sample.cover_title.split('\n').map(line => line.trim()).filter(Boolean).join(' / ');
  const densityRule = getDensityRule(ref?.density, mode);
  const base = [
    '生成小红书竖版封面，比例 3:4。',
    `参考图风格：${ref?.name || '当前匹配参考图'}。`,
    '把参考图当作编辑目标：保持原图的构图、栏目数量、线条、纸张/黑板/实拍背景、色彩、边距、信息密度和手工感。不要重新设计成另一张图。',
    '必须保留原图的光线和材质关系：纸张高光、阴影、反光、褶皱、拍摄透视、桌面光线或黑板粉尘都不能被磨平、压平或改成平面插画。',
    densityRule,
    '只替换参考图中的全部可读文字：原主标题、章节标题、左侧分类、表格或清单条目、账号、二维码、logo、水印都必须消失。',
    `新的主标题必须清晰可读：${titleLines}。新的副标题：${sample.cover_subtitle}。`,
    `用下列真实内容替换原图文字，并按原图的文字层级和位置排进去：\n${buildReplacementText(sample, mode, ref)}`,
    '必须一眼看出这是法语 / DELF B2 / 写作相关内容。整体仍像真实小红书同行手搓封面，不要像广告海报或PPT模板。',
  ];

  if (mode === 'annotation_bg_big_title') {
    return [
      ...base,
      '批改型要求：保留原图的作文页、红蓝笔批注、荧光笔、箭头和圈画。只把原批改文字替换成与本篇有关的短批注；批注可以略潦草，但主标题和重点批注必须可读。',
      '画面应该让用户第一眼感觉：这篇笔记会讲清楚作文为什么扣分、怎么改得更像B2。',
    ].join('\n');
  }

  if (mode === 'experience_photo_big_title') {
    return [
      ...base,
      '真人经验型要求：保留原图的真实学习实拍、桌面物件、透视和光线。只替换原大字和小字，标题仍然用原图同样的压屏位置和视觉力度。',
      '画面应该让用户第一眼感觉：这是一个真的学法语的人在复盘经验，不是卖资料广告。',
    ].join('\n');
  }

  return [
    ...base,
    '资源型要求：保留原图“内容很多、有人手工整理过”的资料页结构。不要清空或另做底图；原有标题、分组、表格、圆点和条目位置都用本篇的真实 DELF B2 写作内容替换。',
    '资料内容必须围绕 DELF B2 法语写作，不要生成法语字母表、基础人称代词、冠词、疑问词等语法入门内容。',
    '不要只画几条假线；所有可读内容都应该直接出现在成图里，保留原图的高密度、强层级和手工整理感。',
  ].join('\n');
}

function getDensityRule(density: ResourceCoverRef['density'] | undefined, mode: CoverGenerationMode): string {
  if (mode !== 'resource_full_text') {
    return '信息密度规则：保持原图标题和说明文字的数量、大小和占画面比例，不要把原本丰富的文字层简化成只有一句标题。';
  }
  if (density === 'very_high') {
    return '信息密度硬规则：原图属于极高密度资料页。必须保留相近的分组数、列数、行数和小字占比；至少 5 个分组，每组 4-8 条短内容，画面不能出现大块空白。';
  }
  if (density === 'high') {
    return '信息密度硬规则：原图属于高密度资料页。必须保留相近的分组数和条目数量；至少 4 个分组，每组 3-6 条短内容，不能把资料页简化成海报。';
  }
  return '信息密度规则：保留参考图原本的文字量、分组数量和留白比例，不要擅自减少内容。';
}

function buildReplacementText(sample: SampleNote, mode: CoverGenerationMode, ref?: WorkflowCoverRef): string {
  if (mode === 'experience_photo_big_title') {
    return `大字标题：${sample.cover_title.replace(/\n/g, ' / ')}\n小字说明：${sample.cover_subtitle}\n一句真实学习感文案：${sample.pages[0]?.main_text || sample.evidence}`;
  }

  if (mode === 'annotation_bg_big_title') {
    return `大字标题：${sample.cover_title.replace(/\n/g, ' / ')}\n重点批注：${sample.cover_subtitle}\n批改内容围绕：${sample.pages[0]?.main_text || sample.evidence}`;
  }

  const sourceRows = sample.pages.flatMap(page => [page.page_title, page.main_text, ...page.bullets]).filter(Boolean);
  const groupsNeeded = ref?.density === 'very_high' ? 6 : ref?.density === 'high' ? 5 : 4;
  const rowsPerGroup = ref?.density === 'very_high' ? 6 : ref?.density === 'high' ? 5 : 3;
  const groups = Array.from({ length: groupsNeeded }, (_, index) => {
    const page = sample.pages[index % sample.pages.length];
    const rows = Array.from({ length: rowsPerGroup }, (_, rowIndex) => sourceRows[(index * rowsPerGroup + rowIndex) % sourceRows.length]);
    return `第${index + 1}组 ${page?.page_title || '写作检查'}：${rows.join('；')}`;
  });
  return `资料页大标题：${sample.cover_title.replace(/\n/g, ' / ')}\n${groups.join('\n')}`;
}

function buildNegativePrompt(mode: CoverGenerationMode): string {
  const common = '不要保留参考图中的任何原文字、标题、账号、二维码、logo、水印或页码；不要乱码、错别字、过度磨皮、塑料感、PPT感、空白极简模板、无关英语考试名。不要压平原图的纸张高光、自然阴影、反光、纹理或光线方向。除了指定替换内容外，不要自造可读文字。';
  if (mode === 'annotation_bg_big_title') return `${common} 不要要求所有批注都清楚可读，不要生成整齐表格，不要让红笔字盖住主标题。`;
  if (mode === 'experience_photo_big_title') return `${common} 不要库存图感，不要虚假网红摆拍，不要欧美人物正脸大头照。`;
  return `${common} 不要只有装饰没有资料内容，不要纯插画，不要把资料页做成一本正式教材封面，不要出现“法语整个语法体系”。`;
}

function buildPostcheck(mode: CoverGenerationMode): string[] {
  const common = ['原图版式、信息密度和手工感是否保住', '原图的纸张高光、阴影、反光和拍摄光线是否保住', '原竞品文字、账号、二维码是否全部被替换', '新标题是否完整可读且一眼知道是法语/DELF B2/写作', '是否像小红书手搓封面而不是PPT'];
  if (mode === 'annotation_bg_big_title') return [...common, '批改感是否强', '红笔/高亮/箭头是否自然', '底图文字是否没有干扰主标题'];
  if (mode === 'experience_photo_big_title') return [...common, '学习场景是否真实', '是否降低广告感', '桌面元素是否和法语学习相关'];
  return [...common, '资料厚重感是否足', '内容区是否像真实资料', '是否没有错配到真人经验/课程广告'];
}

function modeName(mode: CoverGenerationMode): string {
  if (mode === 'annotation_bg_big_title') return '批改感底图 + 大字压屏';
  if (mode === 'experience_photo_big_title') return '真人学习实拍 + 大字压屏';
  return '资料内容型完整生成';
}

function modeReason(sample: SampleNote, mode: CoverGenerationMode): string {
  if (mode === 'annotation_bg_big_title') return '标题/证据涉及范文、句子、扣分或改写，需要用批改感建立信任，再用大字拉点击。';
  if (mode === 'experience_photo_big_title') return '内容更像经验、强度、计划或学习状态，照片负责真实感，大字负责点击。';
  return '内容核心是清单、词汇、资料或自测，封面必须展示资料本体，证明商品里真有东西。';
}
