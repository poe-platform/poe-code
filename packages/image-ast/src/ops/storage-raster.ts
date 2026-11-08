import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {defaultRuntime} from "@poe-code/compression";

export class Pixels {
  private readonly pages=new Map<number,Uint8Array>();
  private work=0;
  constructor(readonly image:StoredRgbaImage,private readonly storage:ImageByteStorage,private readonly signal:AbortSignal) {}
  async read(offset:number,length:number):Promise<Uint8Array> {
    this.signal.throwIfAborted();
    const bytes=await this.storage.read(this.image.position+offset,length,{signal:this.signal});
    this.signal.throwIfAborted();
    if(!(bytes instanceof Uint8Array) || bytes.length!==length) throw new Error("Truncated image backing storage");
    return new Uint8Array(bytes);
  }
  async pixel(index:number):Promise<number> {
    this.signal.throwIfAborted();
    if(++this.work%16384===0) await defaultRuntime.yieldTurn(this.signal);
    const offset=index*4,page=Math.floor(offset/4096);
    let bytes=this.pages.get(page);
    if(!bytes) {
      bytes=await this.read(page*4096,Math.min(4096,this.image.width*this.image.height*4-page*4096));
      if(this.pages.size===32) this.pages.delete(this.pages.keys().next().value!);
      this.pages.set(page,bytes);
    }
    const local=offset%4096;
    return bytes[local]! | bytes[local+1]!<<8 | bytes[local+2]!<<16 | bytes[local+3]!<<24;
  }
}
export class Output {
  readonly image:StoredRgbaImage;
  private readonly bytes=new Uint8Array(4096);
  private used=0;
  private offset=0;
  private work=0;
  constructor(image:StoredRgbaImage,width:number,height:number,private readonly storage:ImageByteStorage,private readonly signal:AbortSignal) {
    const position=storage.allocate(width*height*4);
    if (!Number.isSafeInteger(position) || position<0 || !Number.isSafeInteger(position+width*height*4)) throw new RangeError("Invalid image backing allocation");
    this.image={...image,position,width,height};
  }
  async pixel(r:number,g:number,b:number,a:number):Promise<void> {
    this.signal.throwIfAborted();
    if(++this.work%16384===0) await defaultRuntime.yieldTurn(this.signal);
    this.bytes[this.used++]=r;this.bytes[this.used++]=g;this.bytes[this.used++]=b;this.bytes[this.used++]=a;
    if(this.used===4096) await this.flush();
  }
  private async flush():Promise<void> {
    this.signal.throwIfAborted();
    if(this.used) await this.storage.write(this.image.position+this.offset,this.bytes.subarray(0,this.used),{signal:this.signal});
    this.signal.throwIfAborted();
    this.offset+=this.used;this.used=0;
  }
  async finish():Promise<StoredRgbaImage> {await this.flush();return this.image;}
}
