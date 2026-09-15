import fs from 'node:fs/promises';
import path from 'node:path';
import {
  TOPIC_DOMAINS,
  TOPIC_MECHANISMS,
  TOPIC_OBJECTS,
  TOPIC_PROBLEMS,
  TOPIC_SCENES,
  type TopicCoordinate,
  type TopicDomainId as DomainId,
  type TopicMechanismId as MechanismId,
  type TopicObjectId as ObjectId,
  type TopicProblemId as ProblemId,
  type TopicSceneId as SceneId,
} from './topic-coordinate-taxonomy';

export interface TopicCoordinateUsageRecord {
  product_id: string;
  coordinate_id: string;
  domain_id: DomainId;
  problem_id: ProblemId;
  object_id: ObjectId;
  mechanism_id: MechanismId;
  scene_id: SceneId;
  use_count: number;
  last_success_at: string;
  last_batch_id: string;
  last_job_id: string;
  recent_topics: string[];
  confirmed_job_keys: string[];
}

interface TopicCoordinateLedgerFile {
  version: 1;
  records: TopicCoordinateUsageRecord[];
}

export interface TopicCoordinateStoreReadResult {
  records: TopicCoordinateUsageRecord[];
  warnings: string[];
}

export interface ConfirmTopicCoordinateUsageInput {
  productId: string;
  coordinate: Pick<
    TopicCoordinate,
    'coordinateId' | 'domainId' | 'problemId' | 'objectId' | 'mechanismId' | 'sceneId'
  >;
  batchId: string;
  jobId: string;
  publicTopic?: string;
  successAt?: string;
}

export interface ConfirmTopicCoordinateUsageResult {
  confirmed: boolean;
  record?: TopicCoordinateUsageRecord;
  warnings: string[];
}

export interface TopicCoordinateStore {
  read(): Promise<TopicCoordinateStoreReadResult>;
  confirm(input: ConfirmTopicCoordinateUsageInput): Promise<ConfirmTopicCoordinateUsageResult>;
}

export interface CreateTopicCoordinateStoreOptions {
  storePath?: string;
  fileSystem?: Partial<TopicCoordinateStoreFileSystem>;
}

export interface TopicCoordinateStoreFileSystem {
  readFile(filePath: string, encoding: 'utf8'): Promise<string>;
  mkdir(directoryPath: string, options: { recursive: true }): Promise<unknown>;
  writeFile(filePath: string, data: string, encoding: 'utf8'): Promise<unknown>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
}

const DEFAULT_STORE_PATH = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  'data',
  'topic-coordinate-usage.json',
);
const writeQueues = new Map<string, Promise<void>>();
const defaultFileSystem: TopicCoordinateStoreFileSystem = {
  readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
  mkdir: (directoryPath, options) => fs.mkdir(directoryPath, options),
  writeFile: (filePath, data, encoding) => fs.writeFile(filePath, data, encoding),
  rename: (oldPath, newPath) => fs.rename(oldPath, newPath),
  unlink: filePath => fs.unlink(filePath),
};

