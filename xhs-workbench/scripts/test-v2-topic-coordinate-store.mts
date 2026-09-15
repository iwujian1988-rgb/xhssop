import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createTopicCoordinateStore,
  type ConfirmTopicCoordinateUsageInput,
} from '../src/lib/v2/topic-coordinate-store';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'topic-coordinate-store-'));

function input(overrides: Partial<ConfirmTopicCoordinateUsageInput> = {}): ConfirmTopicCoordinateUsageInput {
  return {
    productId: 'delf_b2_writing',
    coordinate: {
      coordinateId: 'argument_development__thin_argument__argument__argument_chain__daily_practice',
      domainId: 'argument_development',
      problemId: 'thin_argument',
      objectId: 'argument',
      mechanismId: 'argument_chain',
      sceneId: 'daily_practice',
    },
    batchId: 'batch_001',
    jobId: 'job_001',
    publicTopic: 'B2论证不再只写一句理由：三层展开练习',
    successAt: '2026-08-31T08:00:00.000Z',
    ...overrides,
  };
}

try {
  const storePath = path.join(tempRoot, 'ledger.json');
  const store = createTopicCoordinateStore({ storePath });

  const first = await store.confirm(input());
  assert.equal(first.confirmed, true);
  assert.equal(first.warnings.length, 0);
  assert.equal(first.record?.use_count, 1);

  const duplicate = await store.confirm(input({ publicTopic: '换了标题也不能重复计数' }));
  assert.equal(duplicate.confirmed, false, 'batch_id + job_id 必须幂等');
  assert.equal(duplicate.record?.use_count, 1);
  assert.deepEqual(duplicate.record?.recent_topics, ['B2论证不再只写一句理由：三层展开练习']);

  const duplicateAcrossCoordinate = await store.confirm(input({
    coordinate: {
      coordinateId: 'grammar_accuracy__grammar_retrieval_failure__verb_mood__function_grammar_index__daily_practice',
      domainId: 'grammar_accuracy',
      problemId: 'grammar_retrieval_failure',
      objectId: 'verb_mood',
      mechanismId: 'function_grammar_index',
      sceneId: 'daily_practice',
    },
  }));
  assert.equal(duplicateAcrossCoordinate.confirmed, false, '幂等键必须在整个账本中生效');
  assert.equal((await store.read()).records.length, 1, '同一个 job 不得确认到第二个坐标');

  await store.confirm(input({
    batchId: 'batch_002',
    jobId: 'job_002',
    publicTopic: '论点有了却展开不动：证据卡这样用',
    successAt: '2026-08-31T09:00:00.000Z',
  }));
  const third = await store.confirm(input({
    batchId: 'batch_003',
    jobId: 'job_003',
    publicTopic: '把单薄理由扩成完整论证的三步法',
    successAt: '2026-08-31T10:00:00.000Z',
  }));
  assert.equal(third.confirmed, true);
  assert.equal(third.record?.use_count, 3, '相同五维坐标应聚合计数');
  assert.deepEqual(third.record?.recent_topics, [
    '论点有了却展开不动：证据卡这样用',
    '把单薄理由扩成完整论证的三步法',
  ], '公开选题最多保留最近2条');
  assert.equal(third.record?.last_batch_id, 'batch_003');
  assert.equal(third.record?.last_job_id, 'job_003');
  assert.equal(third.record?.last_success_at, '2026-08-31T10:00:00.000Z');

  const concurrentPath = path.join(tempRoot, 'concurrent.json');
  const concurrentStore = createTopicCoordinateStore({ storePath: concurrentPath });
  const concurrentResults = await Promise.all(Array.from({ length: 20 }, (_, index) => concurrentStore.confirm(input({
    batchId: 'batch_concurrent',
    jobId: `job_${index}`,
    publicTopic: `并发选题${index}`,
    successAt: `2026-08-31T11:${String(index).padStart(2, '0')}:00.000Z`,
  }))));
  assert.equal(concurrentResults.filter(result => result.confirmed).length, 20);
  const concurrentRead = await concurrentStore.read();
  assert.equal(concurrentRead.records.length, 1);
  assert.equal(concurrentRead.records[0].use_count, 20, '进程内串行写不能丢计数');
  assert.equal(concurrentRead.records[0].confirmed_job_keys.length, 20);
  assert.deepEqual(concurrentRead.records[0].recent_topics, ['并发选题18', '并发选题19']);

  const malformedPath = path.join(tempRoot, 'malformed.json');
  await fs.writeFile(malformedPath, '{broken json', 'utf8');
  const malformed = await createTopicCoordinateStore({ storePath: malformedPath }).read();
  assert.deepEqual(malformed.records, []);
  assert.equal(malformed.warnings.length, 1, '读取损坏账本应返回 warning');
  const malformedConfirm = await createTopicCoordinateStore({ storePath: malformedPath }).confirm(input());
  assert.equal(malformedConfirm.confirmed, false);
  assert.equal(malformedConfirm.warnings.length, 1);
  assert.equal(await fs.readFile(malformedPath, 'utf8'), '{broken json', '读取失败时不得覆盖原账本');

  const unreadableDirectory = path.join(tempRoot, 'read-as-directory');
  await fs.mkdir(unreadableDirectory);
  const unreadable = await createTopicCoordinateStore({ storePath: unreadableDirectory }).read();
  assert.deepEqual(unreadable.records, []);
  assert.equal(unreadable.warnings.length, 1, '读取失败不得抛垮生产');

  const blockedParent = path.join(tempRoot, 'blocked-parent');
  await fs.writeFile(blockedParent, 'not a directory', 'utf8');
  const unwritable = await createTopicCoordinateStore({ storePath: path.join(blockedParent, 'ledger.json') })
    .confirm(input());
  assert.equal(unwritable.confirmed, false);
  assert.equal(unwritable.record, undefined, '写入失败不能伪装成已确认');
  assert.equal(unwritable.warnings.length, 1, '写入失败应返回 warning');

  const renameFailurePath = path.join(tempRoot, 'rename-failure.json');
  const renameFailureStore = createTopicCoordinateStore({
    storePath: renameFailurePath,
    fileSystem: {
      rename: async () => {
        throw new Error('simulated atomic rename failure');
      },
    },
  });
  const renameFailure = await renameFailureStore.confirm(input());
  assert.equal(renameFailure.confirmed, false);
  assert.equal(renameFailure.record, undefined);
  assert.match(renameFailure.warnings.join('\n'), /topic_coordinate_store_write_failed/);
  await assert.rejects(fs.access(renameFailurePath), '原子重命名失败时不应出现半成品正式账本');

  const persisted = JSON.parse(await fs.readFile(storePath, 'utf8')) as { version: number; records: unknown[] };
  assert.equal(persisted.version, 1);
  assert.equal(persisted.records.length, 1);

  console.log('PASS topic-coordinate-store: 聚合、recent topics、幂等、容错、原子串行写均通过');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
