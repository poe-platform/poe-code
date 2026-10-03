/*! String formatting and encoding adapted from Fengari/Lua.
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
/*! Numeric field rendering adapted from sprintf-js.
Copyright (c) 2007-present, Alexandru Mărășteanu <hello@alexei.ro>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of this software nor the names of its contributors may be
  used to endorse or promote products derived from this software without
  specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
import {PandocError} from "./errors.js";
import {integer,integral} from "./lua-arithmetic.js";
import {LuaNumbers} from "./lua-numbers.js";
import type {LuaArguments,LuaNativeOutput} from "./lua-machine.js";
import type {LuaReference,LuaStorage,StoredLuaValue} from "./lua-storage.js";
function fail(message:string):never {throw new PandocError("E_AST","convert",message);}
const digit=(value:number | undefined)=>value!==undefined && value>=48 && value<=57;
class Bytes {
  private start=-1;
  private cache:Uint8Array=new Uint8Array();
  constructor(readonly heap:LuaStorage,readonly value:LuaReference,readonly length:number,private readonly cooperate:(units?:number)=>Promise<void>) {}
  async byte(position:number):Promise<number | undefined> {
    await this.cooperate();
    if(position>=this.length) return undefined;
    const start=Math.floor(position/8192)*8192;
    if(start!==this.start) {this.cache=await this.heap.readBytes(this.value,start,Math.min(8192,this.length-start));this.start=start;}
    return this.cache[position-start];
  }
  async slice(start:number,end:number):Promise<LuaReference> {
    const heap=this.heap,value=this.value;
    if(start===0 && end===this.length) return value;
    return heap.string((async function*(){for(let offset=start;offset<end;offset+=8192)yield await heap.readBytes(value,offset,Math.min(8192,end-offset));})());
  }
}
/** Only called for bounded numeric fields or at most 99 UTF-16 string characters.
 * Preserve the existing encoder's handling of lone surrogate code units. */
function encode(text:string):Uint8Array {
  const result:number[]=[];
  for(let i=0;i<text.length;i++) {
    let value=text.charCodeAt(i);
    if(value>=0xd800 && value<=0xdbff && i+1<text.length) {
      const next=text.charCodeAt(i+1);
      if(next>=0xdc00 && next<=0xdfff) {value=(value-0xd800)*0x400+next+0x2400;i++;}
    }
    if(value<=0x7f) result.push(value);
    else if(value<=0x7ff) result.push(0xc0|(value>>6),0x80|(value&63));
    else if(value<=0xffff) result.push(0xe0|(value>>12),0x80|((value>>6)&63),0x80|(value&63));
    else result.push(0xf0|(value>>18),0x80|((value>>12)&63),0x80|((value>>6)&63),0x80|(value&63));
  }
  return Uint8Array.from(result);
}
function hex(value:number):string {
  if(value===Infinity)return "inf";if(value===-Infinity)return "-inf";if(Number.isNaN(value))return "nan";
  if(value===0)return Object.is(value,-0)?"-0x0p+0":"0x0p+0";
  const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,value);
  let bits=(view.getUint32(0)>>>20)&0x7ff;
  if(bits===0) {view.setFloat64(0,value*2**64);bits=((view.getUint32(0)>>>20)&0x7ff)-64;}
  const exponent=bits-1022,steps=Math.min(3,Math.ceil(Math.abs(exponent)/1023));let fraction=value;
  for(let i=0;i<steps;i++)fraction*=2**Math.floor((-exponent+i)/steps);
  return (fraction<0?"-":"")+"0x"+(Math.abs(fraction)*2).toString(16)+"p"+(exponent-1>=0?"+":"")+(exponent-1);
}
function field(spec:string,value:string | number):string {
  let position=1;
  const plus=spec[position]==="+";if(plus)position++;
  const zero=spec[position]==="0";if(zero)position++;
  const left=spec[position]==="-";if(left)position++;
  let width=0;
  while(digit(spec.charCodeAt(position)))width=width*10+spec.charCodeAt(position++)-48;
  let precision:number | undefined;
  if(spec[position]===".") {
    position++;precision=0;
    if(!digit(spec.charCodeAt(position)))return fail("Invalid format placeholder");
    while(digit(spec.charCodeAt(position)))precision=precision*10+spec.charCodeAt(position++)-48;
  }
  const kind=spec[position];
  if(position!==spec.length-1 || !kind || !"diefgouxXs".includes(kind))return fail("Invalid format placeholder");
  let result:string;
  if(kind==="s")result=precision===undefined?String(value):String(value).substring(0,precision);
  else {
    const number=value as number;
    switch(kind) {
      case "d":case "i":result=String(number);break;
      case "e":result=precision===undefined?number.toExponential():number.toExponential(precision);break;
      case "f":result=precision===undefined?String(number):number.toFixed(precision);break;
      case "g":result=precision===undefined?String(number):String(Number(number.toPrecision(precision)));break;
      case "o":result=(number>>>0).toString(8);break;
      case "u":result=String(number>>>0);break;
      case "x":case "X":result=(number>>>0).toString(16);if(kind==="X")result=result.toUpperCase();break;
      default:return fail("Invalid format placeholder");
    }
  }
  let sign="";
  if("diefg".includes(kind) && (!((value as number)>=0) || plus)) {
    sign=(value as number)>=0?"+":"-";
    if(result[0]==="+" || result[0]==="-")result=result.slice(1);
  }
  const padding=(zero?"0":" ").repeat(Math.max(0,width-sign.length-result.length));
  return left?sign+result+padding:zero?sign+padding+result:padding+sign+result;
}
/** Callback coercion executes in retained Lua. Native formatting holds only
 * bounded fields and streams unbounded literals and quoted string payloads. */
