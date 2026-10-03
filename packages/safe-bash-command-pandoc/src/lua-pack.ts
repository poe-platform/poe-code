/*! Binary formats adapted from Fengari/Lua.
MIT License

Copyright © 2017-2019 Benoit Giannangeli
Copyright © 2017-2025 Daurnimator
Copyright © 1994–2017 Lua.org, PUC-Rio.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import {PandocError} from "./errors.js";
import {integer,integral} from "./lua-arithmetic.js";
import {LuaNumbers} from "./lua-numbers.js";
import {LuaStrings} from "./lua-strings.js";
import type {LuaArguments,LuaNativeOutput} from "./lua-machine.js";
import type {LuaReference,LuaStorage,StoredLuaValue} from "./lua-storage.js";

function fail(message:string):never {throw new PandocError("E_AST","convert",message);}
const digit=(byte:number | undefined)=>byte!==undefined && byte>=48 && byte<=57;
type Kind="int"|"uint"|"float"|"char"|"string"|"zero"|"pad"|"align"|"none";
interface Field {kind:Kind;size:number}
class Format {
  position=0;
  little=true;
  alignment=1;
  private start=-1;
  private cache:Uint8Array=new Uint8Array();
  constructor(private readonly heap:LuaStorage,private readonly value:LuaReference,readonly length:number,private readonly cooperate:(units?:number)=>Promise<void>) {}
  private async byte():Promise<number | undefined> {
    await this.cooperate();
    if(this.position>=this.length) return undefined;
    const start=Math.floor(this.position/8192)*8192;
    if(start!==this.start) {this.cache=await this.heap.readBytes(this.value,start,Math.min(8192,this.length-start));this.start=start;}
    return this.cache[this.position-start];
  }
  private async number(fallback:number,limited=false):Promise<number> {
    let value=fallback;
    if(digit(await this.byte())) {
      value=0;
      do {value=value*10+(await this.byte())!-48;this.position++;} while(digit(await this.byte()) && value<=(2147483647-9)/10);
    }
    if(limited && (value<1 || value>16)) return fail("Integral size out of limits [1,16]");
    return value;
  }
  private async option():Promise<Field> {
    const byte=await this.byte();this.position++;
    switch(byte) {
      case 98:return {kind:"int",size:1};case 66:return {kind:"uint",size:1};
      case 104:return {kind:"int",size:2};case 72:return {kind:"uint",size:2};
      case 108:case 106:return {kind:"int",size:4};
      case 76:case 74:case 84:return {kind:"uint",size:4};
      case 102:return {kind:"float",size:4};case 100:case 110:return {kind:"float",size:8};
      case 105:return {kind:"int",size:await this.number(4,true)};
      case 73:return {kind:"uint",size:await this.number(4,true)};
      case 115:return {kind:"string",size:await this.number(4,true)};
      case 99: {const size=await this.number(-1);if(size<0)return fail("Missing size for format option 'c'");return {kind:"char",size};}
      case 122:return {kind:"zero",size:0};case 120:return {kind:"pad",size:1};case 88:return {kind:"align",size:0};
      case 32:break;
      case 60:case 61:this.little=true;break;
      case 62:this.little=false;break;
      case 33:this.alignment=await this.number(8,true);break;
      default:return fail("Invalid binary format option");
    }
    return {kind:"none",size:0};
  }
  async next(total:number):Promise<Field & {padding:number}> {
    const field=await this.option();let align=field.size;
    if(field.kind==="align") {
      if(this.position>=this.length || await this.byte()===0) return fail("Invalid option after 'X'");
      const next=await this.option();align=next.size;
      if(next.kind==="char" || align===0) return fail("Invalid option after 'X'");
    }
    if(align<=1 || field.kind==="char") return {...field,padding:0};
    align=Math.min(align,this.alignment);
    if((align&(align-1))!==0) return fail("Format alignment is not a power of two");
    return {...field,padding:(align-(total&(align-1)))&(align-1)};
  }
}
function packInteger(value:number,size:number,little:boolean):Uint8Array {
  const bytes=new Uint8Array(size);
  // Arithmetic shifting preserves the shipped engine's wide unsigned behavior.
  for(let i=0;i<size;i++) {bytes[little?i:size-1-i]=value&255;value>>=8;}
  return bytes;
}
function unpackInteger(bytes:Uint8Array,little:boolean,signed:boolean):number {
  let value=0;const size=bytes.length,limit=Math.min(4,size);
  for(let i=limit-1;i>=0;i--) value=(value<<8)|bytes[little?i:size-1-i]!;
  if(size<4 && signed) {const mask=1<<(size*8-1);value=(value^mask)-mask;}
  if(size>4) {
    const mask=signed && value<0?255:0;
    for(let i=limit;i<size;i++) if(bytes[little?i:size-1-i]!==mask) return fail("Integer does not fit into Lua integer");
  }
  return value;
}
/** Formats, source strings and output values stay in caller storage. At most
 * one format cache, one data chunk and a 16-byte numeric field are resident. */
