import {md5} from 'safe-bash-checksum-engine/md5';
import {readSqliteBlob,withSqliteStatement,type PrivateSqliteSession} from 'safe-bash-sqlite-engine/storage';

/** Upgrade reference embedding layouts entirely inside the private transaction.
 * SQLite moves stored values; only bounded content chunks cross into JavaScript. */
export async function migrateLlmCollections(session:PrivateSqliteSession,signal:AbortSignal,now:()=>Date,columns:readonly string[],schema:string,migrations:readonly string[]):Promise<void>{
 const applied:string[]=[];
 await withSqliteStatement(session.module,{...session,signal,sql:"SELECT name FROM _sqlite_migrations WHERE migration_set='llm.embeddings' ORDER BY name LIMIT 6"},async query=>{
  for await(const [name]of query.rows([],['text']))applied.push(name as string);
 });
 const version=applied.length;
 if(version<1||version>4||applied.some((name,index)=>name!==migrations[index]))throw new Error('Unrecognized embedding migration ledger');
 const expected=['collection_id','id','embedding','content',...(version>=4?['content_hash']:[]),'metadata',...(version>=3?['updated']:[])];
 if(columns.join(',')!==expected.join(','))throw new Error('Embedding schema does not match its migration ledger');
 // Preserve caller-created indexes/triggers without collecting their definitions.
 // The temporary table is private to this transaction and is never published.
 await session.execute("CREATE TEMP TABLE llm_embedding_schema AS SELECT type,sql FROM sqlite_schema WHERE tbl_name='embeddings' AND sql IS NOT NULL AND type IN ('index','trigger')");
 if(version<3){
  await session.execute('ALTER TABLE embeddings ADD COLUMN updated INTEGER');
  await withSqliteStatement(session.module,{...session,signal,sql:'UPDATE embeddings SET updated=? WHERE updated IS NULL'},async query=>{
   for await(const row of query.rows([BigInt(Math.floor(now().getTime()/1000))],[]))void row;
  });
 }
 if(version<4){
  await session.execute('ALTER TABLE embeddings ADD COLUMN content_hash BLOB');
  let previous:bigint|undefined;
  for(;;){
   let current:{rowid:bigint;hasContent:boolean}|undefined;
   await withSqliteStatement(session.module,{...session,signal,sql:`SELECT rowid,content IS NOT NULL FROM embeddings ${previous===undefined?'':'WHERE rowid>?'} ORDER BY rowid LIMIT 1`},async query=>{
    for await(const [rowid,hasContent]of query.rows(previous===undefined?[]:[previous],['integer','integer']))current={rowid:rowid as bigint,hasContent:hasContent===1n};
   });
   if(!current)break;
   const hash=md5.create();
   let digest:Uint8Array;
   try{
    if(current.hasContent){
     for await(const chunk of readSqliteBlob(session.module,{...session,signal,table:'embeddings',column:'content',rowid:current.rowid}))hash.update(chunk);
    }else{
     // Reference null-content hashes use MD5(str(time.time())). They are identity
     // placeholders, not a hash of the absent payload.
     const seconds=now().getTime()/1000;
     hash.update(new TextEncoder().encode(Number.isInteger(seconds)?`${seconds}.0`:String(seconds)));
    }
    digest=hash.digest();
   }finally{hash.destroy();}
   await withSqliteStatement(session.module,{...session,signal,sql:'UPDATE embeddings SET content_hash=? WHERE rowid=?'},async query=>{
    for await(const row of query.rows([digest,current!.rowid],[]))void row;
   });
   previous=current.rowid;
  }
 }
 // One native copy applies the final FK and column order without materializing
 // vectors, stored content or metadata in the JavaScript heap.
 await session.execute(schema.replace('"embeddings"','"llm_embeddings_migrating"'));
 await session.execute('INSERT INTO llm_embeddings_migrating(rowid,collection_id,id,embedding,content,content_blob,content_hash,metadata,updated) SELECT rowid,collection_id,id,embedding,content,NULL,content_hash,metadata,updated FROM embeddings');
 await session.execute('DROP TABLE embeddings');
 await session.execute('ALTER TABLE llm_embeddings_migrating RENAME TO embeddings');
 await withSqliteStatement(session.module,{...session,signal,sql:'SELECT sql FROM llm_embedding_schema ORDER BY rowid'},async query=>{
  for await(const [sql]of query.rows([],['text']))await session.execute(sql as string);
 });
 if(version<4)await session.execute('CREATE INDEX idx_embeddings_content_hash ON embeddings(content_hash)');
 await session.execute('DROP TABLE temp.llm_embedding_schema');
 await withSqliteStatement(session.module,{...session,signal,sql:'INSERT INTO _sqlite_migrations(migration_set,name,applied_at) VALUES (?,?,?)'},async query=>{
  for(const name of migrations.slice(version)){
   const timestamp=now().toISOString().replace('T',' ').replace('Z','000+00:00');
   for await(const row of query.rows(['llm.embeddings',name,timestamp],[]))void row;
  }
 });
}
