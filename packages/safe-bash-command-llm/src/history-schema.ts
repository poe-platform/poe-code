import type {PrivateSqliteSession} from './sqlite-session.js';
import {withSqliteStatement} from './sqlite-statement.js';
// Fresh history database catalog from Simon Willison llm 0.27.1.
export const historySchemaStatements = [
  "CREATE TABLE \"_llm_migrations\" (\n   \"name\" TEXT PRIMARY KEY,\n   \"applied_at\" TEXT\n)",
  "CREATE TABLE \"conversations\" (\n   \"id\" TEXT PRIMARY KEY,\n   \"name\" TEXT,\n   \"model\" TEXT\n)",
  "CREATE TABLE \"attachments\" (\n   \"id\" TEXT PRIMARY KEY,\n   \"type\" TEXT,\n   \"path\" TEXT,\n   \"url\" TEXT,\n   \"content\" BLOB\n)",
  "CREATE TABLE \"prompt_attachments\" (\n   \"response_id\" TEXT REFERENCES \"responses\"(\"id\"),\n   \"attachment_id\" TEXT REFERENCES \"attachments\"(\"id\"),\n   \"order\" INTEGER,\n   PRIMARY KEY (\"response_id\", \"attachment_id\")\n)",
  "CREATE TABLE \"schemas\" (\n   \"id\" TEXT PRIMARY KEY,\n   \"content\" TEXT\n)",
  "CREATE TABLE \"responses\" (\n   \"id\" TEXT PRIMARY KEY,\n   \"model\" TEXT,\n   \"prompt\" TEXT,\n   \"system\" TEXT,\n   \"prompt_json\" TEXT,\n   \"options_json\" TEXT,\n   \"response\" TEXT,\n   \"response_json\" TEXT,\n   \"conversation_id\" TEXT REFERENCES \"conversations\"(\"id\"),\n   \"duration_ms\" INTEGER,\n   \"datetime_utc\" TEXT,\n   \"input_tokens\" INTEGER,\n   \"output_tokens\" INTEGER,\n   \"token_details\" TEXT,\n   \"schema_id\" TEXT REFERENCES \"schemas\"(\"id\")\n, \"resolved_model\" TEXT)",
  "CREATE TABLE \"fragments\" (\n   \"id\" INTEGER PRIMARY KEY,\n   \"hash\" TEXT,\n   \"content\" TEXT,\n   \"datetime_utc\" TEXT,\n   \"source\" TEXT\n)",
  "CREATE TABLE \"fragment_aliases\" (\n   \"alias\" TEXT PRIMARY KEY,\n   \"fragment_id\" INTEGER REFERENCES \"fragments\"(\"id\")\n)",
  "CREATE TABLE \"prompt_fragments\" (\n   \"response_id\" TEXT REFERENCES \"responses\"(\"id\"),\n   \"fragment_id\" INTEGER REFERENCES \"fragments\"(\"id\"),\n   \"order\" INTEGER,\n   PRIMARY KEY (\"response_id\", \"fragment_id\", \"order\")\n)",
  "CREATE TABLE \"system_fragments\" (\n   \"response_id\" TEXT REFERENCES \"responses\"(\"id\"),\n   \"fragment_id\" INTEGER REFERENCES \"fragments\"(\"id\"),\n   \"order\" INTEGER,\n   PRIMARY KEY (\"response_id\", \"fragment_id\", \"order\")\n)",
  "CREATE TABLE \"tools\" (\n   \"id\" INTEGER PRIMARY KEY,\n   \"hash\" TEXT,\n   \"name\" TEXT,\n   \"description\" TEXT,\n   \"input_schema\" TEXT\n, \"plugin\" TEXT)",
  "CREATE TABLE \"tool_responses\" (\n   \"tool_id\" INTEGER REFERENCES \"tools\"(\"id\"),\n   \"response_id\" TEXT REFERENCES \"responses\"(\"id\"),\n   PRIMARY KEY (\"tool_id\", \"response_id\")\n)",
  "CREATE TABLE \"tool_calls\" (\n   \"id\" INTEGER PRIMARY KEY,\n   \"response_id\" TEXT REFERENCES \"responses\"(\"id\"),\n   \"tool_id\" INTEGER REFERENCES \"tools\"(\"id\"),\n   \"name\" TEXT,\n   \"arguments\" TEXT,\n   \"tool_call_id\" TEXT\n)",
  "CREATE TABLE \"tool_instances\" (\n   \"id\" INTEGER PRIMARY KEY,\n   \"plugin\" TEXT,\n   \"name\" TEXT,\n   \"arguments\" TEXT\n)",
  "CREATE TABLE \"tool_results\" (\n   \"id\" INTEGER PRIMARY KEY,\n   \"response_id\" TEXT REFERENCES \"responses\"(\"id\"),\n   \"tool_id\" INTEGER REFERENCES \"tools\"(\"id\"),\n   \"name\" TEXT,\n   \"output\" TEXT,\n   \"tool_call_id\" TEXT,\n   \"instance_id\" INTEGER REFERENCES \"tool_instances\"(\"id\")\n, \"exception\" TEXT)",
  "CREATE UNIQUE INDEX \"idx_fragments_hash\"\n    ON \"fragments\" (\"hash\")",
  "CREATE UNIQUE INDEX \"idx_tools_hash\"\n    ON \"tools\" (\"hash\")",
  "CREATE VIRTUAL TABLE \"responses_fts\" USING FTS5 (\n    \"prompt\", \"response\",\n    content=\"responses\"\n)",
  "CREATE TRIGGER \"responses_ai\" AFTER INSERT ON \"responses\" BEGIN\n  INSERT INTO \"responses_fts\" (rowid, \"prompt\", \"response\") VALUES (new.rowid, new.\"prompt\", new.\"response\");\nEND",
  "CREATE TRIGGER \"responses_ad\" AFTER DELETE ON \"responses\" BEGIN\n  INSERT INTO \"responses_fts\" (\"responses_fts\", rowid, \"prompt\", \"response\") VALUES('delete', old.rowid, old.\"prompt\", old.\"response\");\nEND",
  "CREATE TRIGGER \"responses_au\" AFTER UPDATE ON \"responses\" BEGIN\n  INSERT INTO \"responses_fts\" (\"responses_fts\", rowid, \"prompt\", \"response\") VALUES('delete', old.rowid, old.\"prompt\", old.\"response\");\n  INSERT INTO \"responses_fts\" (rowid, \"prompt\", \"response\") VALUES (new.rowid, new.\"prompt\", new.\"response\");\nEND",
  "CREATE TABLE \"tool_results_attachments\" (\n   \"tool_result_id\" INTEGER REFERENCES \"tool_results\"(\"id\"),\n   \"attachment_id\" TEXT REFERENCES \"attachments\"(\"id\"),\n   \"order\" INTEGER,\n   PRIMARY KEY (\"tool_result_id\", \"attachment_id\")\n)"
];
export const historyMigrationNames = [
  "m001_initial",
  "m002_id_primary_key",
  "m003_chat_id_foreign_key",
  "m004_column_order",
  "m004_drop_provider",
  "m005_debug",
  "m006_new_logs_table",
  "m007_finish_logs_table",
  "m008_reply_to_id_foreign_key",
  "m008_fix_column_order_in_logs",
  "m009_delete_logs_table_if_empty",
  "m010_create_new_log_tables",
  "m011_fts_for_responses",
  "m012_attachments_tables",
  "m013_usage",
  "m014_schemas",
  "m015_fragments_tables",
  "m016_fragments_table_pks",
  "m017_tools_tables",
  "m017_tools_plugin",
  "m018_tool_instances",
  "m019_resolved_model",
  "m020_tool_results_attachments",
  "m021_tool_results_exception"
];
/** Initialize an empty private history database. Existing databases require
 * migration before use; an error leaves this transaction uncommitted. */
export async function createLlmHistorySchema(session: PrivateSqliteSession, signal: AbortSignal, appliedAt: string): Promise<void> {
  signal.throwIfAborted();
  await session.execute('SAVEPOINT llm_history_schema');
  try {
    for (const sql of historySchemaStatements) { signal.throwIfAborted(); await session.execute(sql); }
    await withSqliteStatement(session.module, {...session, signal, sql: 'INSERT INTO _llm_migrations(name, applied_at) VALUES (?, ?)'}, async insert => {
      for (const name of historyMigrationNames) for await (const ignoredRow of insert.rows([name, appliedAt], [])) { /* Execute each migration marker. */ }
    });
    await session.execute('RELEASE llm_history_schema');
  } catch (error) {
    try { await session.execute('ROLLBACK TO llm_history_schema; RELEASE llm_history_schema'); }
    catch (rollback) { throw new AggregateError([error, rollback], 'History schema initialization and rollback failed'); }
    throw error;
  }
}
