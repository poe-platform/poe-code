/*! Bytecode serialization adapted from Fengari/Lua.
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
import type {LuaProgram} from "./lua-program.js";
import type {LuaStorage,LuaReference,StoredLuaValue} from "./lua-storage.js";
function word(value:number):Uint8Array {const bytes=new Uint8Array(4);new DataView(bytes.buffer).setInt32(0,value,true);return bytes;}
function number(value:number):Uint8Array {const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,value,true);return bytes;}

/** Serializes the retained compiler's Lua 5.3 bytecode. Traversal frames live in
 * caller storage, and constants stream through the heap's fixed byte chunks. */
export class LuaDump {
  constructor(private readonly heap:LuaStorage,private readonly program:LuaProgram) {}
  async dump(value:StoredLuaValue,strip:boolean):Promise<LuaReference> {
    if(typeof value!=="object" || value.kind!=="function")throw new PandocError("E_AST","convert","Expected Lua function");
    const prototype=await this.heap.prototype(value);
    if(prototype<0)throw new PandocError("E_AST","convert","Unable to dump native function");
    return this.heap.string(this.bytes(prototype,strip));
  }
  private async *string(value:LuaReference | undefined):AsyncGenerator<Uint8Array> {
    if(!value){yield Uint8Array.of(0);return;}
    const size=await this.heap.byteLength(value)+1;
    if(size<255)yield Uint8Array.of(size);else {yield Uint8Array.of(255);yield word(size);}
    yield* this.heap.bytes(value);
  }
  private async *bytes(root:number,strip:boolean):AsyncGenerator<Uint8Array> {
    yield Uint8Array.of(27,76,117,97,0x53,0,25,147,13,10,26,10,4,4,4,4,8);
    yield word(0x5678);yield number(370.5);
    yield Uint8Array.of((await this.program.describe(root)).captures);
    const stack=await this.heap.table(),first=await this.heap.table();let depth=0;
    await this.heap.set(first,0,root);await this.heap.set(stack,depth,first);
    while(depth>=0) {
      const frame=await this.heap.get(stack,depth) as LuaReference,prototype=await this.heap.get(frame,0) as number;
      const info=await this.program.describe(prototype);let child=await this.heap.get(frame,2) as number | undefined;
      if(child===undefined) {
        const parent=await this.heap.get(frame,1) as LuaReference | undefined;
        yield* this.string(strip || info.source?.id===parent?.id?undefined:info.source);
        // The retained compiler stores instruction lines, but emits no lexical
        // debugger records. Zero bounds are valid for compiler-generated chunks.
        yield word(0);yield word(0);
        yield Uint8Array.of(info.parameters,Number(info.vararg),info.registers);
        yield word(info.instructions);
        for(let i=0;i<info.instructions;i++)yield word((await this.program.instruction(prototype,i)).code);
        yield word(info.constants);
        for(let i=0;i<info.constants;i++) {
          const value=await this.program.read(prototype,"constant",i);
          if(value===undefined)yield Uint8Array.of(0);
          else if(typeof value==="boolean")yield Uint8Array.of(1,Number(value));
          else if(typeof value==="number") {yield Uint8Array.of(3);yield number(value);}
          else if(value.kind==="integer") {yield Uint8Array.of(19);yield word(value.value);}
          else {yield Uint8Array.of(await this.heap.byteLength(value)<=40?4:20);yield* this.string(value);}
        }
        yield word(info.captures);
        for(let i=0;i<info.captures;i++) {const capture=await this.program.capture(prototype,i);yield Uint8Array.of(Number(capture.register),capture.index);}
        yield word(info.children);child=0;
      }
      if(child<info.children) {
        await this.heap.set(frame,2,child+1);
        const next=await this.heap.table();await this.heap.set(next,0,await this.program.read(prototype,"child",child));
        await this.heap.set(next,1,info.source);await this.heap.set(stack,++depth,next);continue;
      }
      yield word(strip?0:info.instructions);
      if(!strip)for(let i=0;i<info.instructions;i++)yield word((await this.program.instruction(prototype,i)).line);
      yield word(0);yield word(0);
      await this.heap.set(stack,depth--,undefined);
    }
  }
}
