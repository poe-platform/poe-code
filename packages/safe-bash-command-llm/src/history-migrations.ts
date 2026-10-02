import type { PrivateSqliteSession } from './sqlite-session.js';
import { withSqliteStatement, type SqliteBinding, type SqliteColumn } from './sqlite-statement.js';
import { historyMigrationNames, historySchemaStatements } from './history-schema.js';

const own = (values: Record<string,string> | undefined, key: string): string | undefined => values && Object.hasOwn(values, key) ? values[key] : undefined;
const quote = (value: string): string => '"' + value.split('"').join('""') + '"';

/** Apply the pinned history migrations in the caller's private transaction.
 * Table rewrites remain native INSERT ... SELECT operations, so record payloads
 * never cross into JS. Only bounded catalog metadata is materialized. */
export async function migrateLlmHistorySchema(session: PrivateSqliteSession, signal: AbortSignal, appliedAt: string): Promise<void> {
  const query = async (sql: string, types: SqliteColumn[], bindings: SqliteBinding[] = []): Promise<SqliteBinding[][]> =>
    withSqliteStatement(session.module, { ...session, signal, sql }, async statement => {
      const rows: SqliteBinding[][] = [];
      let bytes = 0;
      for await (const row of statement.rows(bindings, types)) {
        bytes += row.reduce<number>((size, value) => size + (typeof value === 'string' ? new TextEncoder().encode(value).length : 8), 0);
        if (bytes > 65536) throw new RangeError('History migration catalog exceeds control budget');
        rows.push(row);
      }
      return rows;
    });
  const exists = async (table: string): Promise<boolean> => (await query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", ['text'], [table])).length > 0;
  const columns = (table: string) => query('SELECT name,type,"notnull",coalesce(dflt_value,\'\'),pk FROM pragma_table_info(?)', ['text','text','integer','text','integer'], [table]);
  const add = async (table: string, name: string, type: string): Promise<void> => {
    if (!(await columns(table)).some(row => row[0] === name)) await session.execute(`ALTER TABLE ${quote(table)} ADD COLUMN ${quote(name)} ${type}`);
  };
  const create = async (...names: string[]): Promise<void> => {
    for (const name of names) {
      const sql = historySchemaStatements.find(sql => sql.startsWith(`CREATE TABLE ${quote(name)} (`));
      if (!sql) throw new Error(`Unknown history table: ${name}`);
      await session.execute(sql);
    }
  };
  const transform = async (table: string, settings: {
    primary?: string[]; types?: Record<string,string>; order?: string[]; drop?: string[];
    rename?: Record<string,string>; foreign?: { from: string; table: string; to: string }[]; dropForeign?: string[];
  } = {}): Promise<void> => {
    const original = await columns(table);
    const retained = original.filter(row => !settings.drop?.includes(String(row[0])));
    const name = (row: SqliteBinding[]): string => own(settings.rename, String(row[0])) ?? String(row[0]);
    const ordered = [...(settings.order ?? []).flatMap(key => retained.filter(row => name(row) === key)), ...retained.filter(row => !settings.order?.includes(name(row)))];
    const primary = settings.primary ?? retained.filter(row => BigInt(row[4] as bigint) > 0n).sort((a,b) => Number((a[4] as bigint) - (b[4] as bigint))).map(name);
    if (settings.primary) for (const key of settings.primary) if (!ordered.some(row => name(row) === key)) ordered.unshift([key, 'INTEGER', 0n, '', 1n]);
    const foreign = await query('SELECT id,seq,"table","from",coalesce("to",\'\'),on_update,on_delete,match FROM pragma_foreign_key_list(?)', ['integer','integer','text','text','text','text','text','text'], [table]);
    const indexes = await query("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL", ['text'], [table]);
    const temp = `llm_migrate_${crypto.randomUUID().split('-').join('')}`;
    const definitions = ordered.map(row => {
      const column = name(row), type = own(settings.types, String(row[0])) ?? String(row[1]);
      return `${quote(column)} ${quote(type)}${primary.length === 1 && primary[0] === column ? ' PRIMARY KEY' : ''}${row[2] === 1n ? ' NOT NULL' : ''}${row[3] ? ` DEFAULT ${String(row[3])}` : ''}`;
    });
    if (primary.length > 1) definitions.push(`PRIMARY KEY (${primary.map(quote).join(',')})`);
    const groups = new Map<bigint, SqliteBinding[][]>();
    for (const row of foreign) {
      if (settings.dropForeign?.includes(String(row[3])) || settings.drop?.includes(String(row[3])) || settings.foreign?.some(fk => fk.from === row[3])) continue;
      const group = groups.get(row[0] as bigint) ?? []; group.push(row); groups.set(row[0] as bigint, group);
    }
    for (const group of groups.values()) {
      group.sort((a,b) => Number((a[1] as bigint) - (b[1] as bigint)));
      const first = group[0]!;
      definitions.push(`FOREIGN KEY (${group.map(row => quote(own(settings.rename, String(row[3])) ?? String(row[3]))).join(',')}) REFERENCES ${quote(String(first[2]))} (${group.map(row => quote(String(row[4]))).join(',')}) ON UPDATE ${String(first[5])} ON DELETE ${String(first[6])}`);
    }
    for (const fk of settings.foreign ?? []) definitions.push(`FOREIGN KEY (${quote(fk.from)}) REFERENCES ${quote(fk.table)} (${quote(fk.to)})`);
    await session.execute(`CREATE TABLE ${quote(temp)} (${definitions.join(',')})`);
    const source = retained.map(row => quote(String(row[0]))), destination = retained.map(row => quote(name(row)));
    await session.execute(`INSERT INTO ${quote(temp)} (rowid,${destination.join(',')}) SELECT rowid,${source.join(',')} FROM ${quote(table)}`);
    await session.execute(`DROP TABLE ${quote(table)}; ALTER TABLE ${quote(temp)} RENAME TO ${quote(table)}`);
    for (const row of indexes) await session.execute(String(row[0]));
  };
  const fts = async (): Promise<void> => {
    for (const sql of historySchemaStatements.filter(sql => sql.startsWith('CREATE VIRTUAL TABLE') || sql.startsWith('CREATE TRIGGER'))) await session.execute(sql);
    await session.execute("INSERT INTO responses_fts(responses_fts) VALUES ('rebuild')");
  };
  const migrations: Record<string, () => Promise<void>> = {
    async m001_initial() {
      if (await exists('log')) await add('log', 'chat_id', 'TEXT');
      else await session.execute('CREATE TABLE log(provider TEXT,system TEXT,prompt TEXT,chat_id TEXT,response TEXT,model TEXT,timestamp TEXT)');
    },
    m002_id_primary_key: () => transform('log', { primary: ['id'] }),
    m003_chat_id_foreign_key: () => transform('log', { types: { chat_id: 'INTEGER' }, foreign: [{ from: 'chat_id', table: 'log', to: 'id' }] }),
    m004_column_order: () => transform('log', { order: ['id','model','timestamp','prompt','system','response','chat_id'] }),
    m004_drop_provider: () => transform('log', { drop: ['provider'] }),
    async m005_debug() { await add('log','debug','TEXT'); await add('log','duration_ms','INTEGER'); },
    async m006_new_logs_table() {
      for (const column of ['options_json','prompt_json','response_json']) await add('log',column,'TEXT');
      await add('log','reply_to_id','INTEGER');
      await transform('log', { order: ['id','model','prompt','system','prompt_json','options_json','response','response_json','reply_to_id','chat_id','duration_ms','timestamp_utc'], rename: { timestamp: 'timestamp_utc', options: 'options_json' } });
    },
    async m007_finish_logs_table() {
      await transform('log', { drop: ['debug'], rename: { timestamp_utc: 'datetime_utc' }, dropForeign: ['chat_id'] });
      await session.execute('ALTER TABLE log RENAME TO logs');
    },
    m008_reply_to_id_foreign_key: () => transform('logs', { foreign: [{ from: 'reply_to_id', table: 'logs', to: 'id' }] }),
    m008_fix_column_order_in_logs: () => transform('logs', { order: ['id','model','prompt','system','prompt_json','options_json','response','response_json','reply_to_id','chat_id','duration_ms','timestamp_utc'] }),
    async m009_delete_logs_table_if_empty() {
      if (!(await query('SELECT 1 FROM logs LIMIT 1', ['integer'])).length) await session.execute('DROP TABLE logs');
    },
    m010_create_new_log_tables: () => create('conversations','responses'),
    m011_fts_for_responses: fts,
    m012_attachments_tables: () => create('attachments','prompt_attachments'),
    async m013_usage() { await add('responses','input_tokens','INTEGER'); await add('responses','output_tokens','INTEGER'); await add('responses','token_details','TEXT'); },
    async m014_schemas() { await create('schemas'); await add('responses','schema_id','TEXT REFERENCES schemas(id)'); },
    async m015_fragments_tables() {
      await create('fragments','fragment_aliases','prompt_fragments','system_fragments');
      await session.execute('CREATE UNIQUE INDEX idx_fragments_hash ON fragments(hash)');
    },
    async m016_fragments_table_pks() {
      for (const table of ['prompt_fragments','system_fragments']) await transform(table, { primary: ['response_id','fragment_id','order'] });
    },
    async m017_tools_tables() { await create('tools','tool_responses','tool_calls','tool_results'); await session.execute('CREATE UNIQUE INDEX idx_tools_hash ON tools(hash)'); },
    m017_tools_plugin: () => add('tools','plugin','TEXT'),
    async m018_tool_instances() { await create('tool_instances'); await add('tool_results','instance_id','INTEGER REFERENCES tool_instances(id)'); },
    m019_resolved_model: () => add('responses','resolved_model','TEXT'),
    m020_tool_results_attachments: () => create('tool_results_attachments'),
    m021_tool_results_exception: () => add('tool_results','exception','TEXT'),
  };
  await session.execute('SAVEPOINT llm_history_migrations');
  try {
    if (!await exists('_llm_migrations')) await create('_llm_migrations');
    const applied = new Set((await query('SELECT name FROM _llm_migrations', ['text'])).map(row => row[0]));
    for (const name of historyMigrationNames) {
      signal.throwIfAborted();
      if (applied.has(name)) continue;
      await migrations[name]!();
      await query('INSERT INTO _llm_migrations(name,applied_at) VALUES (?,?)', [], [name, appliedAt]);
    }
    await session.execute('RELEASE llm_history_migrations');
  } catch (error) {
    try { await session.execute('ROLLBACK TO llm_history_migrations; RELEASE llm_history_migrations'); }
    catch (rollback) { throw new AggregateError([error, rollback], 'History migration and rollback failed'); }
    throw error;
  }
}