function warning(action: 'read' | 'write', cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `topic_coordinate_store_${action}_failed: ${detail}`;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRecord(value: unknown): TopicCoordinateUsageRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<TopicCoordinateUsageRecord>;
  const productId = clean(raw.product_id);
  const coordinateId = clean(raw.coordinate_id);
  const domainId = clean(raw.domain_id);
  const problemId = clean(raw.problem_id);
  const objectId = clean(raw.object_id);
  const mechanismId = clean(raw.mechanism_id);
  const sceneId = clean(raw.scene_id);
  if (!productId || !coordinateId || !domainId || !problemId || !objectId || !mechanismId || !sceneId) {
    return null;
  }
  if (
    !TOPIC_DOMAINS.includes(domainId as DomainId)
    || !TOPIC_PROBLEMS.includes(problemId as ProblemId)
    || !TOPIC_OBJECTS.includes(objectId as ObjectId)
    || !TOPIC_MECHANISMS.includes(mechanismId as MechanismId)
    || !TOPIC_SCENES.includes(sceneId as SceneId)
  ) {
    return null;
  }
  return {
    product_id: productId,
    coordinate_id: coordinateId,
    domain_id: domainId as DomainId,
    problem_id: problemId as ProblemId,
    object_id: objectId as ObjectId,
    mechanism_id: mechanismId as MechanismId,
    scene_id: sceneId as SceneId,
    use_count: Number.isSafeInteger(raw.use_count) && Number(raw.use_count) >= 0
      ? Number(raw.use_count)
      : 0,
    last_success_at: clean(raw.last_success_at),
    last_batch_id: clean(raw.last_batch_id),
    last_job_id: clean(raw.last_job_id),
    recent_topics: Array.isArray(raw.recent_topics)
      ? raw.recent_topics.map(clean).filter(Boolean).slice(-2)
      : [],
    confirmed_job_keys: Array.isArray(raw.confirmed_job_keys)
      ? Array.from(new Set(raw.confirmed_job_keys.map(clean).filter(Boolean)))
      : [],
  };
}

function cloneRecord(record: TopicCoordinateUsageRecord): TopicCoordinateUsageRecord {
  return {
    ...record,
    recent_topics: [...record.recent_topics],
    confirmed_job_keys: [...record.confirmed_job_keys],
  };
}

function cloneRecords(records: TopicCoordinateUsageRecord[]): TopicCoordinateUsageRecord[] {
  return records.map(cloneRecord);
}

async function readLedger(
  storePath: string,
  fileSystem: TopicCoordinateStoreFileSystem,
): Promise<TopicCoordinateStoreReadResult> {
  let raw: string;
  try {
    raw = await fileSystem.readFile(storePath, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], warnings: [] };
    return { records: [], warnings: [warning('read', cause)] };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as Partial<TopicCoordinateLedgerFile>).records)
        ? (parsed as TopicCoordinateLedgerFile).records
        : null;
    if (!candidates) throw new Error('账本格式无效');
    const records = candidates.map(normalizeRecord).filter((item): item is TopicCoordinateUsageRecord => Boolean(item));
    const warnings = records.length === candidates.length
      ? []
      : [`topic_coordinate_store_read_failed: 已忽略 ${candidates.length - records.length} 条无效记录`];
    return { records, warnings };
  } catch (cause) {
    return { records: [], warnings: [warning('read', cause)] };
  }
}

async function atomicWrite(
  storePath: string,
  records: TopicCoordinateUsageRecord[],
  fileSystem: TopicCoordinateStoreFileSystem,
): Promise<string[]> {
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fileSystem.mkdir(path.dirname(storePath), { recursive: true });
    const payload: TopicCoordinateLedgerFile = { version: 1, records };
    await fileSystem.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await fileSystem.rename(tempPath, storePath);
    return [];
  } catch (cause) {
    await fileSystem.unlink(tempPath).catch(() => undefined);
    return [warning('write', cause)];
  }
}

