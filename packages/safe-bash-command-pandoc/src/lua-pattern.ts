/*! Pattern matching adapted from Fengari/Lua.
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
import {integer} from "./lua-arithmetic.js";
import type {LuaReference,LuaStorage,StoredLuaValue} from "./lua-storage.js";

function fail(message:string):never {throw new PandocError("E_AST","convert",message);}
const between=(value:number | undefined,lo:number,hi:number)=>value!==undefined && value>=lo && value<=hi;
function characterClass(value:number | undefined,kind:number | undefined):boolean {
  const lower=kind!==undefined && kind>=65 && kind<=90?kind+32:kind;
  let result:boolean;
  switch(lower) {
    case 97:result=between(value,65,90)||between(value,97,122);break;
    case 99:result=between(value,0,31)||value===127;break;
    case 100:result=between(value,48,57);break;
    case 103:result=between(value,33,126);break;
    case 108:result=between(value,97,122);break;
    case 112:result=between(value,33,126)&&!between(value,48,57)&&!between(value,65,90)&&!between(value,97,122);break;
    case 115:result=value===32||between(value,9,13);break;
    case 117:result=between(value,65,90);break;
    case 119:result=between(value,48,57)||between(value,65,90)||between(value,97,122);break;
    case 120:result=between(value,48,57)||between(value,65,70)||between(value,97,102);break;
    case 122:result=value===0;break;
    default:return value===kind;
  }
  return lower===kind?result:!result;
}

/** One fixed cache per input. Cache hits also cooperate, so failed backtracking
 * over a small resident window remains interruptible. */
class PatternBytes {
  private start=-1;
  private cache:Uint8Array=new Uint8Array();
  constructor(readonly value:LuaReference,readonly length:number,private readonly heap:LuaStorage,private readonly cooperate:(units?:number)=>Promise<void>) {}
  async byte(position:number):Promise<number | undefined> {
    await this.cooperate();
    if(position<0 || position>=this.length) return undefined;
    const start=Math.floor(position/8192)*8192;
    if(start!==this.start) {this.cache=await this.heap.readBytes(this.value,start,Math.min(8192,this.length-start));this.start=start;}
    return this.cache[position-start];
  }
  async indexOf(value:number,start:number,end:number):Promise<number> {
    while(start<end) {
      await this.byte(start);
      const local=start-this.start,limit=Math.min(this.cache.length,end-this.start);
      const found=this.cache.subarray(local,limit).indexOf(value);
      await this.cooperate(limit-local);
      if(found>=0) return start+found;
      start=this.start+limit;
    }
    return -1;
  }
  async equal(other:PatternBytes,start:number):Promise<boolean> {
    for(let offset=0;offset<other.length;offset+=8192) {
      const count=Math.min(8192,other.length-offset);
      const a=await this.heap.readBytes(this.value,start+offset,count),b=await this.heap.readBytes(other.value,offset,count);
      await this.cooperate(count);
      for(let i=0;i<count;i++) if(a[i]!==b[i]) return false;
    }
    return true;
  }
}
interface Capture {start:number;length:number}

/** Lua's existing 32-capture/200-call limits bound matcher state. Input and
 * pattern bytes stay in caller storage; no RegExp or full-string copy is used. */
