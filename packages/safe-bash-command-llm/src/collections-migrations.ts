import {md5} from 'safe-bash-checksum-engine/md5';
import {readSqliteRecord,sqliteRecord,withSqliteStatement,type PrivateSqliteSession,type SqliteFinalizer,type SqliteRecordValue,type SqliteBinding,type SqliteEditSnapshot} from 'safe-bash-sqlite-engine/storage';

const empty={async *[Symbol.asyncIterator](){yield new Uint8Array();}};
const blob=(size:number):SqliteRecordValue=>({type:'blob',size,bytes:empty});
const bytesValue=(bytes:Uint8Array):SqliteRecordValue=>({type:'blob',size:bytes.length,bytes:{async *[Symbol.asyncIterator](){yield bytes;}}});

async function binding(value:SqliteRecordValue):Promise<SqliteBinding>{
 if(value===null||typeof value!=='object')return value;
 if(value.size>65536)throw new RangeError('SQLite collection key exceeds scalar binding budget');
 const bytes=new Uint8Array(value.size);let offset=0;
 for await(const chunk of value.bytes){bytes.set(chunk,offset);offset+=chunk.length;}
 if(offset!==bytes.length)throw new Error('SQLite collection key length mismatch');
 return value.type==='text'?new TextDecoder('utf-8',{fatal:true}).decode(bytes):bytes;
}

// Leave all large allocation in SQLite's trailing zero-blob representation.
// A small prefix pad bridges serial-varint width boundaries without allocating
// an earlier large field in OP_MakeRecord.
function placeholder(values:readonly SqliteRecordValue[],size:number):{pad:number;tail:number}{
 for(let pad=0;pad<=9;pad++){
  const base=[values[0]!,values[1]!,null,blob(pad),null,values[5]!,null];
  const minimum=sqliteRecord([...base,blob(0)]).size;
  for(let extra=0;extra<=9;extra++){
   const tail=size-minimum-extra;
   if(tail>=0&&sqliteRecord([...base,blob(tail)]).size===size)return {pad,tail};
  }
 }
 throw new Error('Unable to represent SQLite migration placeholder');
}

/** Validate the reference layout now; transform the closed private snapshot
 * before user operations, without native whole-record UPDATE or INSERT SELECT. */
