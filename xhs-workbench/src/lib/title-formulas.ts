// 75 个小红书爆款标题公式。
// 来源：dbs-xhs-title/SKILL.md（YAO《182 个小红书爆款标题清单》去重合并）。
// 仅保留公式编号、心理触发器分类、模板、原始爆款——
// 多行业举例刻意不保留，避免 LLM 把美妆/健身/创业的句式带到法语学习。

export type TitleTriggerName =
  | '认知冲突'
  | '好奇缺口'
  | '恐惧损失'
  | '身份代入'
  | '数字锚定'
  | '结果承诺'
  | '场景条件'
  | '行动号召'
  | '互动测试';

export interface TitleFormula {
  id: string;
  trigger: TitleTriggerName;
  template: string;
  example: string;
}

export const TITLE_FORMULAS: TitleFormula[] = [
  // 一、认知冲突型（反常识）
  { id: '1', trigger: '认知冲突', template: '为什么 [每个人都觉得很好的事] 其实对你有害', example: '为什么喝牛奶其实对你一点也不好？' },
  { id: '2', trigger: '认知冲突', template: '为什么 [非传统操作] 是对 [目标] 有益的', example: '为什么补充脂肪，对你减肥有益' },
  { id: '3', trigger: '认知冲突', template: '为什么我不 [绝大多数人做的事]', example: '为什么我不玩微信朋友圈' },
  { id: '4', trigger: '认知冲突', template: '[行动] [行动] [行动] 的共同好处', example: '喝咖啡，玩游戏，骂脏话的共同好处' },
  { id: '5', trigger: '认知冲突', template: '为什么 [话题] 会改变一切', example: '为什么脸书算法的更新会改变一切' },
  { id: '6', trigger: '认知冲突', template: '犯了 [不同寻常的错]，我反而 [好结果]', example: '犯了这个不同寻常的错，我反而在台上特别自信' },

  // 二、好奇缺口型
  { id: '7', trigger: '好奇缺口', template: '[一群人] 不会告诉你的建议', example: '会赚钱的博主不会告诉你的建议' },
  { id: '8', trigger: '好奇缺口', template: '[专家们] 不想让你知道的 [数字] 件事', example: '营销专家们不想要你知道的 5 件事' },
  { id: '9', trigger: '好奇缺口', template: '达到 [结果]，令人意想不到的秘密', example: '给每个 35+ 职场女性的终极建议' },
  { id: '10', trigger: '好奇缺口', template: '[结果] 让你想不到的秘密', example: '全职主妇副业 90 天月入 5 万，让你想不到的秘密' },
  { id: '11', trigger: '好奇缺口', template: '关于 [某件事]，[一群人] 太晚知道的 [数字] 个教训', example: '关于互联网营销，创业者们太晚知道的 3 个教训' },
  { id: '12', trigger: '好奇缺口', template: '看完这个，你的 [想法] 会不再相同', example: '看完这个，你的思维模式会不再相同' },

  // 三、恐惧/损失规避型
  { id: '13', trigger: '恐惧损失', template: '[不想要的结果] 的最快方法', example: '台上演讲时失去自信的最快方法' },
  { id: '14', trigger: '恐惧损失', template: '[不想要的结果] 的最根本原因', example: '减肥不成功的最根本原因' },
  { id: '15', trigger: '恐惧损失', template: '[数字] 件阻碍你达成 [结果] 的事', example: '3 件阻碍你 IP 变现的事' },
  { id: '16', trigger: '恐惧损失', template: '[行为] 的后果', example: '不会网络营销的后果' },
  { id: '17', trigger: '恐惧损失', template: '警告！[数字] 件事正让你的 [努力] 白费', example: '警告！这 3 件事正让你的保湿霜涂了等于白涂' },
  { id: '18', trigger: '恐惧损失', template: '[平台/领域] 上这 [数字] 件事千万别做', example: '小红书上，这 3 件事千万别做' },
  { id: '19', trigger: '恐惧损失', template: '[一群人] 常犯的 [数字] 个错误', example: '新手营销人写文案时常犯的 12 大错误' },
  { id: '20', trigger: '恐惧损失', template: '[数字] 个最危险的 [话题]', example: '3 个最危险的减肥方法' },

  // 四、身份代入型
  { id: '21', trigger: '身份代入', template: '给每个 [年龄层/身份] 人的终极 [建议]', example: '给每个 35+ 职场女性的终极建议' },
  { id: '22', trigger: '身份代入', template: '为 [某种特质的人] 量身定制的 [方案]', example: '为镜头害羞的创业者们量身定制的视频营销策略' },
  { id: '23', trigger: '身份代入', template: '给 [一群人] 的一个忠告', example: '给 30+ 正经历迷茫的创业者们的一段话' },
  { id: '24', trigger: '身份代入', template: '[指出特征] 的人', example: '25 岁还没有分文存款的人' },
  { id: '25', trigger: '身份代入', template: '给 [一群人] 的最好忠告', example: '给创业失败的人的最好忠告' },

  // 五、数字锚定型
  { id: '26', trigger: '数字锚定', template: '[数字] 个达成 [结果] 的小窍门', example: '5 个创造让人无法抗拒 OFFER 的小窍门' },
  { id: '27', trigger: '数字锚定', template: '[话题] 的 [数字] 个步骤', example: '搞懂小红书运营的 10 个步骤' },
  { id: '28', trigger: '数字锚定', template: '[结果] 的 [数字] 个技巧', example: '小红书增粉的 10 个技巧' },
  { id: '29', trigger: '数字锚定', template: '[行动] 时，[数字] 个最有用的词', example: '说服别人时，5 个最有用的词汇' },
  { id: '30', trigger: '数字锚定', template: '让你更 [结果] 的 [数字] 个方法', example: '让你在镜头前更自信的 5 个方法' },
  { id: '31', trigger: '数字锚定', template: '[数字] 个让你 [结果] 的特质', example: '5 个让你立刻产生公信力的特质' },
  { id: '32', trigger: '数字锚定', template: '[数字] 个 [话题] 的最大谎言', example: '5 个对抗焦虑的最大谎言' },

  // 六、结果承诺型
  { id: '33', trigger: '结果承诺', template: '如何不 [讨厌的事]，就能在 [时间] 里达到 [结果]', example: '如何不付 KOL 广告费，就能在一个月内从小红书变现' },
  { id: '34', trigger: '结果承诺', template: '[数字] 天内 [结果] 的唯一办法', example: '90 天内打造个人 IP 变现 6 位数的唯一办法' },
  { id: '35', trigger: '结果承诺', template: '我如何在 [时间] 内 [结果]', example: '我如何在 90 分钟赚到 10 万' },
  { id: '36', trigger: '结果承诺', template: '没有 [资源]，也能 [结果]', example: '不会 IT，也能几分钟搭好你的自建站' },
  { id: '37', trigger: '结果承诺', template: '如何把 [小数] 变成 [大数]', example: '如何把 ¥100 变成 ¥10000' },
  { id: '38', trigger: '结果承诺', template: '[结果]，头 [数字] 小时你需要做什么', example: '开赚钱的网店，头 24 小时你需要做什么' },
  { id: '39', trigger: '结果承诺', template: '一招就能帮你带来三倍 [结果]', example: '一招就能帮你带来三倍的赞藏量' },
  { id: '40', trigger: '结果承诺', template: '如何 [行动]，好让你 [结果]', example: '如何开始副业，好让你赚钱带娃两不误' },

  // 七、社会证明/反转叙事型（保留，但 DELF seeds 当前未引用，备选）
  { id: '41', trigger: '结果承诺', template: '我是如何从 [不想要的结果] 到 [想要的结果]', example: '我是如何从身无分文到年入百万' },
  { id: '42', trigger: '认知冲突', template: '从 [经历] 中学到的最重要的教训', example: '从年入 7 位数到公司破产，我学到的最重要的教训' },
  { id: '43', trigger: '结果承诺', template: '我是如何在没 [资源] 的情况下 [结果]', example: '我是如何在没有产品的情况下，创造了 6 位数的收入' },
  { id: '44', trigger: '结果承诺', template: '[话题] - 真实案例', example: '"我如何 6 个月就完成了 1 年的业绩" - 过往案例' },
  { id: '45', trigger: '认知冲突', template: '[负面事件] 是如何带给我 [正面结果] 的', example: '公司破产是如何带给我财富自由和内心平静的' },
  { id: '46', trigger: '恐惧损失', template: '我差一点就 [负面的事]', example: '我差一点就不再相信任何人' },
  { id: '47', trigger: '认知冲突', template: '从 [经历] 中我所学到的', example: '跟好朋友一起创业失败，我学到了什么' },

  // 八、争议/挑衅型（保留，但 DELF seeds 当前未引用）
  { id: '48', trigger: '认知冲突', template: '[行动] 是在浪费时间么？', example: '寻找愿意免费合作的 KOL 是在浪费时间么？' },
  { id: '49', trigger: '认知冲突', template: '[结果] 会让你快乐么？', example: '赚 10 万会让你快乐么？' },
  { id: '50', trigger: '行动号召', template: '[行动] 会不会是你做过的最好决定？', example: '裸辞会不会是你做过的最好决定？' },
  { id: '51', trigger: '认知冲突', template: '[已经过时了] 么？', example: '做微商已经过时了么？' },
  { id: '52', trigger: '认知冲突', template: '[好的特质] VS [坏的特质] - 如何区分', example: '自信 VS 自大 - 如何区分' },
  { id: '53', trigger: '认知冲突', template: '[一群人] 是天生的，还是后天养成的', example: '领导者是天生的，还是后天养成的' },
  { id: '54', trigger: '行动号召', template: '停止 [行动]！！开始 [行动]！！', example: '停止学习！！开始实践！！' },
  { id: '55', trigger: '互动测试', template: '你到底要不要 [话题]', example: '你到底要不要用眼霜？' },

  // 九、场景/条件型
  { id: '56', trigger: '场景条件', template: '如果你 [抗拒] [抗拒] [抗拒]，如何解决 [问题]', example: '如果你没有经验、没有团队、没有专业技能，如何在充满噪音的互联网上出彩？' },
  { id: '57', trigger: '场景条件', template: '在 [人生阶段] 之后，你需要做的事情', example: '大学毕业后，你最需要做的事情！！' },
  { id: '58', trigger: '场景条件', template: '当 [一群人] 说「[引用]」', example: '当你的客户说，「让我想想」' },
  { id: '59', trigger: '场景条件', template: '如果你可以拿 [拥有的] 换 [可以拥有的]，你愿意么？', example: '如果你可以拿 10 万块换到 10 万账号粉丝，你愿意么？' },
  { id: '60', trigger: '场景条件', template: '当你知道你会 [负面情绪]，如何 [结果]', example: '当你知道你会紧张，如何在台上自信演讲' },

  // 十、行动号召型
  { id: '61', trigger: '行动号召', template: '为什么你应该停止 [行动]', example: '为什么你应该停止不停地学习' },
  { id: '62', trigger: '行动号召', template: '别再关心 [话题]', example: '别再关心别人怎么看你了' },
  { id: '63', trigger: '行动号召', template: '别再寻找 [结果]，开始行动才是王道', example: '别再寻找做副业的捷径了，开始行动才是王道' },
  { id: '64', trigger: '行动号召', template: '戒掉 [平常的事] - 这会让你和别人不一样', example: '戒掉朋友圈 - 这会让你和别人不一样' },
  { id: '65', trigger: '行动号召', template: '为什么我 [讨厌做的事]，你也应该这么做', example: '为什么我每天 4 点起床，你也应该这么做' },
  { id: '66', trigger: '行动号召', template: '如何每天 [积极的事]，哪怕你 [不方便] 都可以', example: '如何每天坚持读书，哪怕只有 5 分钟' },

  // 十一、权威借力型（保留，DELF seeds 当前未引用，避免冒充真人案例）
  { id: '67', trigger: '结果承诺', template: '[名人] [话题] 帮助我 [结果]', example: 'TONY ROBBINS 的晨间冥想帮助我保持心流状态' },
  { id: '68', trigger: '结果承诺', template: '[名人] 教会我 [话题] 的技能', example: '奥普拉教会我反转逆境的技能' },
  { id: '69', trigger: '好奇缺口', template: '[名人] 如何 [结果]', example: 'GARY V - 如何更经常的说不' },
  { id: '70', trigger: '好奇缺口', template: '最好的 [一群人] 都做了什么不同的事情？', example: '最赚钱的短线投资人都做了什么不同的事情？' },
  { id: '71', trigger: '好奇缺口', template: '[一群人] [做一件事] 成功的最根本原因', example: '全职妈妈副业成功的最根本原因' },

  // 十二、互动/测试型
  { id: '72', trigger: '互动测试', template: '敢不敢测一测，[话题]', example: '敢不敢测一测，你的脸书主页是不是最优化的' },
  { id: '73', trigger: '互动测试', template: '如果你想要 [结果]，你需要先对它着迷', example: '如果你想要赚钱，你需要先对它着迷' },
  { id: '74', trigger: '互动测试', template: '关于 [话题]，我的处世哲学/原则', example: '关于宝妈创业，我的基本原则' },
  { id: '75', trigger: '互动测试', template: '至关紧要的头 [数字] 分钟 - 如何 [话题]', example: '至关紧要的头一分钟 - 如何谈判' },
];

