import {FsError, type FileSystem} from 'safe-bash-contracts';
import {transactSqlite,withSqliteStatement,type PrivateSqliteSession,type SqliteFinalizer} from 'safe-bash-sqlite-engine/storage';
import {migrateLlmCollections} from './collections-migrations.js';
import {embedCollection, type LlmCollectionEmbedOptions} from './collections-embed.js';
import {embedCollectionBatch,type LlmCollectionBatchOptions} from './collections-batch.js';
export type {LlmCollectionBatchEntry,LlmCollectionBatchOptions} from './collections-batch.js';
export type {LlmCollectionEmbedOptions} from './collections-embed.js';
import {similarCollection,type LlmCollectionSimilarOptions,type LlmCollectionSimilarity} from './collections-similarity.js';
export type {LlmCollectionSimilarOptions,LlmCollectionSimilarity,LlmCollectionField} from './collections-similarity.js';
import {LlmCollectionDoesNotExist} from './collections-errors.js';
export {LlmCollectionDoesNotExist} from './collections-errors.js';
export {createLlmCollectionCommands} from './collections-command.js';
export {withCsvEmbeddingEntries} from './import-csv.js';
export type {LlmCollectionCommands} from './collections-command-types.js';
import {sourceBytes} from './request-source.js';

export interface LlmCollectionSearchOptions extends LlmCollectionSimilarOptions {
 readonly service:LlmCollectionEmbedOptions['service'];
 readonly input:LlmCollectionEmbedOptions['input'];
 readonly maxInputBytes:number;
 readonly binary?:boolean;
}

export interface LlmCollection {readonly id:bigint;readonly name:string;readonly model:string}
export interface LlmCollectionCatalog {
 collection(name:string,options?:{readonly model?:string;readonly create?:boolean}):Promise<LlmCollection>;
 exists(name:string):Promise<boolean>;
 list(visit:(collection:LlmCollection & {readonly count:bigint})=>void|Promise<void>):Promise<void>;
 delete(name:string):Promise<void>;
 embed(name:string,id:string,options:LlmCollectionEmbedOptions):Promise<void>;
 embedMany(name:string,options:LlmCollectionBatchOptions):Promise<void>;
 similarByVector(name:string,vector:readonly number[],options:LlmCollectionSimilarOptions,visit:(entry:LlmCollectionSimilarity)=>void|Promise<void>):Promise<void>;
 similarById(name:string,id:string,options:LlmCollectionSimilarOptions,visit:(entry:LlmCollectionSimilarity)=>void|Promise<void>):Promise<void>;
 similar(name:string,options:LlmCollectionSearchOptions,visit:(entry:LlmCollectionSimilarity)=>void|Promise<void>):Promise<void>;
}
const migrations=['m001_create_tables','m002_foreign_key','m003_add_updated','m004_store_content_hash','m005_add_content_blob'];
const schema=[
 'CREATE TABLE [_sqlite_migrations] ([migration_set] TEXT,[name] TEXT,[applied_at] TEXT,PRIMARY KEY ([migration_set],[name]))',
 'CREATE TABLE [collections] ([id] INTEGER PRIMARY KEY,[name] TEXT,[model] TEXT)',
 'CREATE UNIQUE INDEX [idx_collections_name] ON [collections] ([name])',
 'CREATE TABLE "embeddings" ([collection_id] INTEGER REFERENCES [collections]([id]),[id] TEXT,[embedding] BLOB,[content] TEXT,[content_blob] BLOB,[content_hash] BLOB,[metadata] TEXT,[updated] INTEGER,PRIMARY KEY ([collection_id],[id]))',
 'CREATE INDEX [idx_embeddings_content_hash] ON [embeddings] ([content_hash])',
];

