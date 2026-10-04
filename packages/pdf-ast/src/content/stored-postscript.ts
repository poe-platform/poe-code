import type { PagedStorage } from "@poe-code/safe-fs/storage";
import type { PdfFunctionSource } from "./evaluator.js";
import { PostScriptToken as token } from "../vendor/pdfjs-fonts.mjs";
import { PdfError } from "../errors.js";

/** Compile forward-only calculator control flow without a resident syntax tree.
 * Instructions and suspended parser frames share caller-backed fixed records. */
export async function compileStoredPostScript(source:PdfFunctionSource,storage:PagedStorage,
  admit:(bytes:number)=>void,signal?:AbortSignal):Promise<PdfFunctionSource>{
  let cursor=0,pageAt=-1,turns=0;let page:Uint8Array=new Uint8Array();
  async function byte():Promise<number>{
    signal?.throwIfAborted();
    if(cursor>=source.size)return -1;
    if(cursor<pageAt||cursor>=pageAt+page.length){pageAt=cursor;page=await source.read(cursor,Math.min(4096,source.size-cursor),signal);if(!page.length)throw new PdfError("E_PARSE","Truncated PostScript source");}
    if(++turns%16384===0){await new Promise<void>(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}
    return page[cursor++-pageAt]!;
  }
  const digit=(ch:number)=>ch>=48&&ch<=57;
  async function next():Promise<{id:number;value:number}>{
    let ch=await byte();
    for(;;){
      if([0,9,10,12,13,32].includes(ch)){ch=await byte();continue;}
      if(ch===37){do{ch=await byte();}while(ch!==-1&&ch!==10&&ch!==13);continue;}
      break;
    }
    if(ch===-1)return {id:token.eof!,value:0};
    if(ch===123)return {id:token.lbrace!,value:0};
    if(ch===125)return {id:token.rbrace!,value:0};
    if(ch>=97&&ch<=122){
      let name="",length=0;
      do{if(length++<16)name+=String.fromCharCode(ch);ch=await byte();}while(ch>=97&&ch<=122);
      if(ch!==-1)cursor--;
      const id=length<=16?token[name]:undefined;
      return {id:id!==undefined&&id>=token.true!&&id<=token.ifelse!?id:token.number!,value:0};
    }
    if(!digit(ch)&&ch!==43&&ch!==45&&ch!==46)return {id:token.number!,value:0};
    const start=cursor-1;let sign="",significand="",digits=0,fraction=0,nonzero=false,point=false;
    if(ch===43||ch===45){sign=ch===45?"-":"";ch=await byte();}
    while(digit(ch)||ch===46&&!point){
      if(ch===46)point=true;
      else {if(point)fraction++;if(ch!==48||nonzero){nonzero=true;digits++;if(significand.length<1200)significand+=String.fromCharCode(ch);}}
      ch=await byte();
    }
    let exponent=0;
    if(ch===69||ch===101){
      const exponentAt=cursor-1;let exponentSign=1;ch=await byte();
      if(ch===43||ch===45){exponentSign=ch===45?-1:1;ch=await byte();}
      if(digit(ch)){do{exponent=Math.min(Number.MAX_SAFE_INTEGER,exponent*10+ch-48);ch=await byte();}while(digit(ch));exponent*=exponentSign;}
      else {cursor=exponentAt;ch=-1;}
    }
    if(ch!==-1)cursor--;
    if(cursor<=start)throw new PdfError("E_PARSE","Invalid PostScript number");
    const value=Number(sign+(significand||"0")+"e"+(exponent-fraction+digits-significand.length));
    return {id:token.number!,value:Number.isFinite(value)?value:0};
  }
  function fail():never{throw new PdfError("E_PARSE","Invalid PostScript procedure structure");}
  if((await next()).id!==token.lbrace)fail();
  const base=storage.allocate(0);let tail=-1;
  async function record(values:readonly number[]){admit(32);const at=storage.allocate(32)-base,bytes=new Uint8Array(32),view=new DataView(bytes.buffer);for(let i=0;i<4;i++)view.setFloat64(i*8,values[i]??0,true);await storage.write(base+at,bytes);return at;}
  async function patch(at:number,offset:number,value:number){const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,value,true);await storage.write(base+at+offset,bytes);}
  async function emit(kind:number,value=0,target=-1){const at=await record([kind,-1,value,target]);if(tail>=0)await patch(tail,8,at);tail=at;return at;}
  // [parent-frame, branch instruction, else phase, skip-else instruction].
  let parent=-1,branch=-1,phase=0,jump=-1;
  await emit(0);
  for(;;){
    const current=await next();
    if(current.id===token.number){await emit(1,current.value);continue;}
    if(current.id>=token.true!&&current.id<token.if!){await emit(2,current.id);continue;}
    if(current.id===token.lbrace){
      parent=await record([parent,branch,phase,jump]);branch=await emit(3);phase=0;jump=-1;continue;
    }
    if(current.id!==token.rbrace)fail();
    if(branch<0){await next();break;}
    const following=await next();
    if(phase===0&&following.id===token.lbrace){
      jump=await emit(4);const otherwise=await emit(0);await patch(branch,24,otherwise);phase=1;continue;
    }
    if(following.id!==(phase===0?token.if:token.ifelse))fail();
    const end=await emit(0);await patch(phase===0?branch:jump,24,end);
    const bytes=await storage.read(base+parent,32),frame=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    parent=frame.getFloat64(0,true);branch=frame.getFloat64(8,true);phase=frame.getFloat64(16,true);jump=frame.getFloat64(24,true);
  }
  const size=storage.allocate(0)-base;
  return {size,format:"postscript",read(at,length,selected){signal?.throwIfAborted();selected?.throwIfAborted();return storage.read(base+at,length);}};
}
