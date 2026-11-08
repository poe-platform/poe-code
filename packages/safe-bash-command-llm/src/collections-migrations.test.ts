import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {transactSqlite,withSqliteStatement,type PrivateSqliteSession} from 'safe-bash-sqlite-engine/storage';
import {withLlmCollections} from './collections.js';

const signal=new AbortController().signal;
const options=(fs:MemoryFileSystem)=>({fs,path:'/embeddings.db',signal,maxFileBytes:2097152,maxIndexBytes:1048576,maxOpenFiles:8,now:()=>new Date('2026-10-02T00:00:00Z')});
const names=['m001_create_tables','m002_foreign_key','m003_add_updated','m004_store_content_hash','m005_add_content_blob'];
// Column order and foreign keys captured from llm==0.27.1 embeddings_migrations.
async function seed(session:PrivateSqliteSession,version:number){
 await session.execute('CREATE TABLE collections(id INTEGER PRIMARY KEY,name TEXT,model TEXT)');
 await session.execute('CREATE UNIQUE INDEX idx_collections_name ON collections(name)');
 await session.execute(`CREATE TABLE embeddings(collection_id INTEGER ${version>=2?'REFERENCES collections(id)':''},id TEXT,embedding BLOB,content TEXT,${version>=4?'content_hash BLOB,':''}metadata TEXT${version>=3?',updated INTEGER':''},PRIMARY KEY(collection_id,id))`);
 if(version>=4)await session.execute('CREATE INDEX idx_embeddings_content_hash ON embeddings(content_hash)');
 await session.execute('CREATE TABLE _sqlite_migrations(migration_set TEXT,name TEXT,applied_at TEXT,PRIMARY KEY(migration_set,name))');
 for(const name of names.slice(0,version))await session.execute(`INSERT INTO _sqlite_migrations VALUES('llm.embeddings','${name}','original')`);
 await session.execute("INSERT INTO collections VALUES(7,'documents','embed')");
 await session.execute(`INSERT INTO embeddings(collection_id,id,embedding,content,metadata${version>=3?',updated':''}${version>=4?',content_hash':''}) VALUES(7,'large',X'0000803F',replace(hex(zeroblob(40000)),'00','é'),'{}'${version>=3?',123':''}${version>=4?",X'0102'":''})`);
 await session.execute("INSERT INTO embeddings(collection_id,id,embedding) VALUES(7,'absent',X'00000000')");
}
for(const version of [1,2,3,4])test(`migrates reference embedding schema ${version} with streamed content hashing`,async()=>{
 const fs=new MemoryFileSystem();
 await transactSqlite(options(fs),session=>seed(session,version));
 await withLlmCollections(options(fs),async catalog=>{
  assert.equal((await catalog.collection('documents',{create:false})).id,7n);
 });
 await transactSqlite(options(fs),async session=>{
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT id,coalesce(length(CAST(content AS BLOB)),0),hex(embedding),hex(content_hash),coalesce(metadata,''),coalesce(updated,0),content_blob FROM embeddings ORDER BY id"},async query=>{
   const rows=[];for await(const row of query.rows([],['text','integer','text','text','text','integer','null']))rows.push(row);
   assert.equal(rows[0]![0],'absent');
   assert.equal((rows[0]![3] as string).length,version>=4?0:32);
   assert.deepEqual(rows[1],['large',80000n,'0000803F',version>=4?'0102':createHash('md5').update('é'.repeat(40000)).digest('hex').toUpperCase(),'{}',version>=3?123n:1790899200n,null]);
  });
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT name,applied_at FROM _sqlite_migrations WHERE migration_set='llm.embeddings' ORDER BY name"},async query=>{
   const rows=[];for await(const row of query.rows([],['text','text']))rows.push(row);
   assert.deepEqual(rows.map(row=>row[0]),names);
   assert.ok(rows.slice(0,version).every(row=>row[1]==='original'));
  });
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT count(*) FROM pragma_foreign_key_list('embeddings')"},async query=>{
   for await(const [count]of query.rows([],['integer']))assert.equal(count,1n);
  });
  await withSqliteStatement(session.module,{...session,signal,sql:'PRAGMA integrity_check'},async query=>{
   for await(const [result]of query.rows([],['text']))assert.equal(result,'ok');
  });
 });
 const before=await fs.readFile('/embeddings.db');
 await withLlmCollections(options(fs),async()=>{});
 assert.deepEqual(await fs.readFile('/embeddings.db'),before);
});

