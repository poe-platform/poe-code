import {toByteSource, type ByteSource} from 'safe-bash-contracts';
import type {PrivateSqliteSession} from './sqlite-session.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
import {withSqliteStatement, type SqliteBinding} from './sqlite-statement.js';
import {sqliteRecord, type SqliteRecordValue} from './sqlite-record.js';
import {readSqliteBlob} from './sqlite-blob-read.js';
import {installSqliteFtsDocuments} from './sqlite-fts-install.js';
import {historySchemaStatements} from './history-schema.js';

const columns=['id','model','prompt','system','prompt_json','options_json','response','response_json','conversation_id','duration_ms','datetime_utc','input_tokens','output_tokens','token_details','schema_id','resolved_model'] as const;
type Column=typeof columns[number];
interface TextSource {readonly size:number;readonly bytes:ByteSource}
/** Already serialized reference values. Related conversations, schemas,
 * fragments, attachments and tools belong to the surrounding transaction. */
export type LlmResponseRecord={readonly id:string;readonly model:string}&Partial<Record<Exclude<Column,'id'|'model'>,string|bigint|null|TextSource>>;

// SQLite preserves identifier quoting and ALTER TABLE whitespace in catalogs.
// Compare lexical tokens, retaining literal values and all constraint syntax.
function schemaTokens(sql:string):string {
 const tokens:string[]=[];
 for(let i=0;i<sql.length;){
  const ch=sql[i]!;
  if(' \t\r\n\f'.includes(ch)){i++;continue;}
  if(ch==='"'||ch==='['||ch==='`'||ch==="'"){
   const end=ch==='['?']':ch;let value='',closed=false;i++;
   while(i<sql.length){const next=sql[i++]!;if(next===end){if(end!==']'&&sql[i]===end){value+=end;i++;continue;}closed=true;break;}value+=next;}
   if(!closed)throw new Error('Invalid history schema quoting');
   tokens.push(ch==="'"?'literal:'+value:'word:'+value.toLowerCase());continue;
  }
  const word=(c:string):boolean=>c>='a'&&c<='z'||c>='A'&&c<='Z'||c>='0'&&c<='9'||c==='_';
  if(word(ch)){let value='';while(i<sql.length&&word(sql[i]!))value+=sql[i++];tokens.push('word:'+value.toLowerCase());}
  else{tokens.push(ch);i++;}
 }
 return JSON.stringify(tokens);
}

/** Internal writer for the pinned history schema. Native INSERT owns rowid,
 * primary-key and foreign-key validation. Large unindexed TEXT uses zeroblob
 * placeholders followed by a closed-file serial-type rewrite and streamed FTS
 * installation. Always run the returned finalizer before publishing. */
