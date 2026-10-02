import { FsError, type ByteSource } from 'safe-bash-contracts';
import type { PrivateSqliteSession } from './sqlite-session.js';
import { withSqliteStatement } from './sqlite-statement.js';
import { withNativeUnicode61 } from './sqlite-unicode-native.js';
import { streamSqliteUnicode61 } from './sqlite-tokenizer.js';
import { sqliteSourceChunks } from './sqlite-stream.js';
import { writeSqliteVarint } from './sqlite-varint.js';
import type { FtsPosting } from './sqlite-fts-leaf.js';

export interface SqliteFtsDocument {readonly rowid: bigint; readonly columns: readonly ByteSource[]}
export interface SqliteFtsPostings {
 readonly totals: readonly bigint[];
 readonly documentCount: bigint;
 /** Consume one iterator at a time, within the callback lifetime. */
 documents(): AsyncIterable<{rowid: bigint; bytes: Uint8Array}>;
 /** Each position stream belongs to the current posting only. */
 postings(): AsyncIterable<FtsPosting>;
}

/** Sort normalized terms on caller-backed native temporary tables. Position
 * lists are counted once and streamed a second time; neither a document's term
 * set nor an arbitrarily long position list becomes a JS/native hash table. */
export async function withSqliteFtsPostings<T>(session: PrivateSqliteSession, options: {
 documents: AsyncIterable<SqliteFtsDocument>; columns: number; signal: AbortSignal;
}, consume: (data: SqliteFtsPostings) => Promise<T>): Promise<T> {
 const {signal,columns,documents:input}=options;
 signal.throwIfAborted();
 if(!Number.isSafeInteger(columns)||columns<1||columns>2000)throw new RangeError('Invalid SQLite FTS column count');
 const name='llm_fts_'+crypto.randomUUID().replaceAll('-','');
 const tokens='temp.'+name+'_tokens',docs='temp.'+name+'_docs';
 const errors:unknown[]=[];let result!:T;
 let createdTokens=false,createdDocs=false;
 try{
  await session.execute(`PRAGMA temp.cache_size=-512; CREATE TEMP TABLE ${name}_tokens(term BLOB,docid INTEGER,col INTEGER,pos INTEGER,PRIMARY KEY(term,docid,col,pos)) WITHOUT ROWID;`);createdTokens=true;
  await session.execute(`CREATE TEMP TABLE ${name}_docs(docid INTEGER PRIMARY KEY,counts BLOB);`);createdDocs=true;
  const totals=Array<bigint>(columns).fill(0n);let documentCount=0n;
  await withNativeUnicode61(session.module,{...session,signal},async tokenize=>{
   await withSqliteStatement(session.module,{...session,signal,sql:`INSERT INTO ${tokens} VALUES(?,?,?,?)`},async insert=>{
    await withSqliteStatement(session.module,{...session,signal,sql:`INSERT INTO ${docs} VALUES(?,?)`},async insertDoc=>{
     for await(const document of sqliteSourceChunks(input,signal)){
      const rowid=document.rowid,sources=document.columns.slice();
      if(typeof rowid!=='bigint'||rowid<-(1n<<63n)||rowid>=(1n<<63n))throw new RangeError('Invalid SQLite FTS document rowid');
      if(sources.length!==columns)throw new RangeError('SQLite FTS document column count mismatch');
      const counts=Array<bigint>(columns).fill(0n);
      for(let col=0;col<columns;col++){
       for await(const term of streamSqliteUnicode61(sources[col]!,signal,tokenize)){
        for await(const unused of insert.rows([term,rowid,BigInt(col),counts[col]!],[]))void unused;
        counts[col]=counts[col]!+1n;totals[col]=totals[col]!+1n;
       }
      }
      const encoded=counts.map(writeSqliteVarint),bytes=new Uint8Array(encoded.reduce((size,value)=>size+value.length,0));
      let offset=0;for(const value of encoded){bytes.set(value,offset);offset+=value.length;}
      for await(const unused of insertDoc.rows([rowid,bytes],[]))void unused;
      documentCount++;
     }
    });
   });
  });
  result=await withSqliteStatement(session.module,{...session,signal,sql:`SELECT term,docid FROM ${tokens} GROUP BY term,docid ORDER BY term,docid`},async groups=>
   withSqliteStatement(session.module,{...session,signal,sql:`SELECT col,pos FROM ${tokens} WHERE term=? AND docid=? ORDER BY col,pos`},async positions=>
    withSqliteStatement(session.module,{...session,signal,sql:`SELECT docid,counts FROM ${docs} ORDER BY docid`},async sizes=>{
     let accepting=true,active:AsyncGenerator<unknown>|undefined;
     const check=():void=>{signal.throwIfAborted();if(!accepting)throw new FsError('EBADF',{message:'SQLite FTS postings are closed'});};
     async function* positionBytes(term:Uint8Array,rowid:bigint):AsyncGenerator<Uint8Array>{
      let column=0n,previous=0n;
      for await(const row of positions.rows([term,rowid],['integer','integer'])){
       check();const col=row[0] as bigint,pos=row[1] as bigint;
       if(col!==column){yield Uint8Array.of(1);yield writeSqliteVarint(col);column=col;previous=0n;}
       yield writeSqliteVarint(pos-previous+2n);previous=pos;
      }
     }
     const documents=():AsyncGenerator<{rowid:bigint;bytes:Uint8Array}>=>{
      async function* iterate():AsyncGenerator<{rowid:bigint;bytes:Uint8Array}>{
       check();if(active)throw new FsError('EBUSY',{message:'SQLite FTS cursors overlap'});active=iterator;
       try{for await(const row of sizes.rows([],['integer','blob'])){check();yield {rowid:row[0] as bigint,bytes:row[1] as Uint8Array};}}
       finally{active=undefined;}
      }
      const iterator=iterate();return iterator;
     };
     const postings=():AsyncGenerator<FtsPosting>=>{
      async function* iterate():AsyncGenerator<FtsPosting>{
       check();if(active)throw new FsError('EBUSY',{message:'SQLite FTS cursors overlap'});active=iterator;
       try{
        for await(const row of groups.rows([],['blob','integer'])){
         check();const term=row[0] as Uint8Array,rowid=row[1] as bigint;
         let length=0;for await(const bytes of positionBytes(term,rowid)){length+=bytes.length;if(!Number.isSafeInteger(length))throw new RangeError('SQLite FTS position length overflow');}
         const stream=positionBytes(term,rowid);
         try{yield {term:term.slice(),rowid,positionBytes:length,positions:stream};}
         finally{await stream.return(undefined);}
        }
       }finally{active=undefined;}
      }
      const iterator=iterate();return iterator;
     };
     const failures:unknown[]=[];let value!:T;
     try{value=await consume({totals:totals.slice(),documentCount,documents,postings});}catch(error){failures.push(error);}
     accepting=false;
     if(active)try{await active.return(undefined);}catch(error){if(!failures.includes(error))failures.push(error);}
     if(failures.length===1)throw failures[0];
     if(failures.length)throw new AggregateError(failures,'SQLite FTS consumer and cursor cleanup failed');
     return value;
    })));
 }catch(error){errors.push(error);}
 for(const table of [createdTokens?tokens:undefined,createdDocs?docs:undefined])if(table)try{await session.execute(`DROP TABLE ${table}`);}catch(error){if(!errors.includes(error))errors.push(error);}
 if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'SQLite FTS staging and cleanup failed');
 return result;
}
