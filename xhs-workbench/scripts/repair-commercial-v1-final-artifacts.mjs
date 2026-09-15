import fs from "node:fs/promises";
import path from "node:path";

const batchRoot = path.resolve("data/batches/batch_commercial_v1_1788485294624/jobs");
const backupRoot = path.resolve("data/batches/batch_commercial_v1_1788485294624/pre-commercial-final-backup");

const covers = {
  job_001: {
    kind: "dense_directory",
    title: "B2写作拒绝空洞观点",
    subtitle: "从个人生活到社会议题的高频论证链",
    sections: [
      {
        side_label: "高频话题",
        heading: "高频话题底层逻辑（样张）",
        columns: 2,
        items: [
          { primary: "环境：数字化污染", secondary: "电子垃圾与云端能耗", note: "从日常设备延伸到环境议题" },
          { primary: "科技：人际疏离", secondary: "虚拟社交 vs 现实连接", note: "从个人体验延伸到社会影响" },
        ],
      },
      {
        side_label: "正反论据",
        heading: "正反方论点速查表",
        columns: 2,
        items: [
          { primary: "远程办公：灵活性", secondary: "支持点：时间自主", note: "补充个人与企业层面的影响" },
          { primary: "远程办公：协作成本", secondary: "反方点：沟通效率下降", note: "加入让步与反驳" },
        ],
      },
      {
        side_label: "使用方法",
        heading: "素材怎么放进作文",
        columns: 2,
        items: [
          { primary: "先表明立场", secondary: "再写原因与具体后果", note: "最后用例子把观点落地" },
        ],
      },
      {
        side_label: "事实切入",
        heading: "不用编数字的事实角度",
        columns: 2,
        items: [
          { primary: "电子垃圾与能源消耗", secondary: "适用话题：环境与科技", note: "描述可观察现象，不虚构统计" },
        ],
      },
    ],
  },
  job_002: {
    kind: "dense_directory",
    title: "B2写作别堆砌大词！",
    subtitle: "精准用词 > 华丽辞藻，附表达对照",
    sections: [
      {
        side_label: "语域选择",
        heading: "口语表达怎么改得更书面",
        columns: 2,
        items: [
          { primary: "genre（口语填充）", secondary: "par exemple / comme", note: "不是逐词替换：先判断原句功能" },
          { primary: "表达较泛", secondary: "utile / bénéfique（按语境）", note: "根据具体含义选择更准确的词" },
        ],
      },
      {
        side_label: "任务提醒",
        heading: "写作任务先检查这些",
        columns: 3,
        items: [
          { primary: "250 mots minimum", secondary: "按题目要求完成字数", note: "避免内容展开不足" },
          { primary: "1 heure", secondary: "预留审题与检查时间", note: "不要把时间全耗在开头" },
          { primary: "Respect de la consigne", secondary: "回应任务、受众与文体", note: "先确认自己在写什么" },
        ],
      },
      {
        side_label: "原因表达",
        heading: "原因连接：看语义，也看结构",
        columns: 3,
        items: [
          { primary: "à cause de + nom", secondary: "通常用于不利原因", note: "例：à cause du bruit" },
          { primary: "grâce à + nom", secondary: "通常用于有利原因", note: "例：grâce à cette mesure" },
          { primary: "en raison de + nom", secondary: "较中性的原因说明", note: "例：en raison des travaux" },
          { primary: "du fait que + phrase", secondary: "后接完整分句", note: "不要和名词结构混用" },
        ],
      },
      {
        side_label: "对比结果",
        heading: "对比与结果表达",
        columns: 3,
        items: [
          { primary: "tandis que", secondary: "连接两个对比的分句", note: "突出差异" },
          { primary: "par conséquent", secondary: "引出结果", note: "比反复使用 donc 更书面" },
          { primary: "de sorte que", secondary: "根据语义表达结果或目的", note: "语式取决于句意" },
        ],
      },
    ],
  },
  job_003: {
    kind: "dense_directory",
    title: "B2写作：投诉信别太像聊天",
    subtitle: "同一个意思，换成更适合正式信的表达",
    sections: [
      {
        side_label: "口语痕迹",
        heading: "这些词不是错，但要看语境",
        columns: 2,
        items: [
          { primary: "on", secondary: "nous / les personnes concernées / 具体主体", note: "正式信里优先把主体说清楚" },
          { primary: "ça", secondary: "cela / cette situation", note: "正式语境中通常更自然" },
          { primary: "beaucoup de", secondary: "de nombreux / un grand nombre de", note: "需要更精确时再替换" },
          { primary: "super", secondary: "très satisfaisant / particulièrement utile", note: "避免明显口语化评价" },
        ],
      },
      {
        side_label: "语气调整",
        heading: "投诉要明确，也要保持正式",
        columns: 2,
        items: [
          { primary: "je veux que…", secondary: "je souhaiterais que…", note: "表达诉求时更委婉" },
          { primary: "情绪化判断", secondary: "cette situation demeure inacceptable", note: "把情绪判断改成正式陈述" },
          { primary: "faites quelque chose", secondary: "je vous prie de prendre les mesures nécessaires", note: "说明希望对方采取的行动" },
        ],
      },
      {
        side_label: "快速自查",
        heading: "交卷前扫一遍口语残留",
        columns: 2,
        items: [
          { primary: "省略 ne 的口语否定", secondary: "je ne suis pas / je ne peux pas", note: "书面语保留完整否定结构" },
          { primary: "tu / toi", secondary: "vous", note: "正式致信时确认称呼与受众" },
          { primary: "euh / ben", secondary: "直接删除", note: "口语填充词不进入正式文本" },
        ],
      },
      {
        side_label: "具体改写",
        heading: "把模糊动作写具体",
        columns: 2,
        items: [
          { primary: "faire quelque chose", secondary: "prendre des mesures", note: "明确行动" },
          { primary: "changer la situation", secondary: "remédier à cette situation", note: "明确要解决的问题" },
          { primary: "直接表示反对", secondary: "je souhaite contester cette décision", note: "明确争议对象" },
        ],
      },
    ],
  },
};

