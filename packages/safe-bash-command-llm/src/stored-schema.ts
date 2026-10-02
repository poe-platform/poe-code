import { FsError, type CommandContext } from 'safe-bash-contracts';
import { pathOf } from 'safe-bash-contracts/path';
import { createLlmConfiguration } from './configuration.js';
import { scanSqliteRecords } from './sqlite-scan.js';
import { readSqliteValues } from './sqlite-values.js';
import { verifySqliteSnapshot } from './sqlite-snapshot.js';
import type { SqliteRecordValue } from './sqlite-record.js';

export interface LlmStoredSchemaOptions {
  readonly database?: string;
  /** Apply pinned migrations and recover WAL/journals atomically before reading. */
  readonly migrate?: boolean;
  readonly maxBytes?: number;
  readonly admitBytes?: (size: number) => void;
}

/** Read a schema ID from the reference logs.db on the caller's filesystem.
 * Database pages stay bounded; the selected schema becomes a provider control
 * object under the caller's byte budget. Without migration enabled, the database
 * must be checkpointed. */
export async function loadLlmStoredSchema(
  context: Pick<CommandContext, 'fs' | 'cwd' | 'env' | 'signal'>,
  id: string,
  options: LlmStoredSchemaOptions = {},
): Promise<Record<string, unknown> | undefined> {
  const { fs, signal } = context;
  signal.throwIfAborted();
  const maxBytes = options.maxBytes ?? Infinity;
  if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) throw new RangeError('Invalid schema byte limit');
  const path = options.database === undefined ? `${createLlmConfiguration(context).directory}/logs.db` : pathOf(context, options.database);
  let expected;
  try { expected = await fs.stat(path, { signal }); }
  catch (error) { if (error instanceof FsError && error.code === 'ENOENT') return undefined; throw error; }
  if (options.migrate) {
    const { readMigratedHistorySchema } = await import('./history-schema-read.js');
    return readMigratedHistorySchema(fs,path,id,signal,options);
  }
  const checkpointed = async (): Promise<void> => {
    for (const suffix of ['-wal', '-journal']) {
      try {
        if ((await fs.stat(path + suffix, { signal })).size > 0) throw new FsError('ENOTSUP', { path, message: 'LLM history requires a checkpointed SQLite snapshot' });
      } catch (error) { if (!(error instanceof FsError) || error.code !== 'ENOENT') throw error; }
    }
  };
  await checkpointed();
  if (expected.type !== 'file') throw new FsError('EINVAL', { path });
  if (!expected.size) return undefined;
  const capabilities = await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities;
  if (!capabilities.retainedRead || !fs.openReadFile) throw new FsError('ENOTSUP', { path, message: 'LLM history requires retained reads' });
  const file = await fs.openReadFile(path, { signal });
  try {
    verifySqliteSnapshot(await file.stat({ signal }), expected);
    const header = new Uint8Array(60);
    for (let position = 0; position < header.length;) {
      const bytes = await file.read(position, header.length - position, { signal });
      if (!bytes.length || bytes.length > header.length - position) throw new FsError('EIO', { path, message: 'Invalid SQLite header' });
      header.set(bytes, position); position += bytes.length;
    }
    verifySqliteSnapshot(await file.stat({ signal }), expected);
    const encoding = [undefined, 'utf-8', 'utf-16le', 'utf-16be'][new DataView(header.buffer).getUint32(56)];
    if (!encoding) throw new FsError('EIO', { path, message: 'Invalid SQLite text encoding' });
    async function matches(value: SqliteRecordValue | undefined, target: string): Promise<boolean> {
      if (!value || typeof value !== 'object' || value.type !== 'text') return false;
      const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
      let position = 0;
      for await (const bytes of value.bytes) {
        const text = decoder.decode(bytes, { stream: true });
        if (text !== target.slice(position, position + text.length)) return false;
        position += text.length;
      }
      const final = decoder.decode();
      return final === target.slice(position) && position + final.length === target.length;
    }
    let root: number | undefined;
    for await (const record of scanSqliteRecords(file, 1, signal)) {
      const row = await readSqliteValues(record, 5, signal);
      if (await matches(row[0], 'table') && await matches(row[1], 'schemas')) {
        if (typeof row[3] !== 'bigint' || row[3] < 1n || row[3] > BigInt(Number.MAX_SAFE_INTEGER)) throw new FsError('EIO', { path, message: 'Invalid SQLite schema root' });
        root = Number(row[3]); break;
      }
    }
    let result: Record<string, unknown> | undefined;
    if (root !== undefined) for await (const record of scanSqliteRecords(file, root, signal)) {
      const row = await readSqliteValues(record, 2, signal);
      if (!await matches(row[0], id)) continue;
      const content = row[1];
      if (!content || typeof content !== 'object' || content.type !== 'text') throw new Error('Invalid schema');
      if (content.size > maxBytes) throw new FsError('EFBIG', { path, message: 'LLM schema input byte limit exceeded' });
      const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
      let text = '';
      for await (const bytes of content.bytes) { options.admitBytes?.(bytes.length); text += decoder.decode(bytes, { stream: true }); }
      text += decoder.decode();
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new Error('Invalid schema'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid schema');
      result = value as Record<string, unknown>; break;
    }
    await checkpointed();
    verifySqliteSnapshot(await file.stat({ signal }), expected);
    signal.throwIfAborted();
    return result;
  } finally { await file.close(); }
}
