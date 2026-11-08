import {PagedStorage} from "@poe-code/safe-fs/storage";
import type {FileSystem} from "@poe-code/safe-fs/contracts";
import type {ImageByteSource} from "../codecs/png-storage.js";

/** Encoded stream snapshot shared by explicitly disposed Sharp clones. */
export class RetainedStreamInput implements ImageByteSource {
 private readonly storage:PagedStorage;
 private readonly start:number;
 private owners=1;
 private length=0;
 private closing?:Promise<void>;
 private readonly aborted=()=>{void this.close().catch(()=>{});};
 constructor(fs:FileSystem,directory:string,private readonly signal:AbortSignal){
  signal.throwIfAborted();this.storage=new PagedStorage({fs,cwd:directory,env:{},signal});
  this.start=this.storage.allocate(0);signal.addEventListener("abort",this.aborted,{once:true});
 }
 get size():number{return this.length;}
 retain():this{this.check();this.owners++;return this;}
 release():Promise<void>{if(--this.owners===0)return this.close();return this.closing??Promise.resolve();}
 private check():void{this.signal.throwIfAborted();if(this.closing)throw new Error("Image stream input is disposed");}
 async append(bytes:Uint8Array):Promise<void>{
  this.check();
  for(let offset=0;offset<bytes.length;offset+=16384){
   this.check();const chunk=new Uint8Array(bytes.subarray(offset,offset+16384));
   await this.storage.append(chunk);this.check();this.length+=chunk.length;
  }
 }
 async read(position:number,length:number,options?:{readonly signal?:AbortSignal}):Promise<Uint8Array>{
  this.check();options?.signal?.throwIfAborted();
  if(!Number.isSafeInteger(position)||position<0||!Number.isSafeInteger(length)||length<0||length>16384||position>this.length-length)throw new RangeError("Invalid image stream range");
  const bytes=await this.storage.read(this.start+position,length);this.check();options?.signal?.throwIfAborted();return bytes;
 }
 /** Only explicit buffer conveniences materialize the encoded input. */
 async bytes():Promise<Uint8Array>{
  this.check();const bytes=new Uint8Array(this.length);
  for(let offset=0;offset<bytes.length;offset+=16384)bytes.set(await this.read(offset,Math.min(16384,bytes.length-offset)),offset);
  return bytes;
 }
 private close():Promise<void>{
  this.signal.removeEventListener("abort",this.aborted);
  return this.closing??=this.storage.close();
 }
}
