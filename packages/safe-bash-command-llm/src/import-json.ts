import {pythonSurrogateId} from './python-unicode.js';
import type {FileSystem} from 'safe-bash-contracts';
import {FsError} from 'safe-bash-contracts';
import {withEmbeddingJsonDocument,type EmbeddingJsonNode,type EmbeddingJsonDocument} from './import-json-document.js';
import type {LlmCollectionBatchEntry} from './collections-batch.js';
import {floatText} from './embed-output.js';
import {isPythonPrintable} from './python-printable.js';

export async function withJsonEmbeddingEntries<T>(options:{fs:FileSystem;directory:string;signal:AbortSignal;maxFileBytes:number;maxOpenFiles:number;prefix?:string;prepend?:string},input:AsyncIterable<Uint8Array>,operation:(entries:AsyncIterable<LlmCollectionBatchEntry>)=>Promise<T>):Promise<T>{
 return withEmbeddingJsonDocument(options,input,async document=>{
  if(document.root.type!=='object'&&document.root.type!=='array')throw new TypeError('JSON must be a list or a dictionary');
  return withEmbeddingJsonRows(options,document,operation);
 });
}

/** The CLI's first pass counts raw rows without converting IDs or content. */
export async function countJsonEmbeddingRows(options:Parameters<typeof withJsonEmbeddingEntries>[0],input:AsyncIterable<Uint8Array>):Promise<number>{
 return withEmbeddingJsonDocument(options,input,async document=>{
  if(document.root.type==='object')return 1;
  if(document.root.type!=='array')throw new TypeError('JSON must be a list or a dictionary');
  let count=0,position=-1;
  while(true){const next=await document.child(document.root.id,position);if(!next)return count;position=next.position;count++;}
 });
}

