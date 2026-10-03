import type {FileSystem} from 'safe-bash-contracts';
import {jsonValues,decodeUtf8,encodePythonCodePoints} from 'safe-bash-query-engine/input';
import {decodeLatin1} from 'safe-bash-query-engine/bytes';
import {Budget,resolveJqLimits} from 'safe-bash-query-engine/limits';
import {Decimal} from 'safe-bash-query-engine/numbers';
import {createPrivateSqliteStorage,withPrivateSqliteSession,withSqliteStatement} from 'safe-bash-sqlite-engine/storage';
import {createLlmSpool} from './retained-spool.js';

type NodeType='object'|'array'|'string'|'number'|'boolean'|'null';
export interface EmbeddingJsonNode {readonly id:number;readonly type:NodeType;readonly start:number;readonly end:number;readonly token:string;}
export interface EmbeddingJsonDocument {
 readonly root:EmbeddingJsonNode;
 child(parent:number,after?:number):Promise<{node:EmbeddingJsonNode;position:number;key:string|number;keyPoints?:number[]}|undefined>;
 text(node:EmbeddingJsonNode):AsyncIterable<string>;
 points(node:EmbeddingJsonNode):AsyncIterable<readonly number[]>;
}
/** Validate a complete JSON document before exposing it. Retained code-point payloads
 * preserve individual surrogate code points until the consuming encoder handles them. */
export async function withEmbeddingJsonDocument<T>(options:{fs:FileSystem;directory:string;signal:AbortSignal;maxFileBytes:number;maxOpenFiles:number},input:AsyncIterable<Uint8Array>,operation:(document:EmbeddingJsonDocument)=>Promise<T>):Promise<T>{
 const {fs,directory,signal}=options;
 const storage=await createPrivateSqliteStorage({...options,maxFiles:options.maxOpenFiles});
 try{return await withPrivateSqliteSession({...options,fs:storage.fs,directory:storage.directory,path:storage.directory+'/json'},async session=>{
  await session.execute('CREATE TABLE nodes(id INTEGER PRIMARY KEY,type TEXT,start INTEGER,end INTEGER,token TEXT); CREATE TABLE children(parent INTEGER,key BLOB,node INTEGER,position INTEGER,PRIMARY KEY(parent,key)); CREATE INDEX child_order ON children(parent,position)');
  const spool=await createLlmSpool(fs,directory,signal,'input');
  try{
   const execute=async(sql:string,bindings:readonly (string|number|Uint8Array)[])=>withSqliteStatement(session.module,{...session,signal,sql},async statement=>{for await(const ignored of statement.rows(bindings,[]))signal.throwIfAborted();});
   let serial=0,size=0,root:EmbeddingJsonNode|undefined,stringNode:EmbeddingJsonNode|undefined;const stack:number[]=[];
   const insert=async(type:NodeType,key:unknown,token='',keyPoints?:number[]|null)=>{
    const node={id:serial++,type,start:size,end:size,token};
    await execute('INSERT INTO nodes VALUES(?,?,?,?,?)',[node.id,type,size,size,token]);
    const parent=stack.at(-1);
    if(parent===undefined)root=node;
    else await execute('INSERT INTO children VALUES(?,?,?,?) ON CONFLICT(parent,key) DO UPDATE SET node=excluded.node',[parent,keyPoints?encodePythonCodePoints([1,...keyPoints]):new TextEncoder().encode("0"+String(key)),node.id,node.id]);
    return node;
   };
   const budget=new Budget(resolveJqLimits({maxInputBytes:Infinity,maxValueBytes:Infinity,maxCollectionSize:Infinity,maxSteps:Infinity}),signal);
   for await(const event of jsonValues(input,budget,{stream:true,stringChunks:{maxControlBytes:65536,containers:true,codePoints:true},profile:'python39'})){
    signal.throwIfAborted();
    if(!Array.isArray(event)||!Array.isArray(event[0]))throw new Error('Invalid JSON parser event');
    const path=event[0],value=event[1],kind=event[2],metadata=event[3] as {key:number[]|null;points:number[]|null};
    if(kind==='open'){const node=await insert(value==='{'?'object':'array',path.at(-1),'',metadata.key);stack.push(node.id);}
    else if(kind==='close')stack.pop();
    else if(typeof kind==='boolean'){
     if(typeof value!=='string')throw new Error('Invalid JSON string event');
     stringNode??=await insert('string',path.at(-1),'',metadata.key);
     const points=metadata.points;if(!points)throw new Error('Missing JSON code points');
     const bytes=new Uint8Array(points.length*4),view=new DataView(bytes.buffer);
     for(let i=0;i<points.length;i++)view.setUint32(i*4,points[i]!,true);
     await spool.write(bytes);size+=bytes.length;
     if(!Number.isSafeInteger(size))throw new RangeError('JSON staging byte range exceeds safe integer');
     if(kind){await execute('UPDATE nodes SET end=? WHERE id=?',[size,stringNode.id]);if(stringNode.id===root?.id)root={...stringNode,end:size};stringNode=undefined;}
    }else if(kind===null){
     if(value instanceof Decimal)await insert('number',path.at(-1),value.text,metadata.key);
     else if(typeof value==='number')await insert('number',path.at(-1),String(value),metadata.key);
     else if(value===null)await insert('null',path.at(-1),'',metadata.key);
     else if(typeof value==='boolean')await insert('boolean',path.at(-1),String(value),metadata.key);
    }
   }
   async function* points(node:EmbeddingJsonNode):AsyncIterable<readonly number[]>{
    if(node.type!=='string')throw new TypeError('JSON node is not a string');
    let unit=0,count=0;
    for await(const bytes of spool.replay(async()=>({start:node.start,end:node.end}))){const values:number[]=[];for(const byte of bytes){unit+=byte*2**(count++*8);if(count===4){values.push(unit);unit=0;count=0;}}if(values.length)yield values;}
    if(count)throw new Error('Truncated JSON staging code point');
   }
   if(!root)throw new Error('JSON document is empty');
   return await operation({root,async child(parent,after=-1){
    let child:{node:EmbeddingJsonNode;position:number;key:string|number;keyPoints?:number[]}|undefined;
    await withSqliteStatement(session.module,{...session,signal,sql:'SELECT n.id,n.type,n.start,n.end,n.token,c.position,c.key FROM children c JOIN nodes n ON n.id=c.node WHERE c.parent=? AND c.position>? ORDER BY c.position LIMIT 1'},async statement=>{
     for await(const [id,type,start,end,token,position,key]of statement.rows([parent,after],['integer','text','integer','integer','text','integer','blob'])){const bytes=key as Uint8Array,keyPoints:number[]=[];const decoded=decodeUtf8(decodeLatin1(bytes),budget,'surrogatepass',keyPoints);child={node:{id:Number(id),type:type as NodeType,start:Number(start),end:Number(end),token:String(token)},position:Number(position),key:keyPoints[0]===1?decoded.slice(1):Number(decoded.slice(1)),...(keyPoints[0]===1?{keyPoints:keyPoints.slice(1)}:{})};}
    });return child;
   },points,async *text(node){
    for await(const values of points(node))yield String.fromCodePoint(...values);
   }});
  }finally{await spool.close();}
 });}finally{await storage.close();}
}
