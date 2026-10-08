import type {FileSystem} from 'safe-bash-contracts';
import {jsonValues} from 'safe-bash-query-engine/input';
import {Budget,resolveJqLimits} from 'safe-bash-query-engine/limits';
import {Decimal} from 'safe-bash-query-engine/numbers';
import {JsonDocumentStore} from './json-document-store.js';

type NodeType='object'|'array'|'string'|'number'|'boolean'|'null';
export class EmptyJsonDocumentError extends Error {
 constructor(){super('JSON document is empty');}
}
export interface EmbeddingJsonNode {readonly id:number;readonly type:NodeType;readonly start:number;readonly end:number;readonly token:string;}
export interface EmbeddingJsonDocument {
 readonly root:EmbeddingJsonNode;
 child(parent:number,after?:number):Promise<{node:EmbeddingJsonNode;position:number;key:string|number;keyPoints?:number[]}|undefined>;
 text(node:EmbeddingJsonNode):AsyncIterable<string>;
 points(node:EmbeddingJsonNode):AsyncIterable<readonly number[]>;
}
/** Validate a complete JSON document before exposing caller-backed records.
 * Code points remain distinct even when their JavaScript strings look alike. */
export interface JsonDocumentOptions {fs:FileSystem;directory:string;signal:AbortSignal;maxFileBytes:number;maxOpenFiles:number;profile?:'python39'|'javascript';maxControlBytes?:number;}
export async function openJsonDocument(options:JsonDocumentOptions,input:AsyncIterable<Uint8Array>):Promise<EmbeddingJsonDocument&{close():Promise<void>}>{
 const {signal}=options,store=new JsonDocumentStore(options),profile=options.profile??'python39';
 try{
  let root=0,parent=0,stringNode=0;
  const budget=new Budget(resolveJqLimits({maxInputBytes:Infinity,maxValueBytes:Infinity,maxCollectionSize:Infinity,maxSteps:Infinity}),signal);
  for await(const event of jsonValues(input,budget,{stream:true,stringChunks:{maxControlBytes:options.maxControlBytes??65536,containers:true,codePoints:profile==='python39'},profile})){
   signal.throwIfAborted();
   if(!Array.isArray(event)||!Array.isArray(event[0]))throw new Error('Invalid JSON parser event');
   const path=event[0],value=event[1],kind=event[2];
   const points=(text:string)=>Array.from(text,char=>char.codePointAt(0)!);
   const metadata=profile==='python39'?event[3] as {key:number[]|null;points:number[]|null}:{key:typeof path.at(-1)==='string'?points(path.at(-1) as string):null,points:typeof value==='string'?points(value):null};
   const insert=async(type:NodeType,token='')=>{
    const node=await store.insert(type,parent,Number(path.at(-1)),metadata.key,token);
    if(!parent)root=node;
    return node;
   };
   if(kind==='open')parent=await insert(value==='{'?'object':'array');
   else if(kind==='close')parent=await store.parent(parent);
   else if(typeof kind==='boolean'){
    if(typeof value!=='string')throw new Error('Invalid JSON string event');
    stringNode ||= await insert('string');
    if(!metadata.points)throw new Error('Missing JSON code points');
    await store.appendPoints(metadata.points);
    if(kind){await store.endString(stringNode);stringNode=0;}
   }else if(kind===null||kind===undefined&&event.length>1){
    if(value instanceof Decimal)await insert('number',value.text);
    else if(typeof value==='number')await insert('number',String(value));
    else if(value===null)await insert('null');
    else if(typeof value==='boolean')await insert('boolean',String(value));
   }
  }
  if(!root)throw new EmptyJsonDocumentError();
  return {close:store.close.bind(store),root:await store.node(root),child:store.child.bind(store),points:store.points.bind(store),async *text(node){
   for await(const points of store.points(node))yield String.fromCodePoint(...points);
  }};
 }catch(error){await store.close();throw error;}
}

/** Scoped compatibility helper; explicit readers must close their returned lease. */
export async function withEmbeddingJsonDocument<T>(options:JsonDocumentOptions,input:AsyncIterable<Uint8Array>,operation:(document:EmbeddingJsonDocument)=>Promise<T>):Promise<T>{
 const document=await openJsonDocument(options,input);
 try{return await operation(document);}finally{await document.close();}
}