const captions = {
  job_001: `DELF B2 写作遇到环保、科技或社会类题目时，真正难的往往不是法语，而是看到题目后没有可以展开的观点。

这篇把素材整理成“核心冲突—支持理由—反方理由—具体后果”的调用方式。以远程办公为例，可以从时间自主、通勤成本、团队协作和非正式交流减少几个角度展开；写环境或科技题时，也可以从个人体验继续推到企业与社会影响。

使用时不用背整段。先确认题目的争议点，再选一个立场，补上原因和具体后果，最后用一个可观察的现象或例子落地。这样比临场编数字更稳，也更容易迁移到陌生题。

想继续系统准备，可以在商品卡片里查看按题型整理的范文、功能句、主题观点和写后检查工具。`,
  job_002: `B2 写作并不是词越生僻越好。真正影响表达质量的，是词义是否准确、搭配是否自然，以及语体是否适合当前任务。

例如，on 和 beaucoup de 本身并没有语法错误；当指代不清或表达太笼统时，再根据句意改成具体主体、de nombreuses personnes 等写法。ça 在正式论证中常可换成 cela 或直接点明 cette situation，但同样不能脱离语境机械替换。

原因表达也要同时看语义和结构：à cause de、grâce à、en raison de 后接名词成分；parce que、puisque、du fait que 后接完整分句。选择连接词不是为了显得高级，而是为了把关系说准。

想继续系统整理，可在商品卡片中查看按原因、观点、对比、结果等功能分类的表达、范文和写后自查材料。`,
  job_003: `投诉信写得像聊天，通常不是因为出现了某一个“禁词”，而是指代不清、请求过于直接，或称呼与结尾不符合当前收信关系。

on、ça、beaucoup de 并非一律错误。正式信中可以优先把主体和对象说清楚，例如用 les personnes concernées、cette situation；表达诉求时，可根据语境把 Je veux que… 调整为 Je souhaiterais que…，或使用 Je vous saurais gré de bien vouloir…。

写完后重点检查四处：人称是否匹配收信人，代词指向是否清楚，请求语气是否礼貌，结尾敬语是否符合文体。需要段落级转折时，再考虑 cependant、toutefois、par conséquent 等表达，不必机械替换每一个 mais 或 donc。

想继续系统准备正式信、建议信和投诉信，可以在商品卡片中查看对应范文、可复用句型与自查清单。`,
};

await fs.mkdir(backupRoot, { recursive: true });

for (const jobId of Object.keys(covers)) {
  const file = path.join(batchRoot, `${jobId}.json`);
  const backup = path.join(backupRoot, `${jobId}.json`);
  try {
    await fs.access(backup);
  } catch {
    await fs.copyFile(file, backup);
  }

  const job = JSON.parse(await fs.readFile(file, "utf8"));
  job.draft.cover = covers[jobId];
  job.draft.caption = captions[jobId];
  job.artifacts.compiledDraft.data.cover = structuredClone(covers[jobId]);
  job.artifacts.compiledDraft.data.caption = captions[jobId];

  if (jobId === "job_003") {
    job.reference_card_id = "resource_06_notes_course_offer";
    for (const pageSet of [job.draft.inner_pages, job.artifacts.compiledDraft.data.inner_pages]) {
      const firstPage = pageSet?.find((page) => page.page_no === 1);
      if (firstPage) {
        firstPage.page_type = "knowledge_list";
        firstPage.semanticLayoutType = "knowledge_list";
        firstPage.renderPayload = { semanticLayoutType: "knowledge_list" };
        firstPage.renderPayloadStatus = "INSUFFICIENT_STRUCTURED_CONTENT";
      }
    }
  }

  const pagePatches = {
    job_001: {
      1: {
        bulletIndex: 2,
        text: "通用事实与例子组织方式：从可观察的生活现象切入，例如电子垃圾、通勤时间、远程协作成本等。每个例子标注适用话题和引入方式，不依赖临场编造的统计数字。",
      },
      3: {
        bulletIndex: 2,
        text: "第三步：嵌入具体例子。选择一个可观察的生活现象，如电子设备更新带来的电子垃圾，并用“Comme le montre...”等句型自然引入，不编造没有来源的数据。",
      },
    },
    job_002: {
      5: {
        bulletIndex: 2,
        text: "资料接得上的地方：完整写作库按写作任务和表达功能整理范文、常用句型、主题观点与检查工具，方便在练习和复盘时按需查找。",
      },
    },
    job_003: {
      4: {
        bulletIndex: 0,
        text: "本篇先解决：识别正式信里容易显得随意或指代不清的表达，并根据收信人和写信目的调整语气。",
      },
    },
  }[jobId] || {};
  for (const pageSet of [job.draft.inner_pages, job.artifacts.compiledDraft.data.inner_pages]) {
    if (!Array.isArray(pageSet)) continue;
    for (const [pageNo, patch] of Object.entries(pagePatches)) {
      const page = pageSet.find((item) => item.page_no === Number(pageNo));
      if (page?.bullets?.[patch.bulletIndex] != null) {
        page.bullets[patch.bulletIndex] = patch.text;
      }
    }
  }

  job.warnings = [
    ...(job.warnings || []),
    "COMMERCIAL_FINAL_LOCAL_REPAIR: cover/caption corrected without regenerating passed stages",
  ];
  await fs.writeFile(file, `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

console.log(`Repaired final artifacts. Backups: ${backupRoot}`);
