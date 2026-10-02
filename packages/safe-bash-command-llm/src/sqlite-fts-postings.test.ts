import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { toByteSource } from 'safe-bash-contracts';
import { withPrivateSqliteSession } from './sqlite-session.js';
import { withSqliteFtsPostings } from './sqlite-fts-postings.js';
import { sqliteFtsLeaves } from './sqlite-fts-leaf.js';
const signal=new AbortController().signal;

test('native token staging produces sorted complete multi-column position lists and counts',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 await withPrivateSqliteSession({fs,directory:'/private',path:'/private/db',signal,maxFileBytes:1048576,maxOpenFiles:16},async session=>{
  const documents=(async function*(){
   yield {rowid:130n,columns:[toByteSource('Béta alpha alpha'),toByteSource('gamma alpha')]};
   yield {rowid:-129n,columns:[toByteSource('alpha beta'),toByteSource('alpha')]};
   yield {rowid:9007199254740993n,columns:[toByteSource(''),toByteSource('')]};
  })();
  await withSqliteFtsPostings(session,{documents,columns:2,signal},async data=>{
   assert.deepEqual(data.totals,[5n,3n]);assert.equal(data.documentCount,3n);
   const sizes:unknown[]=[];
   for await(const row of data.documents())sizes.push([row.rowid,[...row.bytes]]);
   assert.deepEqual(sizes,[[-129n,[2,1]],[130n,[3,2]],[9007199254740993n,[0,0]]]);
   const postings:unknown[]=[];
   for await(const row of data.postings()){
    const chunks:number[]=[];for await(const bytes of row.positions)chunks.push(...bytes);
    assert.equal(row.positionBytes,chunks.length);
    postings.push([new TextDecoder().decode(row.term),row.rowid,chunks]);
   }
   assert.deepEqual(postings,[['alpha',-129n,[2,1,1,2]],['alpha',130n,[3,3,1,1,3]],['beta',-129n,[3]],['beta',130n,[2]],['gamma',130n,[1,1,2]]]);
  });
 });
});

test('staged native tokens compose with the bounded leaf encoder golden fixture',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 await withPrivateSqliteSession({fs,directory:'/private',path:'/private/db',signal,maxFileBytes:1048576,maxOpenFiles:16},async session=>{
  await withSqliteFtsPostings(session,{columns:1,signal,documents:(async function*(){yield {rowid:1n,columns:[toByteSource('alpha beta alpha')]};})()},async data=>{
   const leaves=[];for await(const leaf of sqliteFtsLeaves(data.postings(),signal))leaves.push(leaf);
   assert.equal(leaves.length,1);
   assert.equal(Buffer.from(leaves[0]!.bytes).toString('hex'),'000000180630616c70686101040204010462657461010203040b');
  });
 });
});

test('streamed postings and doc sizes match native FTS5 vocabulary with long gaps and split UTF-8',async()=>{
 const {withSqliteStatement}=await import('./sqlite-statement.js');
 const {readSqliteVarint}=await import('./sqlite-varint.js');
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 await withPrivateSqliteSession({fs,directory:'/private',path:'/private/db',signal,maxFileBytes:1048576,maxOpenFiles:16},async session=>{
  await session.execute('CREATE VIRTUAL TABLE reference USING fts5(a,b); CREATE VIRTUAL TABLE vocabulary USING fts5vocab(reference,instance);');
  const input:[bigint,string[]][]=[[-129n,['alpha '+'x '.repeat(200)+'alpha','Été Alpha']],[9007199254740993n,['BÉTA café alpha','🙂 Gamma']]];
  await withSqliteStatement(session.module,{...session,signal,sql:'INSERT INTO reference(rowid,a,b) VALUES(?,?,?)'},async statement=>{
   for(const [rowid,cols]of input)for await(const row of statement.rows([rowid,...cols],[]))void row;
  });
  const expected:unknown[]=[];
  await withSqliteStatement(session.module,{...session,signal,sql:'SELECT term,doc,col,offset FROM vocabulary ORDER BY term,doc,col,offset'},async statement=>{
   for await(const row of statement.rows([],['text','integer','text','integer']))expected.push(row);
  });
  await withSqliteFtsPostings(session,{columns:2,signal,documents:(async function*(){
   for(const [rowid,cols]of input)yield {rowid,columns:cols.map(text=>({async *[Symbol.asyncIterator](){for(const byte of new TextEncoder().encode(text))yield Uint8Array.of(byte);}}))};
  })()},async data=>{
   const actual:unknown[]=[];
   for await(const posting of data.postings()){
    const chunks:Uint8Array[]=[];for await(const bytes of posting.positions)chunks.push(bytes);
    const encoded=Buffer.concat(chunks);assert.equal(encoded.length,posting.positionBytes);
    let col=0n,pos=0n;
    for(let offset=0;offset<encoded.length;){
     let item=readSqliteVarint(encoded,offset);offset=item.end;
     if(item.value===1n){item=readSqliteVarint(encoded,offset);offset=item.end;col=item.value;pos=0n;continue;}
     pos+=item.value-2n;actual.push([new TextDecoder().decode(posting.term),posting.rowid,col===0n?'a':'b',pos]);
    }
   }
   assert.deepEqual(actual,expected);
   const expectedSizes:unknown[]=[];
   await withSqliteStatement(session.module,{...session,signal,sql:'SELECT id,sz FROM reference_docsize ORDER BY id'},async statement=>{
    for await(const row of statement.rows([],['integer','blob']))expectedSizes.push([row[0],[...(row[1] as Uint8Array)]]);
   });
   const sizes:unknown[]=[];for await(const doc of data.documents())sizes.push([doc.rowid,[...doc.bytes]]);
   assert.deepEqual(sizes,expectedSizes);
  });
 });
});

