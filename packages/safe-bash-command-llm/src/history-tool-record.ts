import {digest} from 'safe-bash-checksum-engine';
import {toByteSource,type ByteSource} from 'safe-bash-contracts';
import {yieldTurn} from 'safe-bash-contracts/yield';
import type {PrivateSqliteSession} from './sqlite-session.js';
import type {SqliteFinalizer} from './sqlite-finalization.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {sqliteRecord} from './sqlite-record.js';
import {sqliteSchemaTokens} from './sqlite-schema-tokens.js';
import {historySchemaStatements} from './history-schema.js';
import {schemaJsonChunks,pythonJsonStringChunks} from './schema-json.js';

export interface LlmHistoryTool {
 readonly name:string;
 readonly description?:string|null;
 /** Admitted control JSON, retaining original key order and number spellings. */
 readonly inputSchemaJson:string;
 readonly plugin?:string|null;
}

/** Native tool deduplication follows llm.Tool.hash()/ensure_tool. Tool metadata
 * is admitted control data; Python's expanded ASCII schema stays streamed. */
export async function prepareLlmToolRecord(session:PrivateSqliteSession,tool:LlmHistoryTool,signal:AbortSignal):Promise<{id:bigint;hash:string;finalize?:(editor:SqliteFinalizer)=>Promise<void>}>{
 const {name,description=null,inputSchemaJson,plugin=null}=tool;
 const encoder=new TextEncoder();
 const jsonBytes=(json:string):ByteSource=>({async *[Symbol.asyncIterator](){
  for await(const chunk of schemaJsonChunks(json,signal,{indent:null,trailingNewline:false}))yield encoder.encode(chunk);
 }});
 const identity:ByteSource={async *[Symbol.asyncIterator](){
  yield encoder.encode('{"name": ');
  for(const chunk of pythonJsonStringChunks(name,signal)){await yieldTurn(signal);yield encoder.encode(chunk);}
  yield encoder.encode(', "description": ');
  if(description===null)yield encoder.encode('null');
  else for(const chunk of pythonJsonStringChunks(description,signal)){await yieldTurn(signal);yield encoder.encode(chunk);}
  yield encoder.encode(', "input_schema": ');
  yield* jsonBytes(inputSchemaJson);
  if(plugin){
   yield encoder.encode(', "plugin": ');
   for(const chunk of pythonJsonStringChunks(plugin,signal)){await yieldTurn(signal);yield encoder.encode(chunk);}
  }
  yield encoder.encode('}');
 }};
 const {hex:hash}=await digest(identity,'sha256',signal);
 const raw=(value:string):ByteSource=>({async *[Symbol.asyncIterator](){
  for(let start=0;start<value.length;){
   await yieldTurn(signal);let end=Math.min(start+4096,value.length);
   const last=value.charCodeAt(end-1);
   if(end<value.length&&last>=0xd800&&last<=0xdbff)end--;
   for(let index=start;index<end;index++){
    const code=value.charCodeAt(index);
    if(code>=0xd800&&code<=0xdbff){
     const low=value.charCodeAt(++index);
     if(!(low>=0xdc00&&low<=0xdfff))throw new TypeError('Invalid Unicode in tool metadata');
    }else if(code>=0xdc00&&code<=0xdfff)throw new TypeError('Invalid Unicode in tool metadata');
   }
   yield encoder.encode(value.slice(start,end));start=end;
  }
 }});
 const fields=[()=>raw(name),description===null?null:()=>raw(description),()=>jsonBytes(inputSchemaJson),plugin===null?null:()=>raw(plugin)];
 const sizes:(number|null)[]=[];
 for(const source of fields){
  if(!source){sizes.push(null);continue;}
  let size=0;for await(const chunk of source()){size+=chunk.length;if(size>0x7fffffff)throw new RangeError('Tool metadata exceeds native storage');}
  sizes.push(size);
 }
 let rootPage=0,index=false;
 await withSqliteStatement(session.module,{...session,signal,sql:"SELECT type,COALESCE(sql,''),rootpage FROM sqlite_schema WHERE tbl_name='tools'"},async q=>{
  for await(const [type,sql,page]of q.rows([],['text','text','integer'])){
   if(type==='table'){
    if(sqliteSchemaTokens(sql as string)!==sqliteSchemaTokens(historySchemaStatements.find(value=>value.startsWith('CREATE TABLE "tools"'))!))throw new Error('Tool streaming requires the pinned table definition');
    rootPage=Number(page);
   }else if(type==='index'&&sqliteSchemaTokens(sql as string)===sqliteSchemaTokens(historySchemaStatements.find(value=>value.startsWith('CREATE UNIQUE INDEX "idx_tools_hash"'))!))index=true;
   else throw new Error('Tool streaming requires index/trigger-aware custom-schema handling');
  }
 });
 if(!rootPage||!index)throw new Error('Missing history tool table or hash index');
 await withSqliteStatement(session.module,{...session,signal,sql:'PRAGMA encoding'},async q=>{for await(const row of q.rows([],['text']))if(row[0]!=='UTF-8')throw new Error('Tool streaming requires UTF-8 storage');});
 let id:bigint|undefined;
 const placeholders=sizes.map(size=>size===null?'NULL':'zeroblob(?)');
 await withSqliteStatement(session.module,{...session,signal,sql:`INSERT INTO tools(hash,name,description,input_schema,plugin) VALUES(?,${placeholders.join(',')}) ON CONFLICT(hash) DO NOTHING RETURNING id`},async insert=>{
  for await(const row of insert.rows([hash,...sizes.filter(size=>size!==null).map(BigInt)],['integer']))id=row[0] as bigint;
 });
 if(id===undefined){
  await withSqliteStatement(session.module,{...session,signal,sql:'SELECT id FROM tools WHERE hash=?'},async q=>{for await(const row of q.rows([hash],['integer']))id=row[0] as bigint;});
  if(id===undefined)throw new Error('Missing deduplicated tool');
  return {id,hash};
 }
 const rowid=id,record=sqliteRecord([null,{type:'text',size:64,bytes:toByteSource(hash)},...fields.map((source,i)=>source?{type:'text' as const,size:sizes[i]!,bytes:source()}:null)]);
 return {id,hash,finalize:editor=>editor.rewriteRecord({rootPage,rowid,record})};
}
