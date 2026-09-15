import { stableHash } from './contracts';

export const TOPIC_DOMAINS = [
  'task_decoding', 'idea_generation', 'argument_development', 'evidence_examples',
  'structure_cohesion', 'register_genre', 'grammar_accuracy', 'lexical_precision',
  'revision_feedback', 'exam_execution', 'study_strategy', 'material_transfer',
  'confidence_rebuild',
] as const;

export const TOPIC_PROBLEMS = [
  'misread_instruction', 'no_usable_ideas', 'thin_argument', 'abstract_examples',
  'logic_jump', 'wrong_register', 'grammar_retrieval_failure', 'imprecise_word_choice',
  'cannot_self_diagnose', 'time_control_failure', 'inefficient_practice',
  'cannot_transfer_models', 'unstable_exam_confidence',
] as const;

export const TOPIC_OBJECTS = [
  'prompt', 'outline', 'argument', 'example', 'paragraph', 'connector', 'formal_letter',
  'forum_post', 'article_report', 'opening_closing', 'verb_mood', 'sentence_pattern',
  'vocabulary_collocation', 'full_draft', 'model_essay', 'checklist', 'revision_log',
  'study_material', 'mock_exam', 'theme_idea_bank',
] as const;

export const TOPIC_MECHANISMS = [
  'instruction_matrix', 'perspective_lens', 'argument_chain', 'evidence_ladder',
  'cohesion_map', 'register_contrast', 'function_grammar_index', 'lexical_choice_map',
  'diagnostic_loop', 'timed_routine', 'priority_strategy', 'transfer_drill',
  'confidence_protocol',
] as const;

export const TOPIC_SCENES = [
  'just_started', 'topic_decoding', 'idea_block', 'outline_building',
  'paragraph_writing', 'sentence_writing', 'vocab_choice', 'grammar_use',
  'model_essay_study', 'revision', 'after_mock', 'last_month', 'last_week',
  'exam_room', 'time_pressure', 'unknown_topic',
  // 历史坐标兼容值：继续允许旧记录参与去重，但新批次不再把 daily_practice 当默认场景。
  'first_systematic_review', 'daily_practice', 'after_first_draft', 'feedback_session',
  'timed_mock', 'final_week', 'unfamiliar_prompt', 'repeat_candidate', 'independent_study',
] as const;

export type TopicDomainId = typeof TOPIC_DOMAINS[number];
export type TopicProblemId = typeof TOPIC_PROBLEMS[number];
export type TopicObjectId = typeof TOPIC_OBJECTS[number];
export type TopicMechanismId = typeof TOPIC_MECHANISMS[number];
export type TopicSceneId = typeof TOPIC_SCENES[number];
export type TopicScale = 'broad' | 'strategy' | 'reference' | 'specific';
export type TopicContentType = 'pain' | 'guide' | 'hack' | 'summary' | 'reference' | 'exercise';

export const TOPIC_SCALES = ['broad', 'strategy', 'reference', 'specific'] as const satisfies readonly TopicScale[];
export const TOPIC_CONTENT_TYPES = ['pain', 'guide', 'hack', 'summary', 'reference', 'exercise'] as const satisfies readonly TopicContentType[];

export interface TopicCoordinate {
  coordinateId: string;
  domainId: TopicDomainId;
  problemId: TopicProblemId;
  objectId: TopicObjectId;
  mechanismId: TopicMechanismId;
  sceneId: TopicSceneId;
  scale: TopicScale;
  contentType: TopicContentType;
  problemNote: string;
  outcomeNote: string;
  coordinateHash: string;
}

export const DOMAIN_LABELS: Record<TopicDomainId, string> = {
  task_decoding: '审题与任务完成', idea_generation: '观点生成', argument_development: '论证展开',
  evidence_examples: '例子与证据', structure_cohesion: '结构与衔接', register_genre: '语域与文体',
  grammar_accuracy: '语法准确与调用', lexical_precision: '词汇与搭配选择', revision_feedback: '修改与反馈闭环',
  exam_execution: '考场执行', study_strategy: '复习策略', material_transfer: '资料与范文迁移',
  confidence_rebuild: '复读与信心重建',
};

export const PROBLEM_DOMAIN: Record<TopicProblemId, TopicDomainId> = {
  misread_instruction: 'task_decoding', no_usable_ideas: 'idea_generation', thin_argument: 'argument_development',
  abstract_examples: 'evidence_examples', logic_jump: 'structure_cohesion', wrong_register: 'register_genre',
  grammar_retrieval_failure: 'grammar_accuracy', imprecise_word_choice: 'lexical_precision',
  cannot_self_diagnose: 'revision_feedback', time_control_failure: 'exam_execution',
  inefficient_practice: 'study_strategy', cannot_transfer_models: 'material_transfer',
  unstable_exam_confidence: 'confidence_rebuild',
};