export class LuaPattern {
  private readonly captures:Capture[]=[];
  private level=0;
  private depth=0;
  private constructor(private readonly heap:LuaStorage,private readonly source:PatternBytes,private readonly pattern:PatternBytes) {}
  static async open(heap:LuaStorage,source:LuaReference,pattern:LuaReference,cooperate:(units?:number)=>Promise<void>):Promise<LuaPattern> {
    return new LuaPattern(heap,new PatternBytes(source,await heap.byteLength(source),heap,cooperate),new PatternBytes(pattern,await heap.byteLength(pattern),heap,cooperate));
  }
  private async classEnd(position:number):Promise<number> {
    const byte=await this.pattern.byte(position++);
    if(byte===37) {if(position===this.pattern.length) return fail("Malformed pattern (ends with '%')");return position+1;}
    if(byte===91) {
      if(await this.pattern.byte(position)===94) position++;
      do {
        if(position===this.pattern.length) return fail("Malformed pattern (missing ']')");
        if(await this.pattern.byte(position++)===37 && position<this.pattern.length) position++;
      } while(await this.pattern.byte(position)!==93);
      return position+1;
    }
    return position;
  }
  private async bracket(value:number | undefined,position:number,end:number):Promise<boolean> {
    let positive=true;
    if(await this.pattern.byte(position+1)===94) {positive=false;position++;}
    while(++position<end) {
      const byte=await this.pattern.byte(position);
      if(byte===37) {if(characterClass(value,await this.pattern.byte(++position))) return positive;}
      else if(await this.pattern.byte(position+1)===45 && position+2<end) {
        const last=await this.pattern.byte(position+2);position+=2;
        if(value!==undefined && byte!==undefined && last!==undefined && byte<=value && value<=last) return positive;
      } else if(byte===value) return positive;
    }
    return !positive;
  }
  private async single(source:number,pattern:number,end:number):Promise<boolean> {
    if(source>=this.source.length) return false;
    const value=await this.source.byte(source),byte=await this.pattern.byte(pattern);
    if(byte===46) return true;
    if(byte===37) return characterClass(value,await this.pattern.byte(pattern+1));
    if(byte===91) return this.bracket(value,pattern,end-1);
    return value===byte;
  }
  private async balanced(source:number,pattern:number):Promise<number | undefined> {
    if(pattern>=this.pattern.length-1) return fail("Malformed balanced pattern");
    const open=await this.pattern.byte(pattern),close=await this.pattern.byte(pattern+1);
    if(await this.source.byte(source)!==open) return undefined;
    let count=1;
    while(++source<this.source.length) {
      const byte=await this.source.byte(source);
      if(byte===close) {if(--count===0) return source+1;}
      else if(byte===open) count++;
    }
    return undefined;
  }
  private async equal(first:number,second:number,count:number):Promise<boolean> {
    // The shipped engine uses subarray even for a position backreference.
    const normalize=(position:number)=>position<0?Math.max(0,this.source.length+position):Math.min(this.source.length,position);
    const firstEnd=normalize(first+count),secondEnd=normalize(second+count);
    first=normalize(first);second=normalize(second);
    const firstCount=Math.max(0,firstEnd-first),secondCount=Math.max(0,secondEnd-second);
    if(firstCount!==secondCount) return false;
    for(let offset=0;offset<firstCount;offset+=8192) {
      const take=Math.min(8192,firstCount-offset),a=await this.heap.readBytes(this.source.value,first+offset,take),b=await this.heap.readBytes(this.source.value,second+offset,take);
      for(let i=0;i<take;i++) if(a[i]!==b[i]) return false;
    }
    return true;
  }
  private async match(source:number,pattern:number):Promise<number | undefined> {
    if(this.depth===200) return fail("Pattern too complex");
    this.depth++;
    try {
      while(pattern!==this.pattern.length) {
        const byte=await this.pattern.byte(pattern);
        if(byte===40) {
          if(this.level===32) return fail("Too many captures");
          const position=await this.pattern.byte(pattern+1)===41,index=this.level++;
          this.captures[index]={start:source,length:position?-2:-1};
          const result=await this.match(source,pattern+(position?2:1));
          if(result===undefined) this.level--;
          return result;
        }
        if(byte===41) {
          let index=this.level-1;
          while(index>=0 && this.captures[index]!.length!==-1) index--;
          if(index<0) return fail("Invalid pattern capture");
          const capture=this.captures[index]!;capture.length=source-capture.start;
          const result=await this.match(source,pattern+1);
          if(result===undefined) capture.length=-1;
          return result;
        }
        if(byte===36 && pattern+1===this.pattern.length) return source===this.source.length?source:undefined;
        if(byte===37) {
          const escaped=await this.pattern.byte(pattern+1);
          if(escaped===98) {
            const next=await this.balanced(source,pattern+2);
            if(next===undefined) return undefined;
            source=next;pattern+=4;continue;
          }
          if(escaped===102) {
            pattern+=2;
            if(await this.pattern.byte(pattern)!==91) return fail("Missing '[' after '%f' in pattern");
            const end=await this.classEnd(pattern),previous=source===0?0:await this.source.byte(source-1),current=source===this.source.length?0:await this.source.byte(source);
            if(await this.bracket(previous,pattern,end-1) || !await this.bracket(current,pattern,end-1)) return undefined;
            pattern=end;continue;
          }
          if(escaped!==undefined && escaped>=48 && escaped<=57) {
            const index=escaped-49;
            if(index<0 || index>=this.level || this.captures[index]!.length===-1) return fail("Invalid capture index");
            const capture=this.captures[index]!;
            if(this.source.length-source<capture.length || !await this.equal(capture.start,source,capture.length)) return undefined;
            source+=capture.length;pattern+=2;continue;
          }
        }
        const end=await this.classEnd(pattern),suffix=await this.pattern.byte(end);
        if(!await this.single(source,pattern,end)) {
          if(suffix===42 || suffix===63 || suffix===45) {pattern=end+1;continue;}
          return undefined;
        }
        if(suffix===63) {
          const result=await this.match(source+1,end+1);
          if(result!==undefined) return result;
          pattern=end+1;continue;
        }
        if(suffix===42 || suffix===43) {
          if(suffix===43) source++;
          let count=0;
          while(await this.single(source+count,pattern,end)) count++;
          while(count>=0) {
            const result=await this.match(source+count,end+1);
            // Preserve the current engine's zero-position greedy-match quirk.
            if(result) return result;
            count--;
          }
          return undefined;
        }
        if(suffix===45) {
          for(;;) {
            const result=await this.match(source,end+1);
            if(result!==undefined) return result;
            if(!await this.single(source,pattern,end)) return undefined;
            source++;
          }
        }
        source++;pattern=end;
      }
      return source;
    } finally {this.depth--;}
  }
  private async slice(start:number,length:number):Promise<LuaReference> {
    const heap=this.heap,value=this.source.value;
    if(start===0 && length===this.source.length) return value;
    return heap.string((async function*(){for(let offset=0;offset<length;offset+=8192)yield await heap.readBytes(value,start+offset,Math.min(8192,length-offset));})());
  }
  private async *results(start:number,end:number,find:boolean):AsyncGenerator<StoredLuaValue> {
    if(find) {yield integer(start+1);yield integer(end);}
    if(!this.level && !find) {yield await this.slice(start,end-start);return;}
    for(let i=0;i<this.level;i++) {
      const capture=this.captures[i]!;
      if(capture.length===-1) return fail("Unfinished capture");
      yield capture.length===-2?integer(capture.start+1):await this.slice(capture.start,capture.length);
    }
  }
  async search(start:number,find:boolean,plain:boolean):Promise<AsyncIterable<StoredLuaValue> | StoredLuaValue[]> {
    if(find && !plain) {
      plain=true;
      for(let i=0;i<this.pattern.length;i++) if([94,36,42,43,63,46,40,91,37,45].includes((await this.pattern.byte(i))!)) {plain=false;break;}
    }
    if(find && plain) {
      if(!this.pattern.length) return [integer(start+1),integer(start)];
      const first=(await this.pattern.byte(0))!,end=this.source.length-this.pattern.length+1;
      for(let position=start;position<end;position++) {
        position=await this.source.indexOf(first,position,end);
        if(position<0) break;
        if(await this.source.equal(this.pattern,position)) return [integer(position+1),integer(position+this.pattern.length)];
      }
      return [undefined];
    }
    const anchor=await this.pattern.byte(0)===94;
    for(let position=start;position<=this.source.length;position++) {
      this.level=0;
      const end=await this.match(position,anchor?1:0);
      if(end!==undefined) return this.results(position,end,find);
      if(anchor) break;
    }
    return [undefined];
  }
}
