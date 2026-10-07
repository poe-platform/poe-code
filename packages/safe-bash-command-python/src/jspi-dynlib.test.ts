import assert from 'node:assert/strict';
import {test} from 'node:test';
import {installPythonJspiDynlib} from './jspi-dynlib.js';

for (const fail of [false,true]) test(`native loader owns its pathname and suspension mode until settlement; failure=${fail}`, async context => {
 const engine = (globalThis as any).WebAssembly;
 context.mock.method(engine,'promising',(fn:unknown)=>fn);
 const heap = new Uint8Array(512), active = {value:1};
 heap.set(new TextEncoder().encode('/caller/library.so\0'),16);
 let resume!:()=>void;
 const gate = new Promise<void>(resolve=>{resume=resolve;});
 const freed:number[]=[];
 const handles = new Map<number,{promise:Promise<unknown>}>();
 let serial=0;
 const cause = new Error('native library rejected');
 const module = {
  HEAPU8:heap,
  UTF8ToString(pointer:number){return new TextDecoder().decode(heap.subarray(pointer,heap.indexOf(0,pointer)));},
  _malloc(){return 128;}, _free(pointer:number){freed.push(pointer);},
  async _emscripten_dlopen_promise(pointer:number,flags:number){
   assert.equal(active.value,2);assert.equal(flags,2);
   assert.equal(module.UTF8ToString(pointer),'/caller/library.so');
   await gate;
   assert.equal(module.UTF8ToString(pointer),'/caller/library.so');
   if(fail)throw cause;
   return module.promiseMap.allocate({promise:Promise.resolve(42)});
  },
  getPromise(id:number){return handles.get(id)!.promise;},
  promiseMap:{allocate(value:{promise:Promise<unknown>}){handles.set(++serial,value);return serial;},free(id:number){handles.delete(id);}},
 };
 installPythonJspiDynlib(module,active);
 const handle=(module._emscripten_dlopen_promise as unknown as (pointer:number,flags:number)=>number)(16,2);
 heap.fill(255,16,64);
 const completion=module.getPromise(handle);
 module.promiseMap.free(handle);
 await Promise.resolve();
 assert.equal(active.value,2);assert.deepEqual(freed,[]);
 resume();
 if(fail)await assert.rejects(completion,error=>error===cause);
 else assert.equal(await completion,42);
 assert.equal(active.value,1);assert.deepEqual(freed,[128]);assert.equal(handles.size,0);
});
