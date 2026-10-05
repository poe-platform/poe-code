import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { decodePdfString } from "../ast.js";
import { appendStoredRecord, readStoredRecord } from "../content/stored-record.js";
import { CosRangeLexer, type CosToken } from "../cos/lexer.js";
import { PdfNameIndex } from "../cos/name-index.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfFileSource } from "../source.js";

type Value = string | boolean;
type DictFrame = { kind: "dict"; prefix: string; partial: string; value: Value; hasValue: boolean; children: number };
type Frame = DictFrame | { kind: "scan" } | { kind: "restore"; cursor: number } | { kind: "range"; end: number; prefix: string } | { kind: "children"; start: number; end: number; refs: number; prefix: string } | { kind: "ref"; object: number; prefix: string };
type Child = { start: number; end: number; refs: number; previous: number };

/** Preserve the permissive FDF token grammar with caller-backed token, object,
 * visited-reference and continuation tables instead of resident arrays/recursion. */
export async function parseRetainedFdf(source: PdfFileSource, storage: PdfIndexStorage, set: (name: string, value: Value) => Promise<void>, signal: AbortSignal): Promise<void> {
  const backing = new PagedStorage({fs:storage.fs,cwd:storage.directory,env:{},signal},4), tokens = new IntegerTable(backing), starts = new IntegerTable(backing), children = new IntegerTable(backing), visited = new IntegerTable(backing), names = new PdfNameIndex(storage,Infinity,signal);
  let count=0, cursor=0, head=-1, work=0, failed=false;
  const cache = new Map<number,CosToken>();
  async function checkpoint(){signal.throwIfAborted();if(++work%128===0){await new Promise<void>(resolve=>setTimeout(resolve,0));signal.throwIfAborted();}}
  async function token(index:number):Promise<CosToken|undefined>{
    if(index<0||index>=count)return;
    const cached=cache.get(index);if(cached)return cached;
    const at=Number(await tokens.get(BigInt(index)))-1, result=(await readStoredRecord<CosToken>(backing,at,signal)).value;
    if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(index,result);return result;
  }
  async function objectKey(object:number){return BigInt((await names.intern(String(object))).index);}
  async function push(frame:Frame){head=await appendStoredRecord(backing,{frame,previous:head},-1,signal);}
  function dict(prefix:string):DictFrame{return {kind:"dict",prefix,partial:"",value:"",hasValue:false,children:-1};}
  function text(token:CosToken):string{return token.kind==="name"?token.decoded:token.kind==="string"||token.kind==="hex-string"?decodePdfString({kind:"string",bytes:token.bytes,encoding:token.kind==="string"?"literal":"hex"}):"";}
  async function reference(index:number){const a=await token(index),b=await token(index+1),c=await token(index+2);return a?.kind==="number"&&b?.kind==="number"&&c?.kind==="keyword"&&c.value==="R"?a.value:undefined;}
  try{
    const lexer=new CosRangeLexer(source,{signal,compactNumbers:true});
    for(let next=await lexer.nextToken();next;next=await lexer.nextToken()){
      await checkpoint();const at=await appendStoredRecord(backing,next,-1,signal);await tokens.set(BigInt(count++),BigInt(at+1));
    }
    for(let i=0;i<count;i++){
      await checkpoint();const a=await token(i),b=await token(i+1),c=await token(i+2),d=await token(i+3);
      if(a?.kind==="number"&&b?.kind==="number"&&c?.kind==="keyword"&&c.value==="obj"&&d?.kind==="dict-start")await starts.set(await objectKey(a.value),BigInt(i+5));
      if(a?.kind==="name"&&a.decoded==="Kids"&&b?.kind==="array-start"){
        let depth=1;
        for(let k=i+2;k<count&&depth>0;k++){
          await checkpoint();const next=await token(k);
          if(next?.kind==="array-start")depth++;else if(next?.kind==="array-end")depth--;else if(depth===1){const ref=await reference(k);if(ref!==undefined){await children.set(await objectKey(ref),1n);k+=2;}}
        }
      }
    }
    await push({kind:"scan"});
    while(head!==-1){
      await checkpoint();const record=await readStoredRecord<{frame:Frame;previous:number}>(backing,head,signal);head=record.value.previous;const frame=record.value.frame;
      if(frame.kind==="restore"){cursor=frame.cursor;continue;}
      if(frame.kind==="ref"){
        const key=await objectKey(frame.object),start=await starts.get(key);
        if(start&&!await visited.get(key)){await visited.set(key,1n);cursor=Number(start)-1;await push(dict(frame.prefix));}continue;
      }
      if(frame.kind==="children"){
        let ref=frame.refs;while(ref!==-1){const row=await readStoredRecord<{object:number;previous:number}>(backing,ref,signal);await push({kind:"ref",object:row.value.object,prefix:frame.prefix});ref=row.value.previous;}
        cursor=frame.start;await push({kind:"range",end:frame.end,prefix:frame.prefix});continue;
      }
      if(frame.kind==="scan"||frame.kind==="range"){
        const end=frame.kind==="range"?frame.end:count;
        while(cursor<end){
          await checkpoint();const a=await token(cursor);
          if(frame.kind==="scan"&&a?.kind==="number"){
            const b=await token(cursor+1),c=await token(cursor+2);
            if(b?.kind==="number"&&c?.kind==="keyword"&&c.value==="obj"){
              const key=await objectKey(a.value);
              if(await children.get(key)||await visited.get(key)){
                cursor+=3;while(cursor<count){await checkpoint();const t=await token(cursor++);if(t?.kind==="keyword"&&t.value==="endobj")break;}continue;
              }
            }
          }
          cursor++;if(a?.kind==="dict-start"){await push(frame);await push(dict(frame.kind==="range"?frame.prefix:""));break;}
        }continue;
      }
      let nested=false;
      while(cursor<count){
        await checkpoint();const next=await token(cursor++);if(next?.kind==="dict-end")break;
        if(next?.kind==="dict-start"){
          await push(frame);await push(dict(frame.prefix&&frame.partial?`${frame.prefix}.${frame.partial}`:frame.partial||frame.prefix));nested=true;break;
        }
        if(next?.kind!=="name")continue;
        const value=await token(cursor);
        if(next.decoded==="T"&&(value?.kind==="string"||value?.kind==="hex-string"||value?.kind==="name")){frame.partial=text(value);cursor++;}
        else if(next.decoded==="V"&&value){
          if(value.kind==="string"||value.kind==="hex-string"||value.kind==="name"){
            const decoded=text(value);frame.value=value.kind==="name"?(decoded==="Off"?false:decoded==="Yes"||decoded==="On"?true:decoded):decoded;frame.hasValue=true;cursor++;
          }else if(value.kind==="number"||value.kind==="boolean"){frame.value=value.kind==="number"?String(value.value):value.value;frame.hasValue=true;cursor++;}
          else if(value.kind==="array-start"){
            cursor++;let depth=1,joined="",items=0;
            while(cursor<count&&depth>0){await checkpoint();const t=await token(cursor++);if(t?.kind==="array-start")depth++;else if(t?.kind==="array-end")depth--;else if(depth===1&&t&&(t.kind==="string"||t.kind==="hex-string"||t.kind==="name")){joined+=(items++?",":"")+text(t);}}
            frame.value=joined;frame.hasValue=true;
          }
        }else if((next.decoded==="Kids"||next.decoded==="Fields")&&value?.kind==="array-start"){
          cursor++;const start=cursor;let depth=1,refs=-1;
          while(cursor<count&&depth>0){
            await checkpoint();const t=await token(cursor++);if(t?.kind==="array-start")depth++;else if(t?.kind==="array-end")depth--;else if(depth===1){const ref=await reference(cursor-1);if(ref!==undefined){refs=await appendStoredRecord(backing,{object:ref,previous:refs},-1,signal);cursor+=2;}}
          }
          frame.children=await appendStoredRecord(backing,{start,end:cursor-1,refs,previous:frame.children},-1,signal);
        }
      }
      if(nested)continue;
      const name=frame.prefix&&frame.partial?`${frame.prefix}.${frame.partial}`:frame.partial||frame.prefix;
      if(name&&frame.hasValue)await set(name,frame.value);
      if(frame.children!==-1){await push({kind:"restore",cursor});let child=frame.children;while(child!==-1){const row=(await readStoredRecord<Child>(backing,child,signal)).value;await push({kind:"children",start:row.start,end:row.end,refs:row.refs,prefix:name});child=row.previous;}}
    }
  }catch(error){failed=true;throw error;}finally{const results=await Promise.allSettled([backing.close(),names.close()]);if(!failed)for(const result of results)if(result.status==="rejected")await Promise.reject(result.reason);}
}