export async function prepareLlmResponseRecord(session:PrivateSqliteSession,input:LlmResponseRecord,signal:AbortSignal):Promise<(editor:SqliteFinalizer)=>Promise<void>>{
 const values=columns.map(name=>input[name]??null);
 const bindings:SqliteBinding[]=[],expressions:string[]=[],recordValues:SqliteRecordValue[]=[];
 for(let i=0;i<values.length;i++){
  const value=values[i]!;
  const numeric=['duration_ms','input_tokens','output_tokens'].includes(columns[i]!);
  if(value!==null&&(numeric?typeof value!=='bigint':typeof value!=='string'&&typeof value!=='object'))throw new TypeError('Invalid history field type');
  if(value!==null&&typeof value==='object'){
   if(['id','model','conversation_id','schema_id'].includes(columns[i]!))throw new TypeError('Indexed history controls must be scalar');
   if(!Number.isSafeInteger(value.size)||value.size<0)throw new RangeError('Invalid history text size');
   expressions.push('zeroblob(?)');bindings.push(BigInt(value.size));recordValues.push({type:'text',size:value.size,bytes:value.bytes});
  }else{
   expressions.push('?');bindings.push(value);
   if(typeof value==='string'){const bytes=new TextEncoder().encode(value);recordValues.push({type:'text',size:bytes.length,bytes:toByteSource(bytes)});}
   else recordValues.push(value);
  }
 }
 // Rewriting a physical record must never silently bypass user-added indexes,
 // columns or triggers. Broader schemas need their own index-aware writer.
 const names:string[]=[];
 await withSqliteStatement(session.module,{...session,signal,sql:"SELECT name FROM pragma_table_info('responses') ORDER BY cid"},async q=>{for await(const row of q.rows([],['text']))names.push(row[0] as string);});
 if(names.join('\0')!==columns.join('\0'))throw new Error('History response record requires the pinned column layout');
 let rootPage=0,insertTrigger='';
 const triggers=historySchemaStatements.filter(sql=>sql.startsWith('CREATE TRIGGER')).map(schemaTokens);
 let triggerCount=0;
 await withSqliteStatement(session.module,{...session,signal,sql:"SELECT type,name,COALESCE(sql,''),rootpage FROM sqlite_schema WHERE tbl_name='responses'"},async q=>{
  for await(const [type,name,sql,root]of q.rows([],['text','text','text','integer'])){
   if(type==='table'){
    if(schemaTokens(sql as string)!==schemaTokens(historySchemaStatements.find(statement=>statement.startsWith('CREATE TABLE "responses"'))!))throw new Error('History response record requires the pinned table definition');
    rootPage=Number(root);
   }
   if(type==='index'&&sql!=='')throw new Error('History response record requires index-aware custom-schema handling');
   if(type==='trigger'){
    if(!triggers.includes(schemaTokens(sql as string)))throw new Error('History response record requires trigger-aware custom-schema handling');
    triggerCount++;if(name==='responses_ai')insertTrigger=sql as string;
   }
  }
 });
 if(!rootPage||!insertTrigger||triggerCount!==3)throw new Error('History response triggers are incomplete');
 let nativeFts=false;
 await withSqliteStatement(session.module,{...session,signal,sql:"SELECT sql FROM sqlite_schema WHERE name='responses_fts' AND type='table'"},async q=>{
  for await(const row of q.rows([],['text']))nativeFts=schemaTokens(row[0] as string)===schemaTokens(historySchemaStatements.find(sql=>sql.startsWith('CREATE VIRTUAL TABLE'))!);
 });
 if(!nativeFts)throw new Error('History response record requires the pinned FTS definition');
 await withSqliteStatement(session.module,{...session,signal,sql:'PRAGMA encoding'},async q=>{for await(const row of q.rows([],['text']))if(row[0]!=='UTF-8')throw new Error('History response record requires UTF-8 storage');});
 const record=sqliteRecord(recordValues);
 // The outer canonical transaction owns rollback, including any failed phase.
 let rowid!:bigint;
 await session.execute('SAVEPOINT llm_response_record');
 try{
 await session.execute('DROP TRIGGER responses_ai');
 await withSqliteStatement(session.module,{...session,signal,sql:`INSERT INTO responses(${columns.map(name=>'"'+name+'"').join(',')}) VALUES(${expressions.join(',')}) RETURNING rowid`},async q=>{
  for await(const row of q.rows(bindings,['integer']))rowid=row[0] as bigint;
 });
 await session.execute(insertTrigger);
 await session.execute('RELEASE llm_response_record');
 }catch(error){
  try{await session.execute('ROLLBACK TO llm_response_record; RELEASE llm_response_record');}catch(cleanup){throw new AggregateError([error,cleanup],'History response insertion and rollback failed');}
  throw error;
 }
 return async editor=>{
  await editor.rewriteRecord({rootPage,rowid,record});
  await editor.withSession(async native=>{
   const source=(column:string):ByteSource=>readSqliteBlob(native.module,{...native,signal,table:'responses',column,rowid});
   // NULL fields have no incremental blob handle and contribute no terms.
   await installSqliteFtsDocuments(native,{table:'responses_fts',columns:2,signal,documents:(async function*(){
    yield {rowid,columns:[values[2]===null?toByteSource(''):source('prompt'),values[6]===null?toByteSource(''):source('response')]};
   })()});
  });
 };
}