const FORMULA_BY_ID = new Map(TITLE_FORMULAS.map(formula => [formula.id, formula]));

// DELF seed 的 title_trigger_types 字段可能用中文（如"好奇缺口"）或英文（如"curiosity_gap"）。
// 这里只处理中文 trigger，与 editorial-seed-library.ts 的 DELF seeds 保持一致。
const TRIGGER_ALIASES: Record<string, TitleTriggerName> = {
  '认知冲突': '认知冲突',
  '好奇缺口': '好奇缺口',
  '恐惧损失': '恐惧损失',
  '身份代入': '身份代入',
  '数字锚定': '数字锚定',
  '结果承诺': '结果承诺',
  '场景条件': '场景条件',
  '行动号召': '行动号召',
  '互动测试': '互动测试',
  // 英文别名（TEF seeds 用的是英文）
  fear_loss: '恐惧损失',
  cognitive_conflict: '认知冲突',
  curiosity_gap: '好奇缺口',
  number_anchor: '数字锚定',
  scenario: '场景条件',
  result_promise: '结果承诺',
  action_call: '行动号召',
  interaction_test: '互动测试',
  identity: '身份代入',
};

export function pickFormulasForTriggerTypes(
  triggerTypes: readonly string[],
  count = 6,
  seed?: string,
): TitleFormula[] {
  const triggers = new Set(
    triggerTypes
      .map(type => TRIGGER_ALIASES[type] || TRIGGER_ALIASES[type.toLowerCase()])
      .filter(Boolean),
  );
  // 之前每次都按固定顺序取前 N 个，导致同 trigger_type 的不同 job 公式高度重复。
  // 现在按 seed 对每个 trigger 分组内部做轮转：同 seed 稳定，不同 seed 拿到不同公式。
  const rotate = <T>(arr: T[], seedStr: string): T[] => {
    if (!seedStr || arr.length <= 1) return arr;
    let h = 0x811c9dc5;
    for (let i = 0; i < seedStr.length; i += 1) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    const offset = h % arr.length;
    return [...arr.slice(offset), ...arr.slice(0, offset)];
  };
  if (triggers.size === 0) {
    // 兜底：没匹配到时返回通用的强钩子公式（按 seed 轮转）
    const fallback = TITLE_FORMULAS.filter(f => ['17', '19', '27', '7', '1', '32'].includes(f.id));
    return rotate(fallback, seed || '').slice(0, count);
  }
  // 按 trigger 命中分组，循环取，保证每种 trigger 都出现
  const byTrigger = new Map<string, TitleFormula[]>();
  for (const formula of TITLE_FORMULAS) {
    if (!triggers.has(formula.trigger)) continue;
    const list = byTrigger.get(formula.trigger) || [];
    list.push(formula);
    byTrigger.set(formula.trigger, list);
  }
  // 每个 trigger 分组内按 seed 轮转
  if (seed) {
    for (const [trigger, list] of byTrigger.entries()) {
      byTrigger.set(trigger, rotate(list, `${seed}:${trigger}`));
    }
  }
  const result: TitleFormula[] = [];
  const lists = Array.from(byTrigger.values());
  let idx = 0;
  while (result.length < count && lists.some(l => l.length > 0)) {
    for (const list of lists) {
      if (list.length === 0) continue;
      const next = list.shift();
      if (next && !result.some(r => r.id === next.id)) result.push(next);
      if (result.length >= count) break;
    }
    idx += 1;
    if (idx > 30) break; // 安全防护
  }
  return result.slice(0, count);
}

export function getFormulaById(id: string): TitleFormula | undefined {
  return FORMULA_BY_ID.get(id);
}