export const PROBLEM_MECHANISMS: Record<TopicProblemId, TopicMechanismId[]> = {
  misread_instruction: ['instruction_matrix', 'priority_strategy', 'diagnostic_loop'],
  no_usable_ideas: ['perspective_lens', 'priority_strategy', 'transfer_drill'],
  thin_argument: ['argument_chain', 'perspective_lens', 'evidence_ladder'],
  abstract_examples: ['evidence_ladder', 'argument_chain', 'perspective_lens'],
  logic_jump: ['cohesion_map', 'argument_chain', 'diagnostic_loop'],
  wrong_register: ['register_contrast', 'transfer_drill', 'lexical_choice_map'],
  grammar_retrieval_failure: ['function_grammar_index', 'transfer_drill', 'diagnostic_loop'],
  imprecise_word_choice: ['lexical_choice_map', 'register_contrast', 'transfer_drill'],
  cannot_self_diagnose: ['diagnostic_loop', 'priority_strategy', 'transfer_drill'],
  time_control_failure: ['timed_routine', 'priority_strategy', 'diagnostic_loop'],
  inefficient_practice: ['priority_strategy', 'diagnostic_loop', 'timed_routine'],
  cannot_transfer_models: ['transfer_drill', 'diagnostic_loop', 'perspective_lens'],
  unstable_exam_confidence: ['confidence_protocol', 'timed_routine', 'diagnostic_loop'],
};

export const PROBLEM_OBJECTS: Record<TopicProblemId, TopicObjectId[]> = {
  misread_instruction: ['prompt', 'outline', 'checklist', 'mock_exam'],
  no_usable_ideas: ['theme_idea_bank', 'outline', 'argument', 'model_essay'],
  thin_argument: ['argument', 'paragraph', 'outline', 'full_draft'],
  abstract_examples: ['example', 'argument', 'paragraph', 'theme_idea_bank'],
  logic_jump: ['paragraph', 'connector', 'outline', 'full_draft'],
  wrong_register: ['formal_letter', 'forum_post', 'article_report', 'opening_closing'],
  grammar_retrieval_failure: ['verb_mood', 'sentence_pattern', 'full_draft', 'checklist'],
  imprecise_word_choice: ['vocabulary_collocation', 'sentence_pattern', 'full_draft', 'theme_idea_bank'],
  cannot_self_diagnose: ['full_draft', 'checklist', 'revision_log', 'model_essay'],
  time_control_failure: ['mock_exam', 'outline', 'full_draft', 'checklist'],
  inefficient_practice: ['study_material', 'revision_log', 'model_essay', 'mock_exam'],
  cannot_transfer_models: ['model_essay', 'sentence_pattern', 'study_material', 'theme_idea_bank'],
  unstable_exam_confidence: ['mock_exam', 'checklist', 'revision_log', 'full_draft'],
};

export function coordinateKey(input: Pick<TopicCoordinate, 'domainId' | 'problemId' | 'objectId' | 'mechanismId' | 'sceneId'>) {
  return `${input.domainId}|${input.problemId}|${input.objectId}|${input.mechanismId}|${input.sceneId}`;
}

export function coordinateHash(input: Pick<TopicCoordinate, 'domainId' | 'problemId' | 'objectId' | 'mechanismId' | 'sceneId'>) {
  return stableHash(coordinateKey(input));
}

export function validateCoordinate(coordinate: TopicCoordinate): string[] {
  const failures: string[] = [];
  if (!TOPIC_DOMAINS.includes(coordinate.domainId)) failures.push('unknown_domain');
  if (!TOPIC_PROBLEMS.includes(coordinate.problemId)) failures.push('unknown_problem');
  if (!TOPIC_OBJECTS.includes(coordinate.objectId)) failures.push('unknown_object');
  if (!TOPIC_MECHANISMS.includes(coordinate.mechanismId)) failures.push('unknown_mechanism');
  if (!TOPIC_SCENES.includes(coordinate.sceneId)) failures.push('unknown_scene');
  if (!TOPIC_SCALES.includes(coordinate.scale)) failures.push('unknown_scale');
  if (!TOPIC_CONTENT_TYPES.includes(coordinate.contentType)) failures.push('unknown_content_type');
  if (PROBLEM_DOMAIN[coordinate.problemId] !== coordinate.domainId) failures.push('problem_domain_mismatch');
  if (!PROBLEM_MECHANISMS[coordinate.problemId]?.includes(coordinate.mechanismId)) failures.push('problem_mechanism_mismatch');
  if (!coordinate.problemNote || !coordinate.outcomeNote) failures.push('missing_note');
  if (coordinate.coordinateHash !== coordinateHash(coordinate)) failures.push('coordinate_hash_mismatch');
  return failures;
}
