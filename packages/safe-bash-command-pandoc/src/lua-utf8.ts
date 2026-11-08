import {PandocError} from "./errors.js";
import {integer,integral} from "./lua-arithmetic.js";
import {LuaNumbers} from "./lua-numbers.js";
import {LuaStrings} from "./lua-strings.js";
import type {LuaArguments,LuaNativeOutput} from "./lua-machine.js";
import type {LuaReference,LuaStorage,StoredLuaValue} from "./lua-storage.js";

const names=["char","codepoint","codes","len","offset"];
const iterator=-399;
const continuation=(byte:number | undefined)=>byte!==undefined && (byte&0xc0)===0x80;
const relative=(position:number,length:number)=>position>=0?position:Math.max(0,length+position+1);
function fail(message:string):never {throw new PandocError("E_AST","convert",message);}

/** Lua 5.3 byte-oriented UTF-8 operations with one fixed cache over caller storage. */
export class LuaUtf8 {
  private readonly numbers:LuaNumbers;
  private readonly strings:LuaStrings;
  private cache:{id:number;start:number;bytes:Uint8Array} | undefined;
  private iterator:Promise<LuaReference> | undefined;
  constructor(private readonly heap:LuaStorage) {this.numbers=new LuaNumbers(heap);this.strings=new LuaStrings(heap);}
  async install(environment:LuaReference):Promise<void> {
    const library=await this.heap.table(), key=(name:string)=>this.heap.string([new TextEncoder().encode(name)]);
    for(let i=0;i<names.length;i++) await this.heap.set(library,await key(names[i]!),await this.heap.closure(-300-i,[]));
    await this.heap.set(library,await key("charpattern"),await this.heap.string([Uint8Array.of(91,0,45,127,194,45,244,93,91,128,45,191,93,42)]));
    await this.heap.set(environment,await key("utf8"),library);
  }
  private async byte(value:LuaReference,length:number,position:number):Promise<number | undefined> {
    if(position<0 || position>=length) return undefined;
    const start=Math.floor(position/8192)*8192;
    if(this.cache?.id!==value.id || this.cache.start!==start)
      this.cache={id:value.id,start,bytes:await this.heap.readBytes(value,start,Math.min(8192,length-start))};
    return this.cache.bytes[position-start];
  }
  private async decode(value:LuaReference,length:number,position:number):Promise<{code:number;next:number} | undefined> {
    const first=await this.byte(value,length,position);
    if(first===undefined) return undefined;
    if(first<128) return {code:first,next:position+1};
    const count=first>=0xc2 && first<=0xdf?1:first>=0xe0 && first<=0xef?2:first>=0xf0 && first<=0xf4?3:0;
    if(!count) return undefined;
    let code=first&((1<<(6-count))-1);
    for(let i=1;i<=count;i++) {
      const byte=await this.byte(value,length,position+i);
      if(!continuation(byte)) return undefined;
      code=code*64+(byte!&63);
    }
    // Preserve the shipped engine's acceptance of surrogate code points.
    if(code<[0,128,2048,65536][count]! || code>0x10ffff) return undefined;
    return {code,next:position+count+1};
  }
  private async argument(args:LuaArguments,index:number,fallback?:number):Promise<number> {
    const value=await args.get(index);
    return value===undefined && fallback!==undefined?fallback:integral(await this.numbers.coerce(value));
  }
  async invoke(prototype:number,args:LuaArguments):Promise<LuaNativeOutput> {
    const name=names[-300-prototype];
    if(prototype!==iterator && !name) throw new PandocError("E_UNSUPPORTED_FEATURE","convert","Unknown Lua UTF-8 function");
    if(name==="char") return [await this.heap.string(this.characters(args))];
    const input=await args.get(0),value=typeof input==="object" && input.kind==="string"?input:await this.strings.concat((async function*(){yield input;})());
    const length=await this.heap.byteLength(value);
    if(name==="codes") return [await (this.iterator ??= this.heap.closure(iterator,[])),value,integer(0)];
    if(prototype===iterator) {
      let position:number;
      try {position=await this.argument(args,1)-1;}
      catch(error) {if(error instanceof PandocError && error.code==="E_AST") position=-1; else throw error;}
      if(position<0) position=0;
      else if(position<length) {do {position++;} while(continuation(await this.byte(value,length,position)));}
      if(position>=length) return [];
      const decoded=await this.decode(value,length,position);
      if(!decoded || continuation(await this.byte(value,length,decoded.next))) return fail("Invalid UTF-8 code");
      return [integer(position+1),integer(decoded.code)];
    }
    if(name==="offset") {
      let count=await this.argument(args,1),position=relative(await this.argument(args,2,count>=0?1:length+1),length)-1;
      if(position<0 || position>length) return fail("Position out of range");
      if(count===0) {while(position>0 && continuation(await this.byte(value,length,position))) position--;}
      else {
        if(continuation(await this.byte(value,length,position))) return fail("Initial position is a continuation byte");
        if(count<0) while(count<0 && position>0) {
          do {position--;} while(position>0 && continuation(await this.byte(value,length,position)));
          count++;
        }
        else {
          count--;
          while(count>0 && position<length) {
            do {position++;} while(continuation(await this.byte(value,length,position)));
            count--;
          }
        }
      }
      return [count===0?integer(position+1):undefined];
    }
    let position=relative(await this.argument(args,1,1),length)-1;
    const end=relative(await this.argument(args,2,name==="len"?-1:position+1),length);
    if(position<0 || name==="len" && position>length) return fail("Initial position out of string");
    if(end>length) return fail("Final position out of string");
    if(name==="codepoint") return this.points(value,length,position,end);
    let count=0;
    while(position<end) {
      const decoded=await this.decode(value,length,position);
      if(!decoded) return [undefined,integer(position+1)];
      count++;position=decoded.next;
    }
    return [integer(count)];
  }
  private async *points(value:LuaReference,length:number,position:number,end:number):AsyncGenerator<StoredLuaValue> {
    while(position<end) {
      const decoded=await this.decode(value,length,position);
      if(!decoded) return fail("Invalid UTF-8 code");
      yield integer(decoded.code); position=decoded.next;
    }
  }
  private async *characters(args:LuaArguments):AsyncGenerator<Uint8Array> {
    const bytes=new Uint8Array(4);
    for(let i=0;i<args.count;i++) {
      const code=await this.argument(args,i);
      if(code<0 || code>0x10ffff) return fail("Value out of range");
      let length:number;
      if(code<128) {bytes[0]=code; length=1;}
      else if(code<2048) {bytes[0]=0xc0|(code>>6);bytes[1]=0x80|(code&63);length=2;}
      else if(code<65536) {bytes[0]=0xe0|(code>>12);bytes[1]=0x80|((code>>6)&63);bytes[2]=0x80|(code&63);length=3;}
      else {bytes[0]=0xf0|(code>>18);bytes[1]=0x80|((code>>12)&63);bytes[2]=0x80|((code>>6)&63);bytes[3]=0x80|(code&63);length=4;}
      yield bytes.subarray(0,length);
    }
  }
}
