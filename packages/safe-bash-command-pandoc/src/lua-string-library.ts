import {PandocError} from "./errors.js";
import {integer,integral} from "./lua-arithmetic.js";
import {LuaNumbers} from "./lua-numbers.js";
import {loadLuaLibrary} from "./lua-library.js";
import {stringLibrary} from "./lua-string.generated.js";
import type {LuaProgram} from "./lua-program.js";
import type {LuaMachine} from "./lua-machine.js";
import {LuaDump} from "./lua-dump.js";
import {LuaFormat} from "./lua-format.js";
import {LuaPack} from "./lua-pack.js";
import {LuaPattern} from "./lua-pattern.js";
import {LuaStrings} from "./lua-strings.js";
import type {LuaArguments,LuaNativeOutput} from "./lua-machine.js";
import type {LuaReference,LuaStorage,StoredLuaValue} from "./lua-storage.js";

const names=["byte","char","len","sub","rep","reverse","lower","upper","find","match"];
const relative=(position:number,length:number)=>position>=0?position:Math.max(0,length+position+1);
function fail(message:string):never {throw new PandocError("E_AST","convert",message);}

/** Byte-string operations retain outputs in caller storage and copy at most
 * one 8 KiB input/output chunk at a time. String methods share one metatable. */
export class LuaStringLibrary {
  private readonly numbers:LuaNumbers;
  private program:LuaProgram | undefined;
  private readonly strings:LuaStrings;
  constructor(private readonly heap:LuaStorage,private readonly cooperate:(units?:number)=>Promise<void>) {this.numbers=new LuaNumbers(heap);this.strings=new LuaStrings(heap);}
  async install(environment:LuaReference,program:LuaProgram,machine:LuaMachine):Promise<void> {
    this.program=program;
    const library=await this.heap.table(),key=(name:string)=>this.heap.string([new TextEncoder().encode(name)]);
    await this.heap.set(library,await key("dump"),await this.heap.closure(-540,[]));
    for(const [i,name] of ["pack","packsize","unpack"].entries()) await this.heap.set(library,await key(name),await this.heap.closure(-520-i,[]));
    for(let i=0;i<names.length;i++) await this.heap.set(library,await key(names[i]!),await this.heap.closure(-500-i,[]));
    const metatable=await this.heap.table();
    await this.heap.set(metatable,await key("__index"),library);
    this.heap.setStringMetatable(metatable);
    await this.heap.set(environment,await key("string"),library);
    const prototype=await loadLuaLibrary(stringLibrary,this.heap,program,await key("@string"));
    const closure=await this.heap.closure(prototype,[await this.heap.cell(environment)]);
    await machine.run(closure,[library,await this.heap.closure(-511,[]),await this.heap.closure(-510,[]),await this.heap.closure(-512,[]),await this.heap.closure(-513,[]),await this.heap.closure(-514,[]),await this.heap.closure(-530,[]),await this.heap.closure(-531,[])]);
  }
  private async string(value:StoredLuaValue):Promise<LuaReference> {
    return typeof value==="object" && value.kind==="string"?value:this.strings.concat((async function*(){yield value;})());
  }
  private async argument(args:LuaArguments,index:number,fallback?:number):Promise<number> {
    const value=await args.get(index);
    return value===undefined && fallback!==undefined?fallback:integral(await this.numbers.coerce(value));
  }
  async invoke(prototype:number,args:LuaArguments):Promise<LuaNativeOutput> {
    if(prototype===-540) {
      if(!this.program) throw new PandocError("E_AST","convert","String library is not installed");
      const strip=await args.get(1);
      return [await new LuaDump(this.heap,this.program).dump(await args.get(0),strip!==undefined && strip!==false)];
    }
    if(prototype===-530 || prototype===-531) return new LuaFormat(this.heap,this.cooperate).invoke(prototype,args);
    if(prototype<=-520 && prototype>=-522) return new LuaPack(this.heap,this.cooperate).invoke(["pack","packsize","unpack"][-520-prototype]!,args);
    if(prototype===-512) return [integer(await this.argument(args,0))];
    if(prototype===-513) {
      const heap=this.heap,table=await args.get(0) as LuaReference,count=await this.numbers.coerce(await args.get(1));
      return [await this.strings.concat((async function*(){for(let i=1;i<=count;i++) yield await heap.get(table,i);})())];
    }
    if(prototype===-514) {
      const value=await this.string(await args.get(0)),start=await this.argument(args,1),length=await this.heap.byteLength(value);
      let end=start;
      while(end<length) {
        const bytes=await this.heap.readBytes(value,end,Math.min(8192,length-end)),found=bytes.indexOf(37);
        await this.cooperate(bytes.length);
        if(found>=0) {end+=found;break;}
        end+=bytes.length;
      }
      if(end>start) return [integer(end),await this.heap.string(this.range(value,start,end-start)),false];
      if(start+1>=length) return fail("Invalid '%' in replacement string");
      const byte=(await this.heap.readBytes(value,start+1,1))[0]!;
      if(byte>=48 && byte<=57) return [integer(start+2),integer(byte-48),true];
      if(byte!==37) return fail("Invalid '%' in replacement string");
      return [integer(start+2),await this.heap.string([Uint8Array.of(37)]),false];
    }
    if(prototype===-511) return [await this.string(await args.get(0))];
    if(prototype===-510) {
      const value=await this.string(await args.get(0)),pattern=await this.string(await args.get(1));
      const matcher=await LuaPattern.open(this.heap,value,pattern,this.cooperate);
      return matcher.search(await this.argument(args,2),true,false,{last:await this.argument(args,3),anchor:await args.get(4)===true});
    }
    const name=names[-500-prototype];
    if(!name) throw new PandocError("E_UNSUPPORTED_FEATURE","convert","Unknown Lua string function");
    if(name==="char") return [await this.heap.string(this.characters(args))];
    const value=await this.string(await args.get(0)),length=await this.heap.byteLength(value);
    if(name==="find" || name==="match") {
      const pattern=await this.string(await args.get(1)),start=Math.max(1,relative(await this.argument(args,2,1),length));
      if(start>length+1) return [undefined];
      const plain=await args.get(3),matcher=await LuaPattern.open(this.heap,value,pattern,this.cooperate);
      return matcher.search(start-1,name==="find",plain!==undefined && plain!==false);
    }
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
