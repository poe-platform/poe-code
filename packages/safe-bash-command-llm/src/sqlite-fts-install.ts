import type {PrivateSqliteSession} from './sqlite-session.js';
import {withSqliteStatement} from './sqlite-statement.js';
import {withSqliteFtsPostings, type SqliteFtsDocument} from './sqlite-fts-postings.js';
import {sqliteFtsLeaves} from './sqlite-fts-leaf.js';
import {readSqliteVarint,writeSqliteVarint} from './sqlite-varint.js';

interface Segment {id:bigint;first:bigint;last:bigint}
interface Level {merging:bigint;segments:Segment[]}
function decodeStructure(bytes:Uint8Array):{cookie:Uint8Array;writes:bigint;levels:Level[]} {
 let offset=4;
 const read=():bigint=>{const v=readSqliteVarint(bytes,offset);offset=v.end;return v.value;};
 const count=read(),total=read(),writes=read();
 if(count>64n||total>2000n)throw new RangeError('Invalid FTS structure size');
 const levels:Level[]=[];let seen=0n;const ids=new Set<bigint>();
 for(let i=0n;i<count;i++){
  const merging=read(),size=read();
  if(size>total-seen||merging>size)throw new RangeError('Invalid FTS level size');
  const segments:Segment[]=[];
  for(let j=0n;j<size;j++){
   const id=read(),first=read(),last=read();
   if(id<1n||id>2000n||ids.has(id)||first>last||last>0x7fffffffn)throw new RangeError('Invalid FTS segment');
   ids.add(id);segments.push({id,first,last});
  }
  seen+=size;levels.push({merging,segments});
 }
 if(seen!==total||offset!==bytes.length)throw new RangeError('Invalid FTS structure encoding');
 return {cookie:bytes.slice(0,4),writes,levels};
}
function encode(values:readonly bigint[]):Uint8Array {
 const chunks=values.map(writeSqliteVarint),result=new Uint8Array(chunks.reduce((n,v)=>n+v.length,0));
 let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}

/** Append documents to a default unicode61/full-detail FTS5 index in an owned
 * private database. The caller must supply the matching content separately and
 * reopen the connection before using the virtual table: native FTS connections
 * cache structure records. This is an internal finalization operation, not a
 * replacement for SQL INSERT or a generic tokenizer/configuration interface. */
export async function installSqliteFtsDocuments(session:PrivateSqliteSession,options:{
 table:string;columns:number;documents:AsyncIterable<SqliteFtsDocument>;signal:AbortSignal;
}):Promise<void>{
 const {table,columns,documents,signal}=options;
 if(!table||table.includes('\0'))throw new RangeError('Invalid FTS table name');
 const quote=(suffix:string):string=>'"'+(table+suffix).replaceAll('"','""')+'"';
 // Staging consumes and validates all sources before any shadow-table mutation.
 await withSqliteFtsPostings(session,{columns,documents,signal},async data=>{
  let structure!:ReturnType<typeof decodeStructure>,averages:bigint[]=[];
  await withSqliteStatement(session.module,{...session,signal,sql:`SELECT id,block FROM ${quote('_data')} WHERE id IN (1,10) ORDER BY id`},async q=>{
   for await(const [id,value]of q.rows([],['integer','blob'])){
    const bytes=value as Uint8Array;
    if(id===10n)structure=decodeStructure(bytes);
    else for(let offset=0;offset<bytes.length;){const v=readSqliteVarint(bytes,offset);averages.push(v.value);offset=v.end;}
   }
  });
  if(!structure||averages.length&&averages.length!==columns+1)throw new RangeError('Invalid FTS averages');
  if(!averages.length)averages=Array<bigint>(columns+1).fill(0n);
  if(!data.documentCount)return;
  const used=new Set(structure.levels.flatMap(level=>level.segments.map(segment=>segment.id)));
  let id=1n;while(used.has(id))id++;
  if(id>2000n)throw new RangeError('FTS segment identifiers exhausted; merge the index before appending');
  const savepoint='llm_fts_install';
  await session.execute(`SAVEPOINT ${savepoint}`);
  try{
   await withSqliteStatement(session.module,{...session,signal,sql:`INSERT INTO ${quote('_docsize')}(id,sz) VALUES(?,?)`},async insert=>{
    for await(const doc of data.documents())for await(const unused of insert.rows([doc.rowid,doc.bytes],[]))void unused;
   });
   let pages=0;
   await withSqliteStatement(session.module,{...session,signal,sql:`INSERT INTO ${quote('_data')}(id,block) VALUES(?,?)`},async insert=>
    withSqliteStatement(session.module,{...session,signal,sql:`INSERT INTO ${quote('_idx')}(segid,term,pgno) VALUES(?,?,?)`},async index=>{
     for await(const leaf of sqliteFtsLeaves(data.postings(),signal)){
      pages=leaf.page;
      for await(const unused of insert.rows([(id<<37n)+BigInt(leaf.page),leaf.bytes],[]))void unused;
      if(leaf.indexTerm)for await(const unused of index.rows([id,leaf.indexTerm,BigInt(leaf.page)*2n],[]))void unused;
     }
    }));
   if(pages){
    if(!structure.levels.length)structure.levels.push({merging:0n,segments:[]});
    structure.levels[0]!.segments.push({id,first:1n,last:BigInt(pages)});
    structure.writes+=BigInt(pages);
   }
   averages[0]=averages[0]!+data.documentCount;
   for(let col=0;col<columns;col++)averages[col+1]=averages[col+1]!+data.totals[col]!;
   const values=[BigInt(structure.levels.length),BigInt(used.size+(pages?1:0)),structure.writes];
   for(const level of structure.levels){values.push(level.merging,BigInt(level.segments.length));for(const seg of level.segments)values.push(seg.id,seg.first,seg.last);}
   const tail=encode(values),bytes=new Uint8Array(tail.length+4);bytes.set(structure.cookie);bytes.set(tail,4);
   await withSqliteStatement(session.module,{...session,signal,sql:`UPDATE ${quote('_data')} SET block=? WHERE id=?`},async update=>{
    for(const [key,value]of [[1n,encode(averages)],[10n,bytes]] as const)for await(const unused of update.rows([value,key],[]))void unused;
   });
   await session.execute(`RELEASE ${savepoint}`);
  }catch(error){
   try{await session.execute(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);}catch(cleanup){throw new AggregateError([error,cleanup],'FTS installation and rollback failed');}
   throw error;
  }
 });
}
