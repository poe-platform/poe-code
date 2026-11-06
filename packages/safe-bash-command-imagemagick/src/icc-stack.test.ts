import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {StoredImageStack} from "./stored-stack.js";

it("preserves ICC bytes after retained frames leave the cache", async () => {
  const signal = new AbortController().signal;
  const storage = new PagedStorage({fs:new MemoryFileSystem(),cwd:"/",env:{},signal},1);
  try {
    const stack = new StoredImageStack(storage,signal);
    const icc = Uint8Array.of(1,2,3,4);
    for (let index=0;index<40;index++) await stack.push({width:1,height:1,position:0,format:"png",space:"srgb",channels:4,depth:"uchar",density:72,hasAlpha:true,icc});
    expect((await stack.get(0))!.icc).toEqual(icc);
  } finally {await storage.close();}
});