export class LuaFormat {
  private readonly numbers:LuaNumbers;
  constructor(private readonly heap:LuaStorage,private readonly cooperate:(units?:number)=>Promise<void>) {this.numbers=new LuaNumbers(heap);}
  private async input(value:StoredLuaValue):Promise<Bytes> {
    if(typeof value!=="object" || value.kind!=="string")return fail("Expected format string");
    return new Bytes(this.heap,value,await this.heap.byteLength(value),this.cooperate);
  }
  async invoke(prototype:number,args:LuaArguments):Promise<LuaNativeOutput> {
    const source=await this.input(await args.get(0));
    if(prototype===-530) {
      const start=integral(await args.get(1));let end=start;
      while(end<source.length && await source.byte(end)!==37)end++;
      if(end>start)return [integer(end),await source.slice(start,end)];
      if(await source.byte(start+1)===37)return [integer(start+2),await source.slice(start,start+1)];
      let position=start+1;
      while([45,43,32,35,48].includes((await source.byte(position))!))position++;
      if(position-start-1>=5)return fail("Invalid format (repeated flags)");
      if(digit(await source.byte(position)))position++;
      if(digit(await source.byte(position)))position++;
      if(await source.byte(position)===46) {position++;if(digit(await source.byte(position)))position++;if(digit(await source.byte(position)))position++;}
      if(digit(await source.byte(position)))return fail("Format width or precision too long");
      const kind=await source.byte(position);
      if(kind===undefined)return fail("Invalid format option");
      return [integer(position+1),await source.slice(start,position+1),integer(kind)];
    }
    if(source.length>32)return fail("Invalid format field");
    const spec=new TextDecoder().decode(await this.heap.readBytes(source.value,0,source.length)),kind=spec[spec.length-1],value=await args.get(1);
    if(kind==="q") {
      if(typeof value==="object" && value.kind==="string")return [await this.heap.string(this.quote(await this.input(value)))];
      let literal:string;
      if(typeof value==="number")literal=hex(value);
      else if(typeof value==="object" && value.kind==="integer")literal=value.value===-2147483648?"0x80000000":String(value.value);
      else if(value===undefined || typeof value==="boolean")literal=value===undefined?"nil":String(value);
      else return fail("Value has no literal form");
      return [await this.heap.string([encode(literal)])];
    }
    if(kind==="s") {
      const input=await this.input(value);
      if(spec==="%s")return [input.value];
      const precision=spec.includes(".");
      let text="",position=0;
      while(position<input.length) {
        const first=(await input.byte(position++))!;
        if(first===0)return fail("String contains zeros");
        if(!precision && input.length>=100)continue;
        let code=first;
        if(first>=0x80) {
          if(first<0xc2 || first>0xf4)return fail("Invalid UTF-8 string");
          const continuation=first<=0xdf?1:first<=0xef?2:3;
          code=first&((1<<(6-continuation))-1);
          for(let i=0;i<continuation;i++) {
            const next=await input.byte(position++);
            if(next===undefined || (next&0xc0)!==0x80)return fail("Invalid UTF-8 string");
            code=(code<<6)+(next&63);
          }
        }
        const decoded=code<=0xffff?String.fromCharCode(code):String.fromCharCode(((code-0x10000)>>10)+0xd800,((code-0x10000)%0x400)+0xdc00);
        if(text.length<99)text=(text+decoded).slice(0,99);
      }
      if(!precision && input.length>=100)return [input.value];
      return [await this.heap.string([encode(field(spec,text))])];
    }
    if(kind==="c")return [await this.heap.string([Uint8Array.of(integral(await this.numbers.coerce(value))&255)])];
    if(kind==="a" || kind==="A") {
      if(spec!=="%"+kind)return fail("Modifiers for hexadecimal float format not implemented");
      let text=hex(await this.numbers.coerce(value));if(kind==="A")text=text.toUpperCase();
      return [await this.heap.string([encode(text)])];
    }
    if(!kind || !"diouxXefgEG".includes(kind))return fail("Invalid format option");
    const number=await this.numbers.coerce(value),argument="diouxX".includes(kind)?integral(number):number;
    try {return [await this.heap.string([encode(field(spec,argument))])];}
    catch(error) {if(error instanceof PandocError)throw error;return fail("Invalid numeric format");}
  }
  private async *quote(input:Bytes):AsyncGenerator<Uint8Array> {
    const output=new Uint8Array(8192);let used=0;output[used++]=34;
    for(let position=0;position<input.length;position++) {
      const byte=(await input.byte(position))!;
      if(byte===34 || byte===92 || byte===10) {output[used++]=92;output[used++]=byte;}
      else if(byte<32 || byte===127) {
        output[used++]=92;
        let digits=String(byte);if(digit(await input.byte(position+1)))digits=digits.padStart(3,"0");
        for(const digit of digits)output[used++]=digit.charCodeAt(0);
      } else output[used++]=byte;
      if(used>output.length-5) {yield output.subarray(0,used);used=0;}
    }
    output[used++]=34;yield output.subarray(0,used);
  }
}