async function inWriteQueue<T>(storePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(storePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  writeQueues.set(storePath, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (writeQueues.get(storePath) === current) writeQueues.delete(storePath);
  }
}

function requireValue<T extends string>(value: T, field: string): T {
  const normalized = clean(value);
  if (!normalized) throw new Error(`缺少 ${field}`);
  return normalized as T;
}

function recordKey(input: ConfirmTopicCoordinateUsageInput): string {
  const coordinate = input.coordinate;
  return [
    requireValue(input.productId, 'productId'),
    requireValue(coordinate.domainId, 'domainId'),
    requireValue(coordinate.problemId, 'problemId'),
    requireValue(coordinate.objectId, 'objectId'),
    requireValue(coordinate.mechanismId, 'mechanismId'),
    requireValue(coordinate.sceneId, 'sceneId'),
  ].join('\u001f');
}

function storedRecordKey(record: TopicCoordinateUsageRecord): string {
  return [
    record.product_id,
    record.domain_id,
    record.problem_id,
    record.object_id,
    record.mechanism_id,
    record.scene_id,
  ].join('\u001f');
}

export function createTopicCoordinateStore(
  options: CreateTopicCoordinateStoreOptions = {},
): TopicCoordinateStore {
  const storePath = options.storePath
    ? path.resolve(/*turbopackIgnore: true*/ options.storePath)
    : DEFAULT_STORE_PATH;
  const fileSystem: TopicCoordinateStoreFileSystem = {
    ...defaultFileSystem,
    ...options.fileSystem,
  };

  return {
    async read() {
      const result = await readLedger(storePath, fileSystem);
      return { records: cloneRecords(result.records), warnings: [...result.warnings] };
    },

    async confirm(input) {
      try {
        return await inWriteQueue(storePath, async () => {
          const readResult = await readLedger(storePath, fileSystem);
          if (readResult.warnings.length > 0) {
            return { confirmed: false, warnings: [...readResult.warnings] };
          }
          const batchId = requireValue(input.batchId, 'batchId');
          const jobId = requireValue(input.jobId, 'jobId');
          const idempotencyKey = `${batchId}\u001f${jobId}`;
          const aggregateKey = recordKey(input);
          const records = cloneRecords(readResult.records);
          const alreadyConfirmed = records.find(item => item.confirmed_job_keys.includes(idempotencyKey));
          if (alreadyConfirmed) {
            return {
              confirmed: false,
              record: cloneRecord(alreadyConfirmed),
              warnings: [],
            };
          }
          const existingIndex = records.findIndex(item => storedRecordKey(item) === aggregateKey);
          const existing = existingIndex >= 0 ? records[existingIndex] : undefined;

          const successAt = input.successAt ? new Date(input.successAt) : new Date();
          if (Number.isNaN(successAt.getTime())) throw new Error('successAt 不是有效时间');
          const publicTopic = clean(input.publicTopic);
          const recentTopics = publicTopic
            ? [...(existing?.recent_topics ?? []).filter(topic => topic !== publicTopic), publicTopic].slice(-2)
            : [...(existing?.recent_topics ?? [])].slice(-2);
          const coordinate = input.coordinate;
          const next: TopicCoordinateUsageRecord = {
            product_id: requireValue(input.productId, 'productId'),
            coordinate_id: existing?.coordinate_id ?? requireValue(coordinate.coordinateId, 'coordinateId'),
            domain_id: requireValue(coordinate.domainId, 'domainId'),
            problem_id: requireValue(coordinate.problemId, 'problemId'),
            object_id: requireValue(coordinate.objectId, 'objectId'),
            mechanism_id: requireValue(coordinate.mechanismId, 'mechanismId'),
            scene_id: requireValue(coordinate.sceneId, 'sceneId'),
            use_count: (existing?.use_count ?? 0) + 1,
            last_success_at: successAt.toISOString(),
            last_batch_id: batchId,
            last_job_id: jobId,
            recent_topics: recentTopics,
            // 只保留近期幂等窗口，避免同一坐标长期复用时 job key 无限增长。
            confirmed_job_keys: [...(existing?.confirmed_job_keys ?? []), idempotencyKey].slice(-64),
          };

          if (existingIndex >= 0) records[existingIndex] = next;
          else records.push(next);

          const writeWarnings = await atomicWrite(storePath, records, fileSystem);
          if (writeWarnings.length > 0) {
            return {
              confirmed: false,
              warnings: [...readResult.warnings, ...writeWarnings],
            };
          }
          return {
            confirmed: true,
            record: cloneRecord(next),
            warnings: [...readResult.warnings],
          };
        });
      } catch (cause) {
        return { confirmed: false, warnings: [warning('write', cause)] };
      }
    },
  };
}

const defaultStore = createTopicCoordinateStore();

export async function readTopicCoordinateUsage(): Promise<TopicCoordinateStoreReadResult> {
  return defaultStore.read();
}

export async function confirmTopicCoordinateUsage(
  input: ConfirmTopicCoordinateUsageInput,
): Promise<ConfirmTopicCoordinateUsageResult> {
  return defaultStore.confirm(input);
}
