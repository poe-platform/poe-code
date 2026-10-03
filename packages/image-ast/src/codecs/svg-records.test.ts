import {expect,test} from "vitest";
import {SvgRecords} from "./svg-records.js";
import type {ImageByteStorage} from "./png-storage.js";

function backing(){
 const pages=new Map<number,Uint8Array>();let size=101,reads=0;const borrowed=new Uint8Array(4096);
 const storage:ImageByteStorage={allocate(length){expect(length).toBe(4096);const position=size;size+=length+17;return position;},async write(position,bytes){expect(bytes.length).toBe(4096);pages.set(position,new Uint8Array(bytes));},async read(position,length){reads++;expect(length).toBe(4096);borrowed.set(pages.get(position)!);return borrowed;}};
 return {storage,pages,get reads(){return reads;}};
}

test("stores long point sequences in caller pages and replays without a page-index array",async()=>{
 const caller=backing(),records=new SvgRecords(2,caller.storage,new AbortController().signal);
 for(let i=0;i<2000;i++)await records.push([i+.25,-i]);await records.finish();
 expect(records.length).toBe(2000);expect(caller.pages.size).toBe(8);
 for(let round=0;round<2;round++)for(let i=0;i<2000;i++){expect(await records.get(i)).toEqual([i+.25,-i]);expect(await records.get(1999)).toEqual([1999.25,-1999]);}
 expect(caller.reads).toBeLessThan(20);
});

test("owns borrowed pages and preserves storage errors and cancellation",async()=>{
 const caller=backing(),controller=new AbortController(),records=new SvgRecords(1,caller.storage,controller.signal);
 await records.push([65]);await records.push([66]);await records.finish();expect(await records.get(0)).toEqual([65]);
 const failure=new Error('cancel records');controller.abort(failure);await expect(records.get(1)).rejects.toBe(failure);
 const failing=new SvgRecords(2,{...caller.storage,async write(){throw failure;}},new AbortController().signal);await failing.push([1,2]);await expect(failing.finish()).rejects.toBe(failure);
});
