/** 普通 content_note 封面使用的轻量参考图池。只随机取一张，不做分类/评分。 */
export const xhsDazibaoReferencePool = [
  '/cover-style-refs/xhs-dazibao/ref_01.png', '/cover-style-refs/xhs-dazibao/ref_02.png',
  '/cover-style-refs/xhs-dazibao/ref_03.png', '/cover-style-refs/xhs-dazibao/ref_04.png',
  '/cover-style-refs/xhs-dazibao/ref_05.png', '/cover-style-refs/xhs-dazibao/ref_06.png',
  '/cover-style-refs/xhs-dazibao/ref_07.png',
] as const;
export function pickXhsDazibaoReference() {
  return xhsDazibaoReferencePool[Math.floor(Math.random() * xhsDazibaoReferencePool.length)] || xhsDazibaoReferencePool[0];
}
