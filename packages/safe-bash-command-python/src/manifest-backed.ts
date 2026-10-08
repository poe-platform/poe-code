import {openLlmJsonDocument,type LlmJsonNode} from 'safe-bash-command-llm';
import {IntegerTable,PagedStorage} from '@poe-code/safe-fs/storage';
import type {FileSystem} from 'safe-bash-contracts';
import type {PythonPackageRecordSnapshot} from './manifest.js';
import {createPythonRecordReader} from './record-reader.js';

/** Validate on caller storage before exposing any saved package state. */
export async function readBackedPythonManifest(fs:FileSystem,directory:string,signal:AbortSignal,input:AsyncIterable<Uint8Array>):Promise<Omit<PythonPackageRecordSnapshot,'revision'>>{
 const document=await openLlmJsonDocument({fs,directory,signal,maxFileBytes:Number.MAX_SAFE_INTEGER,maxOpenFiles:1,profile:'javascript',maxControlBytes:Number.MAX_SAFE_INTEGER},input);
 const storage=new PagedStorage({fs,cwd:directory,env:{},signal},4),index=new IntegerTable(storage,64);
 const invalid=():never=>{throw new Error('Invalid Python package environment manifest');};
 const close=async()=>{const results=await Promise.allSettled([document.close(),storage.close()]);for(const result of results)if(result.status==='rejected')throw result.reason;};
 async function* children(node:LlmJsonNode){for(let child=await document.child(node.id);child;child=await document.child(node.id,child.position))yield child;}
 const string=async(node:LlmJsonNode)=>{if(node.type!=='string')invalid();let text='';for await(const chunk of document.text(node))text+=chunk;return text;};
 let version:0|1|2|3=0,records:LlmJsonNode|undefined,installedNode=document.root,recordCount=-1;
 try{
  if(document.root.type!=='array'){
   if(document.root.type!=='object')invalid();
   let count=0,found=false;
   for await(const {node,key} of children(document.root)){
    count++;
    if(key==='version'){const value=Number(node.token);if(node.type!=='number'||![1,2,3].includes(value))invalid();version=value as 1|2|3;}
    else if(key==='installed'){installedNode=node;found=true;}
    else if(key==='records')records=node;
    else invalid();
   }
   if(!found||!version||count!==(version===1?2:3)||version!==1&&!records)invalid();
  }
  if(installedNode.type!=='array')invalid();
  const installed:string[]=[];
  for await(const {node} of children(installedNode))installed.push(await string(node));
  if(records){
   if(records.type!=='array')invalid();recordCount=0;let previous=-1;
   for await(const entry of children(records)){
    const row=entry.node;if(row.type!=='array')invalid();let field=0;
    for await(const {node} of children(row)){
     if(field===3||field===4){if(node.type!=='array')invalid();for await(const {node:item} of children(node))if(item.type!=='string')invalid();}
     else if(node.type!=='string'&&!(field===5&&node.type==='null'))invalid();
     field++;
    }
    if(field!==version+3)invalid();
    await index.set(BigInt(recordCount++),BigInt(previous+1));previous=entry.position;
   }
  }
  const encoder=new TextEncoder();
  async function* json(node:LlmJsonNode|undefined,legacy=false):AsyncGenerator<string>{
   if(!node||node.type==='null'){yield 'null';return;}
   if(node.type==='string'){yield '"';for await(const text of document.text(node))for(let offset=0;offset<text.length;offset+=1024)yield JSON.stringify(text.slice(offset,offset+1024)).slice(1,-1);yield '"';return;}
   yield '[';let count=0;for await(const {node:item} of children(node)){if(count++)yield ',';yield* json(item);}if(legacy)yield ',null';yield ']';
  }
  const reader=createPythonRecordReader(async function*(key:number){
   const ordinal=Math.floor(key/7),field=key%7-1;
   const previous=await index.get(BigInt(ordinal));
   if(previous===undefined)invalid();
   const entry=await document.child(records!.id,Number(previous)-1);if(!entry)invalid();
   let selected:LlmJsonNode|undefined=entry!.node;
   if(field>=0){selected=undefined;let position=0;for await(const {node} of children(entry!.node))if(position++===field){selected=node;break;}}
   for await(const part of json(selected,field<0&&version===2))yield encoder.encode(part);
  });
  const read=async(ordinal:number,offset:number,field=-1)=>{if(!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>=recordCount||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(field)||field< -1||field>5)invalid();return reader.read(ordinal*7+field+1,offset);};
  return {installed,version,recordCount,readRecord:read,async readField(ordinal,field,offset){if(field<0)invalid();return read(ordinal,offset,field);},async close(){try{await reader.close();}finally{await close();}}};
 }catch(error){await close();throw error;}
}