test('streamed migration handles empty records and serial-varint padding boundaries',async()=>{
 const fs=new MemoryFileSystem();const sizes=[0,1,50,57,58,63,64,8120,8191,8192];
 await transactSqlite(options(fs),async session=>{
  await seed(session,1);await session.execute('DELETE FROM embeddings');
  for(const size of sizes)await session.execute(`INSERT INTO embeddings(collection_id,id,embedding,content,metadata) VALUES(7,'${size}',X'',CAST(zeroblob(${size}) AS TEXT),NULL)`);
  await session.execute("INSERT INTO embeddings(rowid,collection_id,id) VALUES(-9223372036854775808,7,'first'),(9223372036854775807,7,'last')");
 });
 let tick=0;
 await withLlmCollections({...options(fs),now:()=>new Date(1790899200000+tick++)},async()=>{});
 await transactSqlite(options(fs),async session=>{
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT id,hex(content_hash) FROM embeddings WHERE id NOT IN ('first','last')"},async query=>{
   let rows=0;
   for await(const [id,hash]of query.rows([],['text','text'])){rows++;assert.equal(hash,createHash('md5').update(new Uint8Array(Number(id))).digest('hex').toUpperCase());}
   assert.equal(rows,sizes.length);
  });
  await withSqliteStatement(session.module,{...session,signal,sql:'PRAGMA integrity_check'},async query=>{
   for await(const [result]of query.rows([],['text']))assert.equal(result,'ok');
  });
 });
});

test('a failed collection callback rolls back migration and original bytes',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite(options(fs),session=>seed(session,1));
 const before=await fs.readFile('/embeddings.db');
 await assert.rejects(withLlmCollections(options(fs),async()=>{throw new Error('caller failed');}),/caller failed/);
 assert.deepEqual(await fs.readFile('/embeddings.db'),before);
});

test('migration preserves caller indexes and triggers',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite(options(fs),async session=>{
  await seed(session,4);
  await session.execute('CREATE INDEX custom_embedding_id ON embeddings(id)');
  await session.execute('CREATE TABLE deletions(id TEXT)');
  await session.execute('CREATE TRIGGER deleted_embedding AFTER DELETE ON embeddings BEGIN INSERT INTO deletions VALUES(old.id); END');
 });
 await withLlmCollections(options(fs),async catalog=>catalog.delete('documents'));
 await transactSqlite(options(fs),async session=>{
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT count(*) FROM sqlite_schema WHERE name IN ('custom_embedding_id','deleted_embedding')"},async query=>{
   for await(const [count]of query.rows([],['integer']))assert.equal(count,2n);
  });
  await withSqliteStatement(session.module,{...session,signal,sql:'SELECT count(*) FROM deletions'},async query=>{
   for await(const [count]of query.rows([],['integer']))assert.equal(count,2n);
  });
 });
});

test('invalid migration ledger and cancellation preserve canonical bytes',async()=>{
 const fs=new MemoryFileSystem();await transactSqlite(options(fs),async session=>{
  await seed(session,1);await session.execute("UPDATE _sqlite_migrations SET name='unknown'");
 });
 const before=await fs.readFile('/embeddings.db');
 await assert.rejects(withLlmCollections(options(fs),async()=>{}),/Unrecognized embedding migration ledger/);
 assert.deepEqual(await fs.readFile('/embeddings.db'),before);
 const controller=new AbortController(),reason=new Error('cancelled migration');
 controller.abort(reason);
 await assert.rejects(withLlmCollections({...options(fs),signal:controller.signal},async()=>{}),error=>error===reason);
 assert.deepEqual(await fs.readFile('/embeddings.db'),before);
});