export async function migrateLlmCollections(session:PrivateSqliteSession,signal:AbortSignal,now:()=>Date,columns:readonly string[],schema:string,migrations:readonly string[]):Promise<(editor:SqliteFinalizer)=>Promise<void>>{
 const applied:string[]=[];
 await withSqliteStatement(session.module,{...session,signal,sql:"SELECT name FROM _sqlite_migrations WHERE migration_set='llm.embeddings' ORDER BY name LIMIT 6"},async query=>{
  for await(const [name]of query.rows([],['text']))applied.push(name as string);
 });
 const version=applied.length;
 if(version<1||version>4||applied.some((name,index)=>name!==migrations[index]))throw new Error('Unrecognized embedding migration ledger');
 const expected=['collection_id','id','embedding','content',...(version>=4?['content_hash']:[]),'metadata',...(version>=3?['updated']:[])];
 if(columns.join(',')!==expected.join(','))throw new Error('Embedding schema does not match its migration ledger');
 let sourceRoot=0;
 await withSqliteStatement(session.module,{...session,signal,sql:"SELECT rootpage FROM sqlite_schema WHERE name='embeddings' AND type='table'"},async query=>{
  for await(const [root]of query.rows([],['integer']))sourceRoot=Number(root);
 });
 if(!sourceRoot)throw new Error('Missing embedding table root');
 const updated=BigInt(Math.floor(now().getTime()/1000));
 const seconds=now().getTime()/1000;
 const nullHash=md5(new TextEncoder().encode(Number.isInteger(seconds)?`${seconds}.0`:String(seconds)));
 const mapRecord=async(source:SqliteEditSnapshot,rowid:bigint)=>{
  const record=await source.findRecord(sourceRoot,rowid,'at-or-after');if(!record)return undefined;
  const fields=await readSqliteRecord(record,{signal,maxColumns:8});
  if(fields.length>columns.length)throw new Error('Unexpected embedding record width');
  const values=Object.fromEntries(columns.map((name,index)=>[name,fields[index]??null]));
  let hash=values.content_hash??null;
  if(version<4){
   const digest=md5.create();
   try{
    if(values.content===null){
     hash=bytesValue(nullHash);
    }else{
     if(!values.content||typeof values.content!=='object'||values.content.type!=='text')throw new TypeError('Embedding content must be TEXT');
     for await(const bytes of values.content.bytes){signal.throwIfAborted();digest.update(bytes);}
    }
    if(values.content!==null)hash=bytesValue(digest.digest());
   }finally{digest.destroy();}
  }
  const target=[values.collection_id!,values.id!,values.embedding!,values.content!,null,hash,values.metadata!,version<3?updated:values.updated!] satisfies SqliteRecordValue[];
  return {rowid:record.rowid,values:target,record:sqliteRecord(target)};
 };
 return async editor=>editor.withSnapshot(async(source,target)=>{
  let targetRoot=0;
  await target.withSession(async connection=>{
   await connection.execute('BEGIN IMMEDIATE');
   await connection.execute("CREATE TABLE llm_embedding_schema AS SELECT sql FROM sqlite_schema WHERE tbl_name='embeddings' AND sql IS NOT NULL AND type IN ('index','trigger')");
   await connection.execute(schema.replace('"embeddings"','"llm_embeddings_migrating"'));
   await withSqliteStatement(connection.module,{...connection,signal,sql:'INSERT INTO llm_embeddings_migrating(rowid,collection_id,id,embedding,content,content_blob,content_hash,metadata,updated) VALUES(?,?,?,NULL,zeroblob(?),NULL,?,NULL,zeroblob(?))'},async query=>{
    for(let next=-(1n<<63n);;){
     const row=await mapRecord(source,next);if(!row)break;
     const {pad,tail}=placeholder(row.values,row.record.size);
     for await(const result of query.rows([row.rowid,await binding(row.values[0]!),await binding(row.values[1]!),pad,await binding(row.values[5]!),tail],[]))void result;
     if(row.rowid===(1n<<63n)-1n)break;next=row.rowid+1n;
    }
   });
   await withSqliteStatement(connection.module,{...connection,signal,sql:"SELECT rootpage FROM sqlite_schema WHERE name='llm_embeddings_migrating'"},async query=>{
    for await(const [root]of query.rows([],['integer']))targetRoot=Number(root);
   });
   await connection.execute('COMMIT');
  });
  await target.rewriteRecords({async *[Symbol.asyncIterator](){
   for(let next=-(1n<<63n);;){
    const row=await mapRecord(source,next);if(!row)break;
    yield {rootPage:targetRoot,rowid:row.rowid,record:row.record};
    if(row.rowid===(1n<<63n)-1n)break;next=row.rowid+1n;
   }
  }});
  await target.withSession(async connection=>{
   await connection.execute('BEGIN IMMEDIATE');
   await connection.execute('DROP TABLE embeddings');
   await connection.execute('ALTER TABLE llm_embeddings_migrating RENAME TO embeddings');
   await withSqliteStatement(connection.module,{...connection,signal,sql:'SELECT sql FROM llm_embedding_schema ORDER BY rowid'},async query=>{
    for await(const [sql]of query.rows([],['text']))await connection.execute(sql as string);
   });
   if(version<4)await connection.execute('CREATE INDEX idx_embeddings_content_hash ON embeddings(content_hash)');
   await connection.execute('DROP TABLE llm_embedding_schema');
   await withSqliteStatement(connection.module,{...connection,signal,sql:'INSERT INTO _sqlite_migrations(migration_set,name,applied_at) VALUES (?,?,?)'},async query=>{
    for(const name of migrations.slice(version)){
     const timestamp=now().toISOString().replace('T',' ').replace('Z','000+00:00');
     for await(const row of query.rows(['llm.embeddings',name,timestamp],[]))void row;
    }
   });
   await connection.execute('COMMIT');
  });
 });
}
