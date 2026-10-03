import {FsError,type ByteSource} from 'safe-bash-contracts';
import {yieldTurn} from 'safe-bash-contracts/yield';
import {readSqliteRecord,withSqliteStatement,type SqliteFinalizer,type SqliteRecordValue,type SqliteBinding} from 'safe-bash-sqlite-engine/storage';
import {waitForSource} from './request-source.js';
import {LlmCollectionDoesNotExist} from './collections-errors.js';

export interface LlmCollectionSimilarOptions {
 readonly number?:number;
 readonly prefix?:string;
 readonly skipId?:string;
}
/** A callback-scoped UTF-8 field. Retain data in caller storage if needed later. */
export interface LlmCollectionField {readonly size:number;readonly bytes:ByteSource}
export interface LlmCollectionSimilarity {
 readonly id:string;readonly score:number|null;
 readonly content:LlmCollectionField|null;
 readonly metadata:LlmCollectionField|null;
}

async function* floats(field:SqliteRecordValue,signal:AbortSignal):AsyncIterable<ArrayLike<number>>{
 if(!field||typeof field!=='object'||field.type!=='blob'||field.size%4)throw new TypeError('Malformed embedding vector');
 const pending=new Uint8Array(4);let count=0;
 let output=new Float64Array(4096),written=0;
 for await(const bytes of field.bytes){
  await yieldTurn(signal);
  for(let offset=0;offset<bytes.length;){
   if(count||bytes.length-offset<4){
    pending[count++]=bytes[offset++]!;
    if(count===4){output[written++]=new DataView(pending.buffer).getFloat32(0,true);count=0;}
   }else{
    output[written++]=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getFloat32(0,true);offset+=4;
   }
   if(written===output.length){yield output;output=new Float64Array(4096);written=0;}
  }
 }
 if(count)throw new TypeError('Malformed embedding vector');
 if(written)yield output.subarray(0,written);
}

async function cosine(a:AsyncIterable<ArrayLike<number>>,b:AsyncIterable<ArrayLike<number>>,signal:AbortSignal):Promise<number|null>{
 const right=b[Symbol.asyncIterator]();let dot=0,leftNorm=0,rightNorm=0,ended=false;
 let block:ArrayLike<number>=[],position=0;
 try{
  for await(const values of a){
   signal.throwIfAborted();
   for(let index=0;index<values.length;index++){
    const x=values[index]!;leftNorm+=x*x;
    while(!ended&&position===block.length){const next=await right.next();ended=Boolean(next.done);if(!next.done){block=next.value;position=0;}}
    if(!ended){const y=block[position++]!;dot+=x*y;rightNorm+=y*y;}
   }
  }
  while(!ended){
   signal.throwIfAborted();for(;position<block.length;position++)rightNorm+=block[position]!*block[position]!;
   const next=await right.next();ended=Boolean(next.done);if(!next.done){block=next.value;position=0;}
  }
 }finally{if(!ended)await right.return?.();}
 const denominator=Math.sqrt(leftNorm)*Math.sqrt(rightNorm);
 if(denominator===0)throw new Error('Embedding similarity division by zero');
 const score=dot/denominator;
 // SQLite turns a Python UDF NaN into SQL NULL.
 return Number.isNaN(score)?null:score;
}

/** Score streamed records and rank in caller-backed SQLite, without retaining
 * a vector corpus, result heap, or arbitrary content/metadata in JS memory. */
