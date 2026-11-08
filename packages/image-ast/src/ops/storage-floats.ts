import {defaultRuntime} from "@poe-code/compression";
import type {ImageByteStorage} from "../codecs/png-storage.js";

export interface StoredFloats {readonly position:number;readonly length:number;}

/** Float32 values use explicit little-endian storage and an owned 128 KiB cache. */
export class FloatReader {
  private readonly pages=new Map<number,DataView>();
  private work=0;
  constructor(private readonly values:StoredFloats,private readonly storage:ImageByteStorage,private readonly signal:AbortSignal) {}
  async value(index:number):Promise<number> {
    this.signal.throwIfAborted();
    if(!Number.isSafeInteger(index) || index<0 || index>=this.values.length) throw new RangeError("Invalid float storage index");
    if(++this.work%16384===0) await defaultRuntime.yieldTurn(this.signal);
    const offset=index*4,page=Math.floor(offset/4096);
    let view=this.pages.get(page);
    if(!view) {
      const length=Math.min(4096,this.values.length*4-page*4096),bytes=await this.storage.read(this.values.position+page*4096,length,{signal:this.signal});
      this.signal.throwIfAborted();
      if(!(bytes instanceof Uint8Array) || bytes.length!==length) throw new Error("Truncated float backing storage");
      const owned=new Uint8Array(bytes);view=new DataView(owned.buffer,owned.byteOffset,owned.byteLength);
      if(this.pages.size===32) this.pages.delete(this.pages.keys().next().value!);
      this.pages.set(page,view);
    }
    return view.getFloat32(offset%4096,true);
  }
}

export class FloatWriter {
  readonly values:StoredFloats;
  private readonly bytes=new Uint8Array(4096);
  private readonly view=new DataView(this.bytes.buffer);
  private offset=0;private used=0;private work=0;
  constructor(length:number,private readonly storage:ImageByteStorage,private readonly signal:AbortSignal) {
    signal.throwIfAborted();
    if(!Number.isSafeInteger(length) || length<0 || !Number.isSafeInteger(length*4)) throw new RangeError("Invalid float storage length");
    const position=storage.allocate(length*4);
    if(!Number.isSafeInteger(position) || position<0 || !Number.isSafeInteger(position+length*4)) throw new RangeError("Invalid float backing allocation");
    this.values={position,length};
  }
  async value(value:number):Promise<void> {
    this.signal.throwIfAborted();
    if(this.offset+this.used>=this.values.length*4) throw new RangeError("Float backing storage overflow");
    if(++this.work%16384===0) await defaultRuntime.yieldTurn(this.signal);
    this.view.setFloat32(this.used,value,true);this.used+=4;
    if(this.used===4096) await this.flush();
  }
  private async flush():Promise<void> {
    this.signal.throwIfAborted();
    if(this.used) await this.storage.write(this.values.position+this.offset,this.bytes.subarray(0,this.used),{signal:this.signal});
    this.signal.throwIfAborted();
    this.offset+=this.used;this.used=0;
  }
  async finish():Promise<StoredFloats> {
    await this.flush();
    if(this.offset!==this.values.length*4) throw new Error("Incomplete float backing storage");
    return this.values;
  }
}
