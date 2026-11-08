import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { appendStoredRecord, readStoredRecord } from "../content/stored-record.js";
import { PdfNameIndex } from "../cos/name-index.js";
import type { PdfIndexStorage } from "../cos/object-index.js";
import type { PdfFileSource } from "../source.js";
import { decodeFormDataEntities } from "./forms.js";
import { parseRetainedFdf } from "./retained-form-data-fdf.js";
import type { RetainedFormUpdate } from "./retained-form-appearances.js";

/** UTF-16 backing preserves TextDecoder and string-search semantics, including
 * surrogate pairs crossing input chunks, without a resident document string. */
class FormText {
  length=0;
  private readonly base:number;
  constructor(private readonly backing:PagedStorage,private readonly signal:AbortSignal){this.base=backing.allocate(0);}
  async load(source:PdfFileSource){
    const decoder=new TextDecoder();
    const append=async(text:string)=>{
      for(let start=0;start<text.length;start+=4096){
        this.signal.throwIfAborted();const length=Math.min(4096,text.length-start),bytes=new Uint8Array(length*2),view=new DataView(bytes.buffer);
        for(let i=0;i<length;i++)view.setUint16(i*2,text.charCodeAt(start+i),true);
        await this.backing.write(this.backing.allocate(bytes.length),bytes);this.length+=length;
      }
    };
    for await(const chunk of source.stream(0,source.size,this.signal))await append(decoder.decode(chunk,{stream:true}));
    await append(decoder.decode());
  }
  async read(start:number,end:number):Promise<string>{
    let result="";
    for(let at=start;at<end;at+=4096){
      this.signal.throwIfAborted();const length=Math.min(4096,end-at),bytes=await this.backing.read(this.base+at*2,length*2),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
      const units:number[]=[];for(let i=0;i<length;i++)units.push(view.getUint16(i*2,true));result+=String.fromCharCode(...units);
    }
    return result;
  }
  async indexOf(needle:string,start=0):Promise<number>{
    for(let at=start;at<this.length;at+=4096){
      const part=await this.read(at,Math.min(this.length,at+4096+needle.length-1)),index=part.indexOf(needle);if(index>=0)return at+index;
    }
    return -1;
  }
  async prefix(){
    for(let at=0;at<this.length;at+=4096){const part=await this.read(at,Math.min(this.length,at+4096)),trimmed=part.trimStart();if(trimmed)return this.read(at+part.length-trimmed.length,Math.min(this.length,at+part.length-trimmed.length+5));}return "";
  }
}

/** Consume a retained form-data source and yield final fields in first-seen
 * order. Input text, FDF tokens, names and overwrite state use caller storage.
 * Individual field names/values and lexical tokens remain resident. */
export async function* parseRetainedFormData(source:PdfFileSource,storage:PdfIndexStorage,options:{readonly signal?:AbortSignal}={}):AsyncGenerator<RetainedFormUpdate>{
  const signal=options.signal??new AbortController().signal,context={fs:storage.fs,cwd:storage.directory,env:{},signal};
  const textBacking=new PagedStorage(context,2),state=new PagedStorage(context,4),names=new PdfNameIndex(storage,Infinity,signal),values=new IntegerTable(state);
  const text=new FormText(textBacking,signal);let count=0,failed=false,work=0;
  async function checkpoint(){signal.throwIfAborted();if(++work%64===0){await new Promise<void>(resolve=>setTimeout(resolve,0));signal.throwIfAborted();}}
  async function set(name:string,value:string|boolean,append=false){
    await checkpoint();const key=await names.intern(name),at=await values.get(BigInt(key.index));if(key.added)count++;
    if(append&&typeof value==="string"&&at){const previous=(await readStoredRecord<RetainedFormUpdate>(state,Number(at)-1,signal)).value.value;if(typeof previous==="string"&&previous.length)value=`${previous},${value}`;}
    const offset=await appendStoredRecord(state,{name,value},-1,signal);await values.set(BigInt(key.index),BigInt(offset+1));
  }
  try{
    await text.load(source);const prefix=await text.prefix();
    if(prefix==="%FDF-"||(await text.indexOf("/FDF")>=0&&await text.indexOf("/Fields")>=0))await parseRetainedFdf(source,storage,set,signal);
    else if(prefix==="<?xml"||prefix==="<xfdf"||await text.indexOf("<fields")>=0){
      let position=0,head=-1,field="";
      while(position<text.length){
        await checkpoint();const lt=await text.indexOf("<",position);if(lt<0)break;const gt=await text.indexOf(">",lt+1);if(gt<0)break;
        const raw=(await text.read(lt+1,gt)).trim();position=gt+1;
        if(raw.startsWith("?")||raw.startsWith("!"))continue;
        if(raw.startsWith("/")){
          if(raw.slice(1).trim().toLowerCase()==="field"&&head!==-1){const row=(await readStoredRecord<{field:string;previous:number}>(state,head,signal)).value;field=row.field;head=row.previous;}continue;
        }
        const selfClosing=raw.endsWith("/"),tag=selfClosing?raw.slice(0,-1).trim():raw,space=tag.indexOf(" "),name=(space<0?tag:tag.slice(0,space)).toLowerCase();
        if(name==="field"){
          let part="";const at=tag.indexOf("name=");if(at>=0){const quote=tag[at+5];if(quote==='"'||quote==="'"){const end=tag.indexOf(quote,at+6);if(end>=0)part=decodeFormDataEntities(tag.slice(at+6,end));}}
          if(!selfClosing){head=await appendStoredRecord(state,{field,previous:head},-1,signal);field=field&&part?`${field}.${part}`:field||part;}
        }else if(name==="value"&&!selfClosing&&head!==-1){
          const close=await text.indexOf("</value>",position);if(close>=0){const value=decodeFormDataEntities(await text.read(position,close));if(field)await set(field,value==="Off"?false:value==="Yes"||value==="On"?true:value,true);position=close+8;}
        }
      }
    }else{
      const report=await text.indexOf("FieldName:")>=0;let position=0,name="",type="";
      while(position<text.length){
        await checkpoint();const newline=await text.indexOf("\n",position),end=newline<0?text.length:newline,line=(await text.read(position,end)).trim();position=end+1;
        if(report){
          if(line==="---"){name="";type="";}
          else if(line.startsWith("FieldType:"))type=line.slice(10).trim();
          else if(line.startsWith("FieldName:"))name=decodeFormDataEntities(line.slice(10).trim());
          else if(line.startsWith("FieldValue:")&&name){const value=decodeFormDataEntities(line.slice(11).trim());await set(name,value==="Yes"||value==="On"?true:value==="Off"||value==="false"||(type==="Button"&&value==="")?false:value,true);}
        }else{
          if(!line||line.startsWith("#"))continue;const equals=line.indexOf("="),colon=line.indexOf(":"),separator=equals>=0?equals:colon;
          if(separator>0){const name=line.slice(0,separator).trim(),value=line.slice(separator+1).trim();await set(name,value==="true"||value==="Yes"||value==="On"?true:value==="false"||value==="Off"?false:value);}
        }
      }
    }
    for(let index=0;index<count;index++){await checkpoint();yield (await readStoredRecord<RetainedFormUpdate>(state,Number(await values.get(BigInt(index)))-1,signal)).value;}
  }catch(error){failed=true;throw error;}finally{const results=await Promise.allSettled([textBacking.close(),state.close(),names.close()]);if(!failed)for(const result of results)if(result.status==="rejected")await Promise.reject(result.reason);}
}