test('consumer early return retires cursors and rejects escaped or overlapping iterators',async()=>{
 const {withSqliteStatement}=await import('./sqlite-statement.js');
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 await withPrivateSqliteSession({fs,directory:'/private',path:'/private/db',signal,maxFileBytes:1048576,maxOpenFiles:16},async session=>{
  let escaped:AsyncIterable<unknown>|undefined;
  await withSqliteFtsPostings(session,{columns:1,signal,documents:(async function*(){yield {rowid:1n,columns:[toByteSource('one two one')]};})()},async data=>{
   escaped=data.documents();
   const postings=data.postings()[Symbol.asyncIterator]();
   const first=await postings.next();assert.equal(first.done,false);
   await assert.rejects(data.documents()[Symbol.asyncIterator]().next(),{code:'EBUSY'});
   const position=first.value.positions[Symbol.asyncIterator]();assert.equal((await position.next()).done,false);
   // Deliberately leave both iterators open: the owning callback must close them.
  });
  await assert.rejects(escaped![Symbol.asyncIterator]().next(),{code:'EBADF'});
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT count(*) FROM sqlite_temp_schema WHERE name LIKE 'llm_fts_%'"},async statement=>{
   for await(const row of statement.rows([],['integer']))assert.deepEqual(row,[0n]);
  });
 });
});

test('staging failures close sources and release temporary native state',async()=>{
 const {withSqliteStatement}=await import('./sqlite-statement.js');
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 await withPrivateSqliteSession({fs,directory:'/private',path:'/private/db',signal,maxFileBytes:1048576,maxOpenFiles:16},async session=>{
  let closed=false;
  const source={async *[Symbol.asyncIterator](){try{yield new TextEncoder().encode('one ');throw new Error('source failed');}finally{closed=true;}}};
  await assert.rejects(withSqliteFtsPostings(session,{columns:1,signal,documents:(async function*(){yield {rowid:1n,columns:[source]};})()},async()=>{assert.fail('consumer called');}),/source failed/);
  assert.equal(closed,true);
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT count(*) FROM sqlite_temp_schema WHERE name LIKE 'llm_fts_%'"},async statement=>{
   for await(const row of statement.rows([],['integer']))assert.deepEqual(row,[0n]);
  });
 });
});

test('cancellation of pending token input closes the source and native tokenizer slot',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 await withPrivateSqliteSession({fs,directory:'/private',path:'/private/db',signal,maxFileBytes:1048576,maxOpenFiles:16},async session=>{
  const abort=new AbortController();let started!:()=>void,returned=0;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const source={ [Symbol.asyncIterator](){return {next(){started();return new Promise<IteratorResult<Uint8Array>>(()=>{});},async return(){returned++;return {done:true as const,value:undefined};}};}};
  const pending=withSqliteFtsPostings(session,{columns:1,signal:abort.signal,documents:(async function*(){yield {rowid:1n,columns:[source]};})()},async()=>{assert.fail('consumer called');});
  await ready;abort.abort(new Error('cancel pending token input'));
  await assert.rejects(pending);assert.equal(returned,1);assert.equal(session.table.get(session.slot),null);
 });
 assert.deepEqual((await fs.readdir('/private')).map(entry=>entry.name),['db']);
});

test('maximum native token prefixes remain valid sort keys and bounded leaf input',async()=>{
 const fs=new MemoryFileSystem();await fs.mkdir('/private');
 await withPrivateSqliteSession({fs,directory:'/private',path:'/private/db',signal,maxFileBytes:1048576,maxOpenFiles:16},async session=>{
  await withSqliteFtsPostings(session,{columns:1,signal,documents:(async function*(){yield {rowid:1n,columns:[toByteSource('a'.repeat(40000)+' '+'a'.repeat(40000))]};})()},async data=>{
   assert.deepEqual(data.totals,[2n]);let count=0;
   for await(const posting of data.postings()){
    count++;assert.equal(posting.term.length,32768);assert.equal(posting.positionBytes,2);
    const bytes:number[]=[];for await(const chunk of posting.positions)bytes.push(...chunk);assert.deepEqual(bytes,[2,3]);
   }
   assert.equal(count,1);
  });
 });
});
