import {FsError} from 'safe-bash-contracts';
import {withSqliteQueryRecords,type SqliteRecordValue} from 'safe-bash-sqlite-engine/storage';
import type {LlmCollectionBatchEntry} from './collections-batch.js';
import {floatText} from './embed-output.js';

/** SQL rows preserve Python dictionary column ordering. Payloads remain borrowed
 * caller-backed field streams; only the bounded collection ID is materialized. */
export async function withSqlEmbeddingEntries<T>(options:Parameters<typeof withSqliteQueryRecords>[0]&{prefix?:string;prepend?:string;admit?:(bytes:number)=>void},operation:(entries:AsyncIterable<LlmCollectionBatchEntry>)=>Promise<T>):Promise<T>{
 const {signal}=options,encoder=new TextEncoder();
 return withSqliteQueryRecords(options,async(rows,columns)=>{
  const positions=new Map<string,number>();for(let index=0;index<columns.length;index++)positions.set(columns[index]!,index);
  const selected=[...positions.values()];
  const id=async(value:SqliteRecordValue):Promise<string>=>{
   if(value===null)return 'None';if(typeof value==='bigint')return String(value);if(typeof value==='number')return Number.isFinite(value)?floatText(value):value>0?'inf':'-inf';
   if(value.size>65536)throw new RangeError('Embedding ID exceeds SQLite control byte limit');
   if(value.type==='text'){
    const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});let text='';for await(const bytes of value.bytes)text+=decoder.decode(bytes,{stream:true});return text+decoder.decode();
   }
   const bytes=new Uint8Array(value.size);let offset=0;for await(const part of value.bytes){bytes.set(part,offset);offset+=part.length;}
   const quote=bytes.includes(39)&&!bytes.includes(34)?34:39;let text='b'+String.fromCharCode(quote);
   for(const byte of bytes){text+=byte===quote||byte===92?'\\'+String.fromCharCode(byte):byte===9?'\\t':byte===10?'\\n':byte===13?'\\r':byte>=32&&byte<127?String.fromCharCode(byte):'\\x'+byte.toString(16).padStart(2,'0');if(text.length>65536)throw new RangeError('Embedding ID exceeds SQLite control byte limit');}
   return text+String.fromCharCode(quote);
  };
  const entries=async function*():AsyncGenerator<LlmCollectionBatchEntry>{
   for await(const row of rows){
    const values=selected.map(index=>row[index]!);
    if(!values.length)throw new RangeError('list index out of range');
    const identifier=(options.prefix??'')+await id(values[0]!);
    if(encoder.encode(identifier).length>65536)throw new RangeError('Embedding ID exceeds SQLite control byte limit');
    const fields=values.slice(1);
    for(let index=0;index<fields.length;index++){
     const field=fields[index]!;
     if(field===null||field===0n||field===0||typeof field==='object'&&field.size===0)continue;
     if(typeof field!=='object'||field.type!=='text')throw new TypeError('sequence item '+index+': expected str instance, '+(typeof field==='bigint'?'int':typeof field==='number'?'float':'bytes')+' found');
     const decoder=new TextDecoder('utf-8',{fatal:true});for await(const bytes of field.bytes)decoder.decode(bytes,{stream:true});decoder.decode();
    }
    let active=true,consumed=false;
    try{yield {id:identifier,input:{async dispose(){active=false;},bytes:{async *[Symbol.asyncIterator](){
     const check=()=>{signal.throwIfAborted();if(!active)throw new FsError('EBADF',{message:'SQL row lease is closed'});};check();if(consumed)throw new FsError('EBADF',{message:'SQL row lease is closed'});consumed=true;
     const prefix=options.prepend??'';
     for(let offset=0;offset<prefix.length;){check();let end=Math.min(offset+4096,prefix.length);const last=prefix.charCodeAt(end-1);if(end<prefix.length&&last>=0xd800&&last<=0xdbff)end--;const bytes=encoder.encode(prefix.slice(offset,end));options.admit?.(bytes.length);yield bytes;offset=end;}
     for(let index=0;index<fields.length;index++){
      check();if(index){options.admit?.(1);yield Uint8Array.of(32);}
      const field=fields[index]!;if(field&&typeof field==='object')for await(const bytes of field.bytes){check();options.admit?.(bytes.length);yield bytes;}
     }
    }}}};}finally{active=false;}
   }
  };
  const iterator=entries();
  try{return await operation({[Symbol.asyncIterator]:()=>iterator});}finally{await iterator.return(undefined);}
 });
}
