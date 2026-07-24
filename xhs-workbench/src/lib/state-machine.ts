import {
  WorkflowState,
  WorkflowAction,
  WorkflowStep,
  INITIAL_STATE,
  CoverVariant,
  PageScript,
} from '@/types/workflow';
import { ChainId, SkillData, CoverTemplateId, TitleTemplateId, PageTemplateId } from '@/types/data';
import {
  validateCoverTemplate,
  validateTitleTemplate,
  validatePageTemplate,
  validateCoverTitleTemplatePair,
} from './compatibility';
import { isCoverTitleCompatible } from './cover-title-compatibility';

// ---- 状态派生：从 WorkflowState 推导当前步骤 ----
export function deriveStep(state: WorkflowState): WorkflowStep {
  if (!state.chain_id) return 'select_chain';
  if (!state.content_source_type) return 'select_content_source';
  if (!state.content_core) return 'fill_content';
  if (!state.cover_template_id) return 'select_cover_template';
  if (!state.title_template_id) return 'select_title_template';
  if (state.variants.length === 0) return 'generate_covers';
  if (!state.selected_variant_id) return 'select_variant';
  if (!state.page_scripts) return 'generate_pages';
  if (!state.caption) return 'generate_caption';
  return 'export';
}

// ---- 步骤是否可以执行（前置条件检查）----
export function canExecuteStep(step: WorkflowStep, state: WorkflowState): boolean {
  switch (step) {
    case 'select_chain':
      return true;
    case 'select_content_source':
      return !!state.chain_id;
    case 'fill_content':
      return !!state.chain_id && !!state.content_source_type;
    case 'select_cover_template':
      return !!state.chain_id && !!state.content_source_type && !!state.content_core;
    case 'select_title_template':
      return !!state.chain_id && !!state.content_source_type && !!state.content_core && !!state.cover_template_id;
    case 'generate_covers':
      return !!state.chain_id && !!state.content_core && !!state.cover_template_id && !!state.title_template_id;
    case 'select_variant':
      return state.variants.length > 0;
    case 'generate_pages':
      return !!state.selected_variant_id;
    case 'generate_caption':
      return !!state.page_scripts && state.page_scripts.length > 0;
    case 'export':
      return !!state.caption && state.tags.length > 0;
    default:
      return false;
  }
}

// ---- 获取当前步骤的描述 ----
export function getStepDescription(step: WorkflowStep): string {
  const descriptions: Record<WorkflowStep, string> = {
    select_chain: '选择主链路',
    select_content_source: '选择内容来源',
    fill_content: '填写具体内容',
    select_cover_template: '选择封面母版',
    select_title_template: '选择标题母版',
    generate_covers: '生成封面候选',
    select_variant: '选择一个封面',
    generate_pages: '生成内页脚本',
    generate_caption: '生成正文和标签',
    export: '导出',
  };
  return descriptions[step];
}

