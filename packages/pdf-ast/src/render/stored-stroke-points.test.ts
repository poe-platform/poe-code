import {expect,it} from "vitest";
import type {PdfPixelStorage} from "../ast.js";
import {StoredStrokePoints} from "./stored-stroke-points.js";

it("reads interleaved point lists forward and backward with fixed caller-backed pages",async()=>{
 const bytes=new Uint8Array(1<<20),borrowed=new Uint8Array(4096);let end=0,peak=0,pending:(()=>Promise<void>)|undefined;
 const storage:PdfPixelStorage={allocate(length){const at=end;end+=length;return at;},async write(at,value){peak=Math.max(peak,value.length);bytes.set(value,at);},async read(at,length){peak=Math.max(peak,length);borrowed.set(bytes.subarray(at,at+length));return borrowed.subarray(0,length);}};
 function* io(action:()=>Promise<void>):Generator<null,void,void>{pending=action;yield null;}
 async function run<T>(work:Generator<null,T,void>):Promise<T>{let step=work.next();while(!step.done){const action=pending!;pending=undefined;await action();step=work.next();}return step.value;}
 const first=new StoredStrokePoints(storage,io),second=first.create();
 for(let i=0;i<2049;i++){await run(first.push([i,-i]));await run(second.push([i+0.5,i*2]));}
 for(let i=0;i<2049;i++){expect(await run(first.get(i))).toEqual([i,-i]);expect(await run(second.get(2048-i))).toEqual([2048-i,(2048-i)*2].map((v,j)=>j===0?v+0.5:v));}
 expect(await run(first.get(2048))).toEqual([2048,-2048]);expect(await run(first.get(0))).toEqual([0,-0]);
 expect(peak).toBeLessThanOrEqual(4096);
 first.trimLast();expect(first.length).toBe(2048);expect(await run(first.get(2047))).toEqual([2047,-2047]);
 await expect(run(first.get(2048))).rejects.toThrow();
});

it("trims across a page boundary without changing earlier points",async()=>{
 const bytes=new Uint8Array(16384);let end=0,pending:(()=>Promise<void>)|undefined;
 const storage:PdfPixelStorage={allocate(n){const at=end;end+=n;return at;},async write(at,b){bytes.set(b,at);},async read(at,n){return bytes.subarray(at,at+n);}};
 function* io(action:()=>Promise<void>):Generator<null,void,void>{pending=action;yield null;}
 async function run<T>(work:Generator<null,T,void>):Promise<T>{let step=work.next();while(!step.done){await pending!();step=work.next();}return step.value;}
 const points=new StoredStrokePoints(storage,io);
 for(let i=0;i<256;i++)await run(points.push([i,i]));
 points.trimLast();expect(points.length).toBe(255);expect(await run(points.get(254))).toEqual([254,254]);expect(await run(points.get(0))).toEqual([0,0]);
});

it("feeds stored points through the same normalization, dashes and joins",async()=>{
 const {strokeOutlinePoints}=await import("./stroke.js");
 const bytes=new Uint8Array(1<<22);let end=0,pending:(()=>Promise<void>)|undefined;
 const storage:PdfPixelStorage={allocate(n){const at=end;end+=n;return at;},async write(at,b){bytes.set(b,at);},async read(at,n){return bytes.subarray(at,at+n);}};
 function* io(action:()=>Promise<void>):Generator<null,void,void>{pending=action;yield null;}
 async function run<T>(work:Generator<null,T,void>):Promise<T>{let step=work.next();while(!step.done){await pending!();step=work.next();}return step.value;}
 const raw:Array<readonly [number,number]>=Array.from({length:300},(_,i)=>[Math.cos(i/50)*10,Math.sin(i/50)*10]);raw.push(raw[0]!);
 for(const closed of [false,true])for(const cap of [0,1,2] as const)for(const dash of [[],[2,1],[0,2],[1000,1]]){
  const source=new StoredStrokePoints(storage,io);for(const point of raw)await run(source.push(point));
  const expected=[...strokeOutlinePoints([{points:raw,closed}],1,cap,1,10,dash,0.25)];
  const actual=[];for(const point of strokeOutlinePoints([{points:source,closed}],1,cap,1,10,dash,0.25)){
   if(point===null)await pending!();else actual.push(point);
  }
  expect(actual).toEqual(expected);
 }
});
