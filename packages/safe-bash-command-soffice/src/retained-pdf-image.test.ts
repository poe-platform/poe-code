import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { encodePng } from "@poe-code/pdf-ast";
import { retainPdfImage } from "./retained-pdf-image.js";

for (const mode of ['read', 'write', 'allocate', 'cancel'] as const) it(`preserves image backing ${mode} failures`, async () => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), storage = new PagedStorage({fs,cwd:'/',env:{},signal:controller.signal});
  const png = encodePng({width:1,height:1,data:Uint8Array.of(255,0,0,255)}), position = storage.allocate(png.length);
  await storage.write(position,png);
  const failure = new Error('backing failure'); let reads = 0;
  const backing = new Proxy(storage,{get(target,key){
    if (key === 'read') return async (offset: number, length: number) => {
      if (++reads === 3) { if (mode === 'cancel') controller.abort(failure); else if (mode === 'read') throw failure; }
      return target.read(offset,length);
    };
    if (key === 'allocate' && mode === 'allocate') return () => {throw failure;};
    if (key === 'write' && mode === 'write') return async () => {throw failure;};
    const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
  }});
  try { await assert.rejects(retainPdfImage(backing,{position,size:png.length,width:24,height:24},controller.signal),error=>error===failure); }
  finally {await storage.close();}
});