export class LuaPack {
  private readonly numbers:LuaNumbers;
  private readonly strings:LuaStrings;
  constructor(private readonly heap:LuaStorage,private readonly cooperate:(units?:number)=>Promise<void>) {this.numbers=new LuaNumbers(heap);this.strings=new LuaStrings(heap);}
  private async string(value:StoredLuaValue):Promise<LuaReference> {
    return typeof value==="object" && value.kind==="string"?value:this.strings.concat((async function*(){yield value;})());
  }
  async invoke(name:string,args:LuaArguments):Promise<LuaNativeOutput> {
    const value=await this.string(await args.get(0)),format=new Format(this.heap,value,await this.heap.byteLength(value),this.cooperate);
    if(name==="packsize") {
      let total=0;
      while(format.position<format.length) {
        const field=await format.next(total);
        if(total>2147483647-field.size-field.padding) return fail("Format result too large");
        total+=field.size+field.padding;
        if(field.kind==="string" || field.kind==="zero") return fail("Variable-length format");
      }
      return [integer(total)];
    }
    if(name==="pack") return [await this.heap.string(this.pack(format,args))];
    const data=await this.string(await args.get(1)),length=await this.heap.byteLength(data),argument=await args.get(2);
    const relative=argument===undefined?1:integral(await this.numbers.coerce(argument));
    const position=(relative>=0?relative:Math.max(0,length+relative+1))-1;
    if(position<0 || position>length) return fail("Initial position out of string");
    return this.unpack(format,data,length,position);
  }
  private async *zeros(count:number):AsyncGenerator<Uint8Array> {
    const bytes=new Uint8Array(Math.min(8192,count));
    for(let offset=0;offset<count;offset+=bytes.length) {await this.cooperate(bytes.length);yield bytes.subarray(0,Math.min(bytes.length,count-offset));}
  }
  private async *pack(format:Format,args:LuaArguments):AsyncGenerator<Uint8Array> {
    let total=0,index=1;
    while(format.position<format.length) {
      const {kind,size,padding}=await format.next(total);total+=size+padding;
      yield* this.zeros(padding);
      if(kind==="pad") {yield Uint8Array.of(0);continue;}
      if(kind==="none" || kind==="align") continue;
      const value=await args.get(index++);
      if(kind==="int" || kind==="uint") {
        const number=integral(await this.numbers.coerce(value));
        if(size<4 && (kind==="int"?(number<-(2**(size*8-1)) || number>=2**(size*8-1)):(number>>>0)>=2**(size*8))) return fail("Integer overflow");
        yield packInteger(number,size,format.little);
      } else if(kind==="float") {
        const bytes=new Uint8Array(size),view=new DataView(bytes.buffer),number=await this.numbers.coerce(value);
        if(size===4) view.setFloat32(0,number,format.little);else view.setFloat64(0,number,format.little);
        yield bytes;
      } else {
        const string=await this.string(value),length=await this.heap.byteLength(string);
        if(kind==="char" && length>size) return fail("String longer than given size");
        if(kind==="string") {
          if(size<4 && length>=2**(size*8)) return fail("String length does not fit in given size");
          yield packInteger(length,size,format.little);total+=length;
        }
        for await(const bytes of this.heap.bytes(string)) {
          if(kind==="zero" && bytes.includes(0)) return fail("String contains zeros");
          yield bytes;
        }
        if(kind==="char") yield* this.zeros(size-length);
        if(kind==="zero") {yield Uint8Array.of(0);total+=length+1;}
      }
    }
  }
  private async slice(data:LuaReference,length:number,start:number,end:number):Promise<LuaReference> {
    const normalize=(position:number)=>position<0?Math.max(0,length+position):Math.min(length,position);
    start=normalize(start);end=Math.max(start,normalize(end));
    const heap=this.heap;
    return heap.string((async function*(){for(let offset=start;offset<end;offset+=8192)yield await heap.readBytes(data,offset,Math.min(8192,end-offset));})());
  }
  private async *unpack(format:Format,data:LuaReference,length:number,position:number):AsyncGenerator<StoredLuaValue> {
    while(format.position<format.length) {
      const {kind,size,padding}=await format.next(position);
      if(position+padding+size>length || position<0) return fail("Data string too short");
      position+=padding;
      if(kind==="int" || kind==="uint") yield integer(unpackInteger(await this.heap.readBytes(data,position,size),format.little,kind==="int"));
      else if(kind==="float") {
        const bytes=await this.heap.readBytes(data,position,size),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        yield size===4?view.getFloat32(0,format.little):view.getFloat64(0,format.little);
      } else if(kind==="char") yield await this.slice(data,length,position,position+size);
      else if(kind==="string") {
        const count=unpackInteger(await this.heap.readBytes(data,position,size),format.little,false);
        if(position+size+count>length) return fail("Data string too short");
        yield await this.slice(data,length,position+size,position+size+count);position+=count;
      } else if(kind==="zero") {
        let end=-1;
        for(let offset=position;offset<length;offset+=8192) {
          const bytes=await this.heap.readBytes(data,offset,Math.min(8192,length-offset)),found=bytes.indexOf(0);
          await this.cooperate(bytes.length);
          if(found>=0) {end=offset+found;break;}
        }
        // Preserve the existing engine's unterminated-string end calculation.
        if(end<0) end=length-position;
        yield await this.slice(data,length,position,end);position=end+1;
      }
      position+=size;
    }
    yield integer(position+1);
  }
}