// ---- Workflow Reducer ----
export function workflowReducer(
  state: WorkflowState,
  action: WorkflowAction,
  data?: SkillData,
): WorkflowState {
  switch (action.type) {
    case 'SET_CHAIN': {
      const chain = data?.chains[action.chain_id];
      if (!chain) return state;
      return {
        ...INITIAL_STATE,
        chain_id: action.chain_id,
      };
    }

    case 'SET_CONTENT_SOURCE': {
      if (!state.chain_id) return state;
      return {
        ...state,
        content_source_type: action.content_source_type,
        content_core: null,
        selected_product_point_id: null,
      };
    }

    case 'SET_CONTENT_CORE': {
      if (!state.chain_id || !state.content_source_type) return state;
      return {
        ...state,
        content_core: action.content_core,
        selected_product_point_id: action.product_point_id ?? state.selected_product_point_id,
      };
    }

    case 'SET_COVER_TEMPLATE': {
      if (!state.chain_id || !data) return state;
      const validation = validateCoverTemplate(action.cover_template_id, state.chain_id, data);
      if (!validation.valid) return state;
      return {
        ...state,
        cover_template_id: action.cover_template_id,
        title_template_id: state.title_template_id && isCoverTitleCompatible(action.cover_template_id, state.title_template_id)
          ? state.title_template_id
          : null,
        hot_title_id: state.title_template_id && isCoverTitleCompatible(action.cover_template_id, state.title_template_id)
          ? state.hot_title_id
          : null,
        variants: [],
        selected_variant_id: null,
        page_scripts: null,
        caption: null,
        tags: [],
      };
    }

    case 'SET_TITLE_TEMPLATE': {
      if (!state.chain_id || !data) return state;
      const validation = validateTitleTemplate(action.title_template_id, state.chain_id, data);
      if (!validation.valid) return state;
      if (!state.cover_template_id) return state;
      const pairValidation = validateCoverTitleTemplatePair(state.cover_template_id, action.title_template_id, data);
      if (!pairValidation.valid) return state;
      return {
        ...state,
        title_template_id: action.title_template_id,
        hot_title_id: action.hot_title_id ?? null,
        variants: [],
        selected_variant_id: null,
        page_scripts: null,
        caption: null,
        tags: [],
      };
    }

    case 'SET_VARIANTS': {
      if (!state.cover_template_id || !state.title_template_id) return state;
      const pairValidation = validateCoverTitleTemplatePair(state.cover_template_id, state.title_template_id, data!);
      if (!pairValidation.valid) return state;
      // 校验所有 variant 同母版同骨架
      const allSameCover = action.variants.every(
        v => v.cover_template_id === state.cover_template_id,
      );
      const allSameTitle = action.variants.every(
        v => v.title_template_id === state.title_template_id,
      );
      if (!allSameCover || !allSameTitle) return state;
      if (action.variants.length < 1 || action.variants.length > 12) return state;
      return {
        ...state,
        variants: action.variants,
        selected_variant_id: null,
      };
    }

    case 'SELECT_VARIANT': {
      if (state.variants.length === 0) return state;
      const variant = state.variants.find(v => v.id === action.variant_id);
      if (!variant) return state;
      return {
        ...state,
        selected_variant_id: action.variant_id,
        page_scripts: null,
        caption: null,
        tags: [],
      };
    }

    case 'SET_PAGE_TEMPLATE': {
      if (!state.chain_id || !data) return state;
      const validation = validatePageTemplate(action.page_template_id, state.chain_id, data);
      if (!validation.valid) return state;
      return {
        ...state,
        page_template_id: action.page_template_id,
      };
    }

    case 'SET_PAGE_SCRIPTS': {
      if (!state.selected_variant_id) return state;
      if (action.page_scripts.length === 0) return state;
      return {
        ...state,
        page_scripts: action.page_scripts,
        caption: null,
        tags: [],
      };
    }

    case 'SET_CAPTION_AND_TAGS': {
      if (!state.page_scripts) return state;
      return {
        ...state,
        caption: action.caption,
        tags: action.tags,
      };
    }

    case 'RESET': {
      return { ...INITIAL_STATE };
    }

    default:
      return state;
  }
}

// ---- 从 ChainId 获取 ProductId ----
export function getProductIdFromChain(chainId: ChainId, data: SkillData): string {
  return data.chains[chainId]?.product_id || '';
}

// ---- 获取某个步骤的可用选项 ----
export function getAvailableCoverTemplates(
  chainId: ChainId,
  data: SkillData,
): { id: CoverTemplateId; name: string }[] {
  const chain = data.chains[chainId];
  if (!chain) return [];
  return chain.allowed_cover_templates.map(id => ({
    id,
    name: data.cover_templates[id]?.name || id,
  }));
}

export function getAvailableTitleTemplates(
  chainId: ChainId,
  data: SkillData,
): { id: TitleTemplateId; name: string }[] {
  const chain = data.chains[chainId];
  if (!chain) return [];
  return chain.allowed_title_templates.map(id => ({
    id,
    name: data.title_templates[id]?.name || id,
  }));
}

export function getAvailablePageTemplates(
  chainId: ChainId,
  data: SkillData,
): { id: PageTemplateId; name: string }[] {
  const chain = data.chains[chainId];
  if (!chain) return [];
  return chain.allowed_page_templates.map(id => ({
    id,
    name: data.page_templates[id]?.name || id,
  }));
}
