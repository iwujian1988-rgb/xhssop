import type { ContentShape } from '@/types/reference-workflow';
import type { ProductId } from '@/types/data';

export interface ProductPromptProfile {
  productId: ProductId;
  adminName: string;
  noteIdentity: string;
  shortIdentity: string;
  requiredIdentityPattern: RegExp;
  forbiddenIdentityPattern: RegExp;
  topicScopePrompt: string;
  contentScopePrompt: string;
  editorialScopePrompt: string;
  auditScopePrompt: string;
  titleExamples: string[];
  examFactRules: string;
  seoKeywords: string[];
  tagIdentity: string;
  coverFallbackTitles: Partial<Record<ContentShape, string>>;
}

const profiles: Record<ProductId, ProductPromptProfile> = {
  delf_b2_writing: {
    productId: 'delf_b2_writing',
    adminName: '商品1：DELF B2写作知识库',
    noteIdentity: 'DELF B2写作',
    shortIdentity: 'DELF B2',
    requiredIdentityPattern: /DELF\s*B2|\u6cd5\u8bed\s*B2(?:\u5199\u4f5c|\u4f5c\u6587)|B2\s*(?:\u5199\u4f5c|\u4f5c\u6587)|\u6cd5\u8bed\u5199\u4f5c/i,
    forbiddenIdentityPattern: /\bTEF\b|\bTCF\b|\bCLB\s*\d*\b|\bNCLC\s*\d*\b|加拿大(?:移民|法语考试|法语备考)/i,
    topicScopePrompt: '当前是商品1。选题只围绕DELF B2写作：正式信、建议信、投诉/反对信、论坛投稿、评分、自查、范文迁移、词汇句法与观点展开。禁止引入TEF、TCF、CLB、NCLC、加拿大移民、口语考试、短信或简讯任务。',
    contentScopePrompt: '当前是商品1。所有用户可见内容只能写DELF B2写作，禁止出现TEF、TCF、CLB、NCLC或加拿大移民语境；面向用户时说"写作题型/文体"，不要说"写作任务"；题型只含正式信、建议信、投诉/反对信和论坛投稿，不得引入口语考试、短信或简讯。',
    editorialScopePrompt: '商品1正文与内页只能围绕DELF B2写作，不得混入TEF/TCF/CLB或加拿大移民语境。学习建议不能冒充DELF官方强制规则。',
    auditScopePrompt: '仅拦截与商品1有关的明确考试事实错误：DELF B2写作少于250词、正式信与论坛投稿混用、敬语适用范围明显错误。不要审查TEF/TCF规则，也不要做额外教研扩展。',
    titleExamples: [
      'DELF B2写作模板别乱套',
      '7天冲B2写作，先救这步',
      '考官最爱看的不是高级词',
      '稳过B2的人先查这张表',
      '法语B2作文像A2？问题在这',
      'DELF B2写作别再背范文',
      '写完法语作文，先别急着交',
      '法语B2写作总跑题？先查这3处',
      'DELF B2正式信最容易错这步',
    ],
    examFactRules: '权威考试规则优先：DELF B2写作要求至少250词，不得写230-280词；官方没有规定必须几个论据、B2词、主题词、虚拟式、条件式、关系从句或每段一个连接词。on、à mon avis等表达不能脱离语境一律禁用。',
    seoKeywords: ['DELF B2写作', '法语写作', 'DELF B2备考'],
    tagIdentity: 'DELFB2',
    coverFallbackTitles: {
      directory: 'DELF B2写作资料大全',
      phrase: '法语B2必背高频表达',
      offer: '法语B2写作学习方案',
      flashcard: '法语B2写作必背词卡',
      book: 'DELF B2写作速通手册',
      pain: 'DELF B2写作别再乱练',
      experience: 'DELF B2写作上岸复盘',
      document: 'DELF B2写作素材解析',
      table: 'DELF B2写作主题词汇大全',
      roadmap: 'DELF B2写作7天急救路径',
    },
  },
  tef_tcf_canada: {
    productId: 'tef_tcf_canada',
    adminName: '商品2：TEF/TCF Canada备考资料包',
    noteIdentity: 'TEF/TCF Canada',
    shortIdentity: 'TEF/TCF',
    requiredIdentityPattern: /TEF\s*\/\s*TCF|TEF.{0,4}TCF|TCF.{0,4}TEF|TEF\s*Canada|TCF\s*Canada|\bCLB\s*\d*\b|\bNCLC\s*\d*\b|加拿大法语(?:考试|备考)?/i,
    forbiddenIdentityPattern: /\bDELF\b|\bDALF\b|B2\s*写作|法语\s*B2\s*写作/i,
    topicScopePrompt: '当前是商品2。选题只围绕TEF/TCF Canada、CLB/NCLC、加拿大法语备考、听说读写四科、选考、自测、30天计划、写作句型、主题词汇、听力口语、避坑和报名查分流程。禁止出现DELF、DALF、DELF B2写作或把商品2写成法国文凭考试。',
    contentScopePrompt: '当前是商品2。所有用户可见内容只能属于TEF/TCF Canada、CLB/NCLC或加拿大法语备考语境，禁止出现DELF、DALF或DELF B2写作。涉及报名、费用、政策和评分换算时只使用给定证据，拿不准就提示以官网为准。',
    editorialScopePrompt: '商品2正文与内页只能围绕TEF/TCF Canada、CLB/NCLC和加拿大法语备考，不得混入DELF/DALF语境。听说读写方法可以原创，但不能冒充官方规则、押题或固定提分承诺。',
    auditScopePrompt: '商品2只审查法语例句、释义、TEF/TCF名称、CLB/NCLC表述和给定证据支持的考试事实。报名日期、费用、政策、题型变化等时效信息没有证据时不得补写；不要套用DELF写作250词、正式信或论坛投稿规则。',
    titleExamples: [
      '3个月冲CLB7，先别乱刷',
      '想稳过CLB7，先测这一步',
      'TEF/TCF资料别再乱收了',
      '官方必背模板？先看这张表',
      'TEF还是TCF？别急着报名',
      'CLB7四科差在哪？先测这一步',
      'TEF/TCF备考越刷越乱？先停',
      '加拿大法语备考资料别再乱收',
      'TCF听力临考猛刷题有用吗',
    ],
    examFactRules: 'TEF/TCF Canada、CLB/NCLC、报名、费用、政策、题型、字数、评分维度和分数换算只能使用当前证据；不得套用DELF写作规则。没有逐字证据时，不得写“官方评分标准、通常要求200-250词、三大评分维度、少于180词会影响表达”等官方规则口吻，只能写成“练习自查维度/备考复盘清单”。不得把学习建议写成官方配额，也不得承诺固定天数提分、保过或押题命中。',
    seoKeywords: ['TEF TCF Canada', 'CLB7法语', '加拿大法语备考'],
    tagIdentity: 'TEFTCFCanada',
    coverFallbackTitles: {
      directory: 'TEF/TCF Canada资料大全',
      phrase: 'TEF/TCF必背高频表达',
      offer: 'TEF/TCF Canada备考方案',
      flashcard: 'TEF/TCF必背词卡',
      book: 'TEF/TCF Canada速通手册',
      pain: 'TEF/TCF备考别再乱刷',
      experience: 'TEF/TCF备考复盘',
      document: 'TEF/TCF素材解析',
      table: 'TEF/TCF主题词汇大全',
      roadmap: '3个月冲CLB7备考路径',
    },
  },
};

export function getProductPromptProfile(productId: ProductId) {
  return profiles[productId];
}

export function hasRequiredProductIdentity(productId: ProductId, value: string) {
  return getProductPromptProfile(productId).requiredIdentityPattern.test(value);
}

export function hasForbiddenProductIdentity(productId: ProductId, value: string) {
  return getProductPromptProfile(productId).forbiddenIdentityPattern.test(value);
}

export function isProductPublicTextSafe(productId: ProductId, value: string) {
  return !hasForbiddenProductIdentity(productId, value);
}

export function getProductCoverFallbackTitle(productId: ProductId, family?: ContentShape) {
  const profile = getProductPromptProfile(productId);
  return (family && profile.coverFallbackTitles[family]) || `${profile.noteIdentity}知识体系`;
}
