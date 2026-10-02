import {FsError, type FileSystem} from 'safe-bash-contracts';
import {transactSqlite,withSqliteStatement,type PrivateSqliteSession} from 'safe-bash-sqlite-engine/storage';
import {migrateLlmCollections} from './collections-migrations.js';

export interface LlmCollection {readonly id:bigint;readonly name:string;readonly model:string}
export interface LlmCollectionCatalog {
 collection(name:string,options?:{readonly model?:string;readonly create?:boolean}):Promise<LlmCollection>;
 list(visit:(collection:LlmCollection & {readonly count:bigint})=>void|Promise<void>):Promise<void>;
 delete(name:string):Promise<void>;
}
export class LlmCollectionDoesNotExist extends Error {
 constructor(name:string){super(`Collection '${name}' does not exist`);this.name='LlmCollectionDoesNotExist';}
}
const migrations=['m001_create_tables','m002_foreign_key','m003_add_updated','m004_store_content_hash','m005_add_content_blob'];
const schema=[
 'CREATE TABLE [_sqlite_migrations] ([migration_set] TEXT,[name] TEXT,[applied_at] TEXT,PRIMARY KEY ([migration_set],[name]))',
 'CREATE TABLE [collections] ([id] INTEGER PRIMARY KEY,[name] TEXT,[model] TEXT)',
 'CREATE UNIQUE INDEX [idx_collections_name] ON [collections] ([name])',
 'CREATE TABLE "embeddings" ([collection_id] INTEGER REFERENCES [collections]([id]),[id] TEXT,[embedding] BLOB,[content] TEXT,[content_blob] BLOB,[content_hash] BLOB,[metadata] TEXT,[updated] INTEGER,PRIMARY KEY ([collection_id],[id]))',
 'CREATE INDEX [idx_embeddings_content_hash] ON [embeddings] ([content_hash])',
];

async function initialize(session:PrivateSqliteSession,signal:AbortSignal,now:()=>Date):Promise<void>{
 const tables:string[]=[];
 await withSqliteStatement(session.module,{...session,signal,sql:"SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('collections','embeddings')"},async query=>{
  for await(const [name]of query.rows([],['text']))tables.push(name as string);
 });
 if(!tables.length){
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
  if(columns.join(',')!=='collection_id,id,embedding,content,content_blob,content_hash,metadata,updated')await migrateLlmCollections(session,signal,now,columns,schema[3]!,migrations);
 }
}

/** Callback-scoped collection catalog over the caller's retained SQLite storage.
 * Model IDs are canonical provider IDs supplied by the host. Any operation error
 * aborts publication, including errors caught inside the callback. */
export async function withLlmCollections<T>(options:{
 readonly fs:FileSystem;readonly path:string;readonly signal:AbortSignal;
 readonly maxFileBytes:number;readonly maxIndexBytes:number;readonly maxOpenFiles:number;
 readonly now:()=>Date;
},operation:(catalog:LlmCollectionCatalog)=>Promise<T>){
 const {signal}=options;
 return transactSqlite(options,async session=>{
  await initialize(session,signal,options.now);
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
  const lookup=async(name:string):Promise<LlmCollection|undefined>=>{
   if(typeof name!=='string')throw new TypeError('Collection name must be a string');
   return withSqliteStatement(session.module,{...session,signal,sql:'SELECT id,name,model FROM collections WHERE name=?'},async query=>{
    for await(const [id,storedName,model]of query.rows([name],['integer','text','text']))return {id:id as bigint,name:storedName as string,model:model as string};
    return undefined;
   });
  };
  const catalog:LlmCollectionCatalog={
   collection(name,settings={}){return run(async()=>{
    const existing=await lookup(name);if(existing)return existing;
    if(settings.create===false)throw new LlmCollectionDoesNotExist(name);
    if(settings.model===undefined)throw new Error('Either model= or model_id= must be provided when creating a new collection');
    if(typeof settings.model!=='string')throw new TypeError('Collection model must be a string');
    return withSqliteStatement(session.module,{...session,signal,sql:'INSERT INTO collections(name,model) VALUES (?,?) RETURNING id'},async query=>{
     for await(const [id]of query.rows([name,settings.model!],['integer']))return {id:id as bigint,name,model:settings.model!};
     throw new Error('Collection insertion returned no ID');
    });
   });},
   list(visit){return run(async()=>{
    await withSqliteStatement(session.module,{...session,signal,sql:'SELECT id,name,model,(SELECT count(*) FROM embeddings WHERE collection_id=collections.id) FROM collections ORDER BY id'},async query=>{
     for await(const [id,name,model,count]of query.rows([],['integer','text','text','integer']))await visit({id:id as bigint,name:name as string,model:model as string,count:count as bigint});
    });
   });},
   delete(name){return run(async()=>{
    const existing=await lookup(name);if(!existing)throw new LlmCollectionDoesNotExist(name);
    for(const sql of ['DELETE FROM embeddings WHERE collection_id=?','DELETE FROM collections WHERE id=?'])await withSqliteStatement(session.module,{...session,signal,sql},async query=>{
     for await(const row of query.rows([existing.id],[]))void row;
    });
   });},
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
 });
}
