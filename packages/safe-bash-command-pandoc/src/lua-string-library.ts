import {PandocError} from "./errors.js";
import {integer,integral} from "./lua-arithmetic.js";
import {LuaNumbers} from "./lua-numbers.js";
import {LuaStrings} from "./lua-strings.js";
import type {LuaArguments,LuaNativeOutput} from "./lua-machine.js";
import type {LuaReference,LuaStorage,StoredLuaValue} from "./lua-storage.js";

const names=["byte","char","len","sub","rep","reverse","lower","upper"];
const relative=(position:number,length:number)=>position>=0?position:Math.max(0,length+position+1);
function fail(message:string):never {throw new PandocError("E_AST","convert",message);}

/** Byte-string operations retain outputs in caller storage and copy at most
 * one 8 KiB input/output chunk at a time. String methods share one metatable. */
export class LuaStringLibrary {
  private readonly numbers:LuaNumbers;
  private readonly strings:LuaStrings;
  constructor(private readonly heap:LuaStorage) {this.numbers=new LuaNumbers(heap);this.strings=new LuaStrings(heap);}
  async install(environment:LuaReference):Promise<void> {
    const library=await this.heap.table(),key=(name:string)=>this.heap.string([new TextEncoder().encode(name)]);
    for(let i=0;i<names.length;i++) await this.heap.set(library,await key(names[i]!),await this.heap.closure(-500-i,[]));
    const metatable=await this.heap.table();
    await this.heap.set(metatable,await key("__index"),library);
    this.heap.setStringMetatable(metatable);
    await this.heap.set(environment,await key("string"),library);
  }
  private async string(value:StoredLuaValue):Promise<LuaReference> {
    return typeof value==="object" && value.kind==="string"?value:this.strings.concat((async function*(){yield value;})());
  }
  private async argument(args:LuaArguments,index:number,fallback?:number):Promise<number> {
    const value=await args.get(index);
    return value===undefined && fallback!==undefined?fallback:integral(await this.numbers.coerce(value));
  }
  async invoke(prototype:number,args:LuaArguments):Promise<LuaNativeOutput> {
    const name=names[-500-prototype];
    if(!name) throw new PandocError("E_UNSUPPORTED_FEATURE","convert","Unknown Lua string function");
    if(name==="char") return [await this.heap.string(this.characters(args))];
    const value=await this.string(await args.get(0)),length=await this.heap.byteLength(value);
    if(name==="len") return [integer(length)];
    if(name==="rep") {
      const count=await this.argument(args,1),argument=await args.get(2);
      const separator=argument===undefined?undefined:await this.string(argument),separatorLength=separator?await this.heap.byteLength(separator):0;
      if(count<=0) return [await this.heap.string([])];
      if(length+separatorLength>2147483647/count) return fail("Resulting string too large");
      return [await this.heap.string(this.repeat(value,length,count,separator,separatorLength))];
    }
    if(name==="sub" || name==="byte") {
      const requested=relative(await this.argument(args,1,name==="byte"?1:undefined),length);
      const end=Math.min(length,relative(await this.argument(args,2,name==="byte"?requested:-1),length));
      const start=Math.max(1,requested)-1,count=Math.max(0,end-start);
      if(name==="byte") return this.codes(value,start,count);
      return [count===length?value:await this.heap.string(this.range(value,start,count))];
    }
    return [await this.heap.string(this.transform(value,length,name))];
  }
  private async *range(value:LuaReference,start:number,count:number):AsyncGenerator<Uint8Array> {
    for(let offset=0;offset<count;offset+=8192) yield await this.heap.readBytes(value,start+offset,Math.min(8192,count-offset));
  }
  private async *codes(value:LuaReference,start:number,count:number):AsyncGenerator<StoredLuaValue> {
    for await(const bytes of this.range(value,start,count)) for(const byte of bytes) yield integer(byte);
  }
  private async *characters(args:LuaArguments):AsyncGenerator<Uint8Array> {
    const bytes=new Uint8Array(8192);let used=0;
    for(let i=0;i<args.count;i++) {
      const value=await this.argument(args,i);
      if(value<0 || value>255) return fail("Value out of range");
      bytes[used++]=value;
      if(used===bytes.length) {yield bytes;used=0;}
    }
    if(used) yield bytes.subarray(0,used);
  }
  private async *transform(value:LuaReference,length:number,name:string):AsyncGenerator<Uint8Array> {
    if(name==="reverse") {
      for(let end=length;end>0;) {
        const count=Math.min(8192,end);end-=count;
        yield (await this.heap.readBytes(value,end,count)).reverse();
      }
      return;
    }
    for await(const bytes of this.heap.bytes(value)) {
      for(let i=0;i<bytes.length;i++) {
        const byte=bytes[i]!;
        if(name==="lower" && byte>=65 && byte<=90) bytes[i]=byte+32;
        if(name==="upper" && byte>=97 && byte<=122) bytes[i]=byte-32;
      }
      yield bytes;
    }
  }
  private async *repeat(value:LuaReference,length:number,count:number,separator:LuaReference | undefined,separatorLength:number):AsyncGenerator<Uint8Array> {
    const cycle=length+separatorLength,total=count*length+(count-1)*separatorLength;
    if(!total) return;
    if(cycle<=8192) {
      const pattern=new Uint8Array(cycle),output=new Uint8Array(8192);
      pattern.set(await this.heap.readBytes(value,0,length));
      if(separator) pattern.set(await this.heap.readBytes(separator,0,separatorLength),length);
      for(let offset=0;offset<total;offset+=output.length) {
        const take=Math.min(output.length,total-offset);
        for(let i=0;i<take;i++) output[i]=pattern[(offset+i)%cycle]!;
        yield output.subarray(0,take);
      }
    } else {
      for(let i=0;i<count;i++) {if(i && separator) yield* this.heap.bytes(separator);yield* this.heap.bytes(value);}
    }
  }
}