export async function similarCollection(editor:SqliteFinalizer,options:{
 collectionId:bigint;signal:AbortSignal;
 query:{readonly vector:readonly number[]}|{readonly id:string};
 settings:LlmCollectionSimilarOptions;
 visit:(entry:LlmCollectionSimilarity)=>void|Promise<void>;
}):Promise<void>{
 const {signal,collectionId,query,settings,visit}=options;
 const number=settings.number??10;
 if(!Number.isSafeInteger(number))throw new TypeError('Similarity number must be an integer');
 if(settings.prefix!==undefined&&typeof settings.prefix!=='string'||settings.skipId!==undefined&&typeof settings.skipId!=='string')throw new TypeError('Similarity filters must be strings');
 if('vector'in query&&(!Array.isArray(query.vector)||query.vector.some(value=>typeof value!=='number')))throw new TypeError('Similarity vector must contain numbers');
 await editor.withSnapshot(async(source,target)=>target.withSession(async session=>{
  let root=0;
  await withSqliteStatement(session.module,{...session,signal,sql:"SELECT rootpage FROM sqlite_schema WHERE name='embeddings'"},async statement=>{
   for await(const [value]of statement.rows([],['integer']))root=Number(value);
  });
  const fields=async(rowid:bigint)=>{
   const record=await source.findRecord(root,rowid);
   if(!record)throw new Error('Embedding record disappeared');
   return readSqliteRecord(record,{signal,maxColumns:8});
  };
  let reference:AsyncIterable<ArrayLike<number>>,skipId=settings.skipId;
  if('id'in query){
   let rowid:bigint|undefined;
   await withSqliteStatement(session.module,{...session,signal,sql:'SELECT rowid FROM embeddings WHERE collection_id=? AND id=?'},async statement=>{
    for await(const [value]of statement.rows([collectionId,query.id],['integer']))rowid=value as bigint;
   });
   if(rowid===undefined)throw new LlmCollectionDoesNotExist(query.id,'ID not found');
   const vector=(await fields(rowid))[2]??null;
   reference={[Symbol.asyncIterator]:()=>floats(vector,signal)[Symbol.asyncIterator]()};skipId=query.id;
  }else reference={async *[Symbol.asyncIterator](){for(let index=0;index<query.vector.length;index+=4096){await yieldTurn(signal);yield query.vector.slice(index,index+4096);}}};
  if(number===0)return;
  await session.execute('PRAGMA temp.cache_size=-512');
  await session.execute('CREATE TEMP TABLE llm_similarity(sequence INTEGER PRIMARY KEY,source_rowid INTEGER,score REAL)');
  await session.execute('CREATE INDEX temp.llm_similarity_score ON llm_similarity(score DESC,sequence)');
  const where=['collection_id=?'],bindings:SqliteBinding[]=[collectionId];
  if(settings.prefix){where.push("id LIKE ? || '%'");bindings.push(settings.prefix);}
  if(skipId){where.push('id != ?');bindings.push(skipId);}
  await withSqliteStatement(session.module,{...session,signal,sql:'SELECT rowid FROM embeddings WHERE '+where.join(' AND ')},async candidates=>{
   await withSqliteStatement(session.module,{...session,signal,sql:'INSERT INTO llm_similarity(source_rowid,score) VALUES (?,?)'},async insert=>{
    for await(const [value]of candidates.rows(bindings,['integer'])){
     const rowid=value as bigint,vector=(await fields(rowid))[2]??null;
     const score=await cosine(floats(vector,signal),reference,signal);
     for await(const row of insert.rows([rowid,score],[]))void row;
    }
   });
  });
  await withSqliteStatement(session.module,{...session,signal,sql:'SELECT e.id,s.source_rowid,CAST(coalesce(s.score,0.0) AS REAL),s.score IS NULL FROM llm_similarity s JOIN embeddings e ON e.rowid=s.source_rowid ORDER BY s.score DESC,s.sequence LIMIT ?'},async ranked=>{
   for await(const [id,rowid,score,isNull]of ranked.rows([BigInt(number)],['text','integer','real','integer'])){
    const values=await fields(rowid as bigint);let active=true;
    const field=(value:SqliteRecordValue):LlmCollectionField|null=>{
     if(value===null)return null;
     if(typeof value!=='object'||value.type!=='text')throw new TypeError('Expected stored embedding text');
     return {size:value.size,bytes:{async *[Symbol.asyncIterator](){
      if(!active)throw new FsError('EBADF',{message:'Similarity result is closed'});
      for await(const bytes of value.bytes){if(!active)throw new FsError('EBADF',{message:'Similarity result is closed'});yield bytes;}
     }}};
    };
    try{await waitForSource(()=>Promise.resolve(visit({id:id as string,score:isNull===1n?null:score as number,content:field(values[3]??null),metadata:field(values[6]??null)})),signal);}
    finally{active=false;}
   }
  });
 }));
}
