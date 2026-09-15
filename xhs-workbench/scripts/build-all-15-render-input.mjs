/* eslint-disable no-console */
/**
 * 把 15 个成功 job 合并成 render-batch-covers.mjs 期待的 batch JSON 格式。
 */
import fs from 'node:fs';

const SUCCESS_MAP = {
  resource_01_grammar_parchment_red: { batch: 'batch_1785854296934', job: 'job_001.json' },
  resource_02_grammar_white_green: { batch: 'batch_1785854296934', job: 'job_002.json' },
  resource_03_chalkboard_course: { batch: 'batch_1785854296934', job: 'job_008.json' },
  resource_04_chalkboard_phrase_list: { batch: 'batch_1785854296934', job: 'job_007.json' },
  resource_05_grammar_clean_purple: { batch: 'batch_1786418252988', job: 'job_001.json' },
  resource_06_notes_course_offer: { batch: 'batch_1786418252988', job: 'job_003.json' },
  resource_07_question_words_parchment: { batch: 'batch_1785854296934', job: 'job_009.json' },
  resource_08_book_cover_fle: { batch: 'batch_1785854296934', job: 'job_012.json' },
  resource_09_notebook_warning: { batch: 'batch_1785854296934', job: 'job_010.json' },
  resource_10_plain_text_experience: { batch: 'batch_1785854296934', job: 'job_006.json' },
  resource_11_delf_doc_analysis: { batch: 'batch_1786418252988', job: 'job_004.json' },
  resource_12_delf_vocab_table_overlay: { batch: 'batch_1785854296934', job: 'job_013.json' },
  resource_13_course_roadmap_blue: { batch: 'batch_1785854296934', job: 'job_014.json' },
  resource_14_collocation_dense_green: { batch: 'batch_1786422031290', job: 'job_001.json' },
  resource_15_grammar_grid_purple: { batch: 'batch_1786421005085', job: 'job_001.json' },
};

const jobs = [];
for (const [cardId, info] of Object.entries(SUCCESS_MAP)) {
  const full = `data/batches/${info.batch}/jobs/${info.job}`;
  const job = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (job.status !== 'success') {
    console.error(`!! ${cardId} status=${job.status}`);
    process.exit(1);
  }
  // render-batch-covers.mjs 期待 job.reference_card_id / product_id / draft / cover_image_url
  jobs.push(job);
}

const out = {
  id: 'all-15-combined',
  product_id: 'delf_b2_writing',
  status: 'done',
  jobs,
};

fs.writeFileSync('all-15-combined.json', JSON.stringify(out, null, 2));
console.log(`OK 写入 all-15-combined.json (jobs=${jobs.length})`);