async function initialize(session:PrivateSqliteSession,signal:AbortSignal,now:()=>Date,create:boolean):Promise<((editor:SqliteFinalizer)=>Promise<void>)|undefined>{
 const tables:string[]=[];
 await withSqliteStatement(session.module,{...session,signal,sql:"SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('collections','embeddings')"},async query=>{
  for await(const [name]of query.rows([],['text']))tables.push(name as string);
 });
 if(!tables.length){
  if(!create)throw new FsError('ENOENT',{message:'Embedding collection database does not exist'});
  // An unrelated database may already use sqlite-migrate's shared ledger.
  await session.execute(schema[0]!.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
  for(const statement of schema.slice(1))await session.execute(statement);
  const timestamp=now().toISOString().replace('T',' ').replace('Z','000+00:00');
  await withSqliteStatement(session.module,{...session,signal,sql:'INSERT INTO _sqlite_migrations(migration_set,name,applied_at) VALUES (?,?,?)'},async query=>{
   for(const name of migrations)for await(const row of query.rows(['llm.embeddings',name,timestamp],[]))void row;
  });
 }else{
  const columns:string[]=[];
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT name FROM pragma_table_info('embeddings') ORDER BY cid"},async query=>{
   for await(const [name]of query.rows([],['text']))columns.push(name as string);
  });
  if(tables.length!==2)throw new Error('Incomplete embedding database schema');
  if(columns.join(',')!=='collection_id,id,embedding,content,content_blob,content_hash,metadata,updated')return migrateLlmCollections(session,signal,now,columns,schema[3]!,migrations);
 }
 return undefined;
}

/** Callback-scoped collection catalog over the caller's retained SQLite storage.
 * Model IDs are canonical provider IDs supplied by the host. Any operation error
 * aborts publication, including errors caught inside the callback. */
