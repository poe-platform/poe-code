import type {ImageByteSource} from "./png-storage.js";
import {defaultRuntime} from "@poe-code/compression";
/** One owned source page, including while scanning arbitrarily long comments. */
export class SourceBytes {
 private page=-1;
 private bytes:Uint8Array=new Uint8Array();
 private work=0;
 constructor(private readonly source:ImageByteSource,private readonly signal:AbortSignal,private readonly label:string) {
  if(!Number.isSafeInteger(source.size)||source.size<0) throw new RangeError("Invalid image source size");
 }
 async at(position:number):Promise<number|undefined> {
  this.signal.throwIfAborted();
  if(++this.work%16384===0) await defaultRuntime.yieldTurn(this.signal);
  if(position>=this.source.size) return undefined;
  const page=Math.floor(position/4096);
  if(page!==this.page) {
   const length=Math.min(4096,this.source.size-page*4096),bytes=await this.source.read(page*4096,length,{signal:this.signal});this.signal.throwIfAborted();
   if(!(bytes instanceof Uint8Array)||bytes.length!==length) throw new Error(`Truncated ${this.label} source`);
   this.bytes=new Uint8Array(bytes);this.page=page;
  }
  return this.bytes[position%4096];
 }
}