/** Borrow rows from an already validated document; JSONL treats its root as one row. */
export async function withEmbeddingJsonRows<T>(options:Parameters<typeof withJsonEmbeddingEntries>[0],document:EmbeddingJsonDocument,operation:(entries:AsyncIterable<LlmCollectionBatchEntry>)=>Promise<T>,singleRow=false):Promise<T>{
  const encoder=new TextEncoder();
  const floating=(token:string)=>token.includes('.')||token.includes('e')||token.includes('E')||token==='NaN'||token.endsWith('Infinity');
  const string=async(node:EmbeddingJsonNode)=>{let value='';const points:number[]=[];for await(const chunk of document.points(node)){points.push(...chunk);value+=String.fromCodePoint(...chunk);if(value.length>65536)throw new RangeError('Embedding ID exceeds SQLite control byte limit');}if(encoder.encode(value).length>65536)throw new RangeError('Embedding ID exceeds SQLite control byte limit');return {value,points};};
  const quoted=(value:string,points:readonly number[]=Array.from(value,char=>char.codePointAt(0)!))=>{
   const quote=value.includes("'")&&!value.includes('"')?'"':"'";let result=quote;
   for(const point of points){const char=String.fromCodePoint(point);options.signal.throwIfAborted();
    result+=char===quote||char==='\\'?'\\'+char:char==='\n'?'\\n':char==='\r'?'\\r':char==='\t'?'\\t':isPythonPrintable(point)?char:'\\'+(point<256?'x'+point.toString(16).padStart(2,'0'):point<65536?'u'+point.toString(16).padStart(4,'0'):'U'+point.toString(16).padStart(8,'0'));
   }return result+quote;
  };
  const bounded=(value:string)=>{if(value.length>65536||encoder.encode(value).length>65536)throw new RangeError('Embedding ID exceeds SQLite control byte limit');return value;};
  let invalidId=false;
  const id=async(node:EmbeddingJsonNode,nested=false):Promise<string>=>{
   if(node.type==='string'){
    const {value,points}=await string(node);if(nested)return bounded(quoted(value,points));
    invalidId=points.some(point=>point>=0xd800&&point<=0xdfff);return value;
   }
   if(node.type==='null')return 'None';
   if(node.type==='boolean')return node.token==='true'?'True':'False';
   if(node.type==='number'){
    if(node.token==='NaN')return 'nan';if(node.token==='Infinity')return 'inf';if(node.token==='-Infinity')return '-inf';
    if(!floating(node.token))return BigInt(node.token).toString();
    const value=Number(node.token);return Number.isFinite(value)?floatText(value):value<0?'-inf':'inf';
   }
   let result=node.type==='array'?'[':'{',after=-1,count=0;
   while(true){const next=await document.child(node.id,after);if(!next)break;after=next.position;
    result=bounded(result+(count++?', ':'')+(node.type==='object'?quoted(String(next.key),next.keyPoints)+': ':'')+await id(next.node,true));
   }
   return bounded(result+(node.type==='array'?']':'}'));
  };
  async function* content(node:EmbeddingJsonNode,index:number):AsyncIterable<Uint8Array>{
   if(node.type==='string'){
    for await(const points of document.points(node)){
     if(points.some(point=>point>=0xd800&&point<=0xdfff))throw new TypeError('surrogates not allowed');
     if(points.length)yield encoder.encode(String.fromCodePoint(...points));
    }
    return;
   }
   if(node.type==='null'||node.type==='boolean'&&node.token==='false'||node.type==='number'&&Number(node.token)===0)return;
   if((node.type==='array'||node.type==='object')&&!await document.child(node.id))return;
   const type=node.type==='array'?'list':node.type==='object'?'dict':node.type==='boolean'?'bool':floating(node.token)?'float':'int';
   throw new TypeError(`sequence item ${index}: expected str instance, ${type} found`);
  }
  const entries={async *[Symbol.asyncIterator]():AsyncGenerator<LlmCollectionBatchEntry>{
   let position=-1;
   while(true){
    const child=singleRow||document.root.type==='object'?undefined:await document.child(document.root.id,position);
    const row=singleRow||document.root.type==='object'?(position<0?document.root:undefined):child?.node;
    if(!row)break;
    position=child?.position??row.id;
    if(row.type!=='object')throw new TypeError(`'${row.type==='array'?'list':row.type==='null'?'NoneType':row.type==='boolean'?'bool':row.type==='string'?'str':floating(row.token)?'float':'int'}' object has no attribute 'values'`);
    const first=await document.child(row.id);if(!first)throw new RangeError('list index out of range');
    invalidId=false;
    const identifier=(options.prefix??'')+await id(first.node);let active=true,consumed=false;
    try{yield {id:identifier,...(invalidId?{[pythonSurrogateId]:true as const}:{}),input:{async dispose(){active=false;},bytes:{async *[Symbol.asyncIterator](){
     if(!active||consumed)throw new FsError('EBADF',{message:'JSON row lease is closed'});consumed=true;
     if(options.prepend)for(let offset=0;offset<options.prepend.length;){if(!active)throw new FsError('EBADF',{message:'JSON row lease is closed'});options.signal.throwIfAborted();let end=Math.min(offset+4096,options.prepend.length);const last=options.prepend.charCodeAt(end-1);if(end<options.prepend.length&&last>=0xd800&&last<=0xdbff)end--;yield encoder.encode(options.prepend.slice(offset,end));offset=end;}
     let after=first.position,index=0;
     while(true){
      options.signal.throwIfAborted();if(!active)throw new FsError('EBADF',{message:'JSON row lease is closed'});
      const next=await document.child(row.id,after);if(!next)break;after=next.position;
      if(index)yield Uint8Array.of(32);
      for await(const bytes of content(next.node,index++)){if(!active)throw new FsError('EBADF',{message:'JSON row lease is closed'});yield bytes;}
     }
    }}}};}finally{active=false;}
   }
  }};
  const iterator=entries[Symbol.asyncIterator]();try{return await operation({[Symbol.asyncIterator]:()=>iterator});}finally{await iterator.return(undefined);}
}