export async function withLlmCollections<T>(options:{
 readonly fs:FileSystem;readonly path:string;readonly signal:AbortSignal;
 readonly maxFileBytes:number;readonly maxIndexBytes:number;readonly maxOpenFiles:number;
 readonly now:()=>Date;
 readonly create?:boolean;
},operation:(catalog:LlmCollectionCatalog)=>Promise<T>){
 const {signal}=options;
 const execute=async(editor:SqliteFinalizer):Promise<T>=>{
  let active=true,pending:Promise<unknown>|undefined,failed=false,failure:unknown;
  const run=<V>(action:()=>Promise<V>):Promise<V>=>{
   if(!active)return Promise.reject(new FsError('EBADF',{message:'Collection catalog is closed'}));
   if(pending){failed=true;failure=new FsError('EBUSY',{message:'Collection operations must be serialized'});return Promise.reject(failure);}
   if(failed)return Promise.reject(failure);
   const task=Promise.resolve().then(()=>{signal.throwIfAborted();return action();});
   pending=task;
   void task.then(()=>{pending=undefined;},error=>{pending=undefined;failed=true;failure=error;});
   return task;
  };
  const native=<V>(action:(session:PrivateSqliteSession)=>Promise<V>)=>run(async()=>{
   const result=await editor.withSession(async session=>{
    try{return {ok:true as const,value:await action(session)};}catch(error){return {ok:false as const,error};}
   });
   if(!result.ok)throw result.error;return result.value;
  });
  const lookup=async(session:PrivateSqliteSession,name:string):Promise<LlmCollection|undefined>=>{
   if(typeof name!=='string')throw new TypeError('Collection name must be a string');
   return withSqliteStatement(session.module,{...session,signal,sql:'SELECT id,name,model FROM collections WHERE name=?'},async query=>{
    for await(const [id,storedName,model]of query.rows([name],['integer','text','text']))return {id:id as bigint,name:storedName as string,model:model as string};
    return undefined;
   });
  };
  const catalog:LlmCollectionCatalog={
   exists(name){return native(async session=>Boolean(await lookup(session,name)));},
   collection(name,settings={}){return native(async session=>{
    const existing=await lookup(session,name);if(existing)return existing;
    if(settings.create===false)throw new LlmCollectionDoesNotExist(name);
    if(settings.model===undefined)throw new Error('Either model= or model_id= must be provided when creating a new collection');
    if(typeof settings.model!=='string')throw new TypeError('Collection model must be a string');
    return withSqliteStatement(session.module,{...session,signal,sql:'INSERT INTO collections(name,model) VALUES (?,?) RETURNING id'},async query=>{
     for await(const [id]of query.rows([name,settings.model!],['integer']))return {id:id as bigint,name,model:settings.model!};
     throw new Error('Collection insertion returned no ID');
    });
   });},
   list(visit){return native(async session=>{
    await withSqliteStatement(session.module,{...session,signal,sql:'SELECT id,name,model,(SELECT count(id) FROM embeddings WHERE collection_id=collections.id) FROM collections ORDER BY name,model'},async query=>{
     for await(const [id,name,model,count]of query.rows([],['integer','text','text','integer']))await visit({id:id as bigint,name:name as string,model:model as string,count:count as bigint});
    });
   });},
   delete(name){return native(async session=>{
    const existing=await lookup(session,name);if(!existing)throw new LlmCollectionDoesNotExist(name);
    for(const sql of ['DELETE FROM embeddings WHERE collection_id=?','DELETE FROM collections WHERE id=?'])await withSqliteStatement(session.module,{...session,signal,sql},async query=>{
     for await(const row of query.rows([existing.id],[]))void row;
    });
   });},
   embed(name,id,settings){let transferred=false;return run(async()=>{
    const collection=await editor.withSession(session=>lookup(session,name));
    if(!collection)throw new LlmCollectionDoesNotExist(name);
    transferred=true;
    await embedCollection(editor,{...options,...settings,collection,id});
   }).catch(async error=>{if(!transferred)await settings.input.dispose().catch(()=>undefined);throw error;});},
   embedMany(name,settings){return run(async()=>{
    const collection=await editor.withSession(session=>lookup(session,name));
    if(!collection)throw new LlmCollectionDoesNotExist(name);
    await embedCollectionBatch(editor,{...options,...settings,collection});
   });},
   similarByVector(name,vector,settings,visit){return run(async()=>{
    const collection=await editor.withSession(session=>lookup(session,name));
    if(!collection)throw new LlmCollectionDoesNotExist(name);
    await similarCollection(editor,{collectionId:collection.id,signal,query:{vector},settings,visit});
   });},
   similarById(name,id,settings,visit){return run(async()=>{
    const collection=await editor.withSession(session=>lookup(session,name));
    if(!collection)throw new LlmCollectionDoesNotExist(name);
    await similarCollection(editor,{collectionId:collection.id,signal,query:{id},settings,visit});
   });},
   similar(name,settings,visit){
    let closing:Promise<void>|undefined,failed=false,entered=false;
    const dispose=()=>closing??=Promise.resolve().then(()=>settings.input.dispose());
    return run(async()=>{
     entered=true;
     try{
     const collection=await editor.withSession(session=>lookup(session,name));
     if(!collection)throw new LlmCollectionDoesNotExist(name);
     if(!settings.service.embedSources)throw new Error('LLM service does not support streamed embeddings');
     if(settings.maxInputBytes!==Infinity&&(!Number.isSafeInteger(settings.maxInputBytes)||settings.maxInputBytes<0))throw new RangeError('Invalid embedding input byte limit');
     let borrowed=true;
     const input={dispose,bytes:{async *[Symbol.asyncIterator](){
      if(!borrowed||closing)throw new FsError('EBADF',{message:'Similarity source lease is closed'});
      const decoder=settings.binary?undefined:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});let size=0;
      for await(const chunk of sourceBytes(settings.input.bytes,signal)){
       if(chunk.length>settings.maxInputBytes-size)throw new RangeError('Embedding input byte limit exceeded');size+=chunk.length;
       for(let offset=0;offset<chunk.length;offset+=16384){
        if(!borrowed||closing)throw new FsError('EBADF',{message:'Similarity source lease is closed'});
        const bytes=chunk.subarray(offset,offset+16384);decoder?.decode(bytes,{stream:true});yield bytes;
       }
      }
      decoder?.decode();
     }}};
     const response=await settings.service.embedSources({model:collection.model,inputs:[input],options:{},signal,...(settings.binary===undefined?{}:{binary:settings.binary})}).finally(()=>{borrowed=false;});
     if(response.vectors.length!==1||!response.vectors[0])throw new TypeError('Invalid embedding response');
     await similarCollection(editor,{collectionId:collection.id,signal,query:{vector:response.vectors[0]},settings,visit});
     }catch(error){failed=true;throw error;}
     finally{await dispose().catch(error=>{if(!failed)throw error;});}
    }).catch(async error=>{if(!entered)await dispose().catch(()=>undefined);throw error;});
   },
  };
  let value!:T;
  const errors:unknown[]=[];
  try{value=await operation(catalog);}catch(error){errors.push(error);}
  active=false;
  if(pending)try{await pending;}catch(error){if(!errors.includes(error))errors.push(error);}
  if(failed&&!errors.includes(failure))errors.push(failure);
  if(errors.length===1)throw errors[0];
  if(errors.length)throw new AggregateError(errors,'Collection callback and admitted operation failed');
  return value;
 };
 let migration:((editor:SqliteFinalizer)=>Promise<void>)|undefined,value!:T;
 const receipt=await transactSqlite({...options,async finalize(editor){
  if(migration)await migration(editor);
  value=await execute(editor);
 }},async session=>{
  migration=await initialize(session,signal,options.now,options.create!==false);
 });
 return {...receipt,value};
}
