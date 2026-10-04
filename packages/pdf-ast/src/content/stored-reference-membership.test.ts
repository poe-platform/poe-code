import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { cosRef, type PdfStoredItems } from "../ast.js";
import { appendStoredRecord } from "./stored-record.js";
import { StoredReferenceMembership } from "./stored-reference-membership.js";

it("bounds cached layer indexes and preserves reference matching and cleanup", async () => {
  const fs=createMemoryFileSystem();await fs.mkdir("/scratch");
  const backing=new PagedStorage({fs,cwd:"/scratch",env:{},signal:new AbortController().signal},4);
  const membership=new StoredReferenceMembership({fs,directory:"/scratch"});
  async function list(values:number[]):Promise<PdfStoredItems>{
    let position=-1,tail=-1;
    for(const value of values){tail=await appendStoredRecord(backing,cosRef(value),tail);if(position===-1)position=tail;}
    return {storage:backing,position,length:values.length};
  }
  try{
    const arrays=[];
    for(let i=0;i<4;i++)arrays.push(await list([0,-1,NaN,i+1,i+1,...Array.from({length:128},(_,n)=>n+10)]));
    for(const items of arrays){
      expect(await membership.has(items,0)).toBe(true);expect(await membership.has(items,-1)).toBe(true);expect(await membership.has(items,NaN)).toBe(true);
      expect(await membership.has(items,137)).toBe(true);expect(await membership.has(items,999)).toBe(false);
      expect((await fs.readdir("/scratch")).length).toBeLessThanOrEqual(2);
    }
    await expect(membership.has({storage:backing,position:-1,length:1},1)).rejects.toThrow("position");
  }finally{await membership.close();await backing.close();}
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("cancels layer index construction from a timer and removes temporary runs",async()=>{
  const fs=createMemoryFileSystem();await fs.mkdir("/scratch");
  const backing=new PagedStorage({fs,cwd:"/scratch",env:{},signal:new AbortController().signal},4);
  let position=-1,tail=-1;
  for(let i=0;i<1024;i++){tail=await appendStoredRecord(backing,cosRef(i),tail);if(position===-1)position=tail;}
  const controller=new AbortController(),failure=new Error("cancel layer index"),membership=new StoredReferenceMembership({fs,directory:"/scratch"},controller.signal);
  const timer=setTimeout(()=>controller.abort(failure),0);
  try{await expect(membership.has({storage:backing,position,length:1024},999)).rejects.toBe(failure);}
  finally{clearTimeout(timer);await membership.close();await backing.close();}
  expect(await fs.readdir("/scratch")).toEqual([]);
});
