import {expect,it} from "vitest";
import sharp from "./index.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
const kernel={width:3,height:3,kernel:[1,2,1,2,4,2,1,2,1]};
const pipelines=[
 (s:ReturnType<typeof sharp>)=>s.rotate(37,{background:{r:19,g:43,b:81,alpha:0.4}}),
 (s:ReturnType<typeof sharp>)=>s.resize(9,7).rotate(37).blur(1.5).gamma(2.2),
 (s:ReturnType<typeof sharp>)=>s.affine([1.2,0.3,-0.4,0.8],{interpolator:"bicubic",idx:0.4,ody:-0.7,background:"transparent"}),
 (s:ReturnType<typeof sharp>)=>s.resize(9,7).affine([1,0.3,0.2,1],{interpolator:"nearest"}).sharpen({sigma:1.5}),

 (s:ReturnType<typeof sharp>)=>s.sharpen(),
 (s:ReturnType<typeof sharp>)=>s.sharpen({sigma:1.5,m1:0.5,m2:3,x1:1,y2:12,y3:25}),
 (s:ReturnType<typeof sharp>)=>s.gamma(2.2).resize(9,7).blur({sigma:1.5,precision:"float"}).sharpen({sigma:2}),
 (s:ReturnType<typeof sharp>)=>s.sharpen({sigma:0.1}).convolve(kernel).gamma(2.2),

 (s:ReturnType<typeof sharp>)=>s.blur(),
 (s:ReturnType<typeof sharp>)=>s.blur({sigma:1.5,precision:"float"}),
 (s:ReturnType<typeof sharp>)=>s.blur({sigma:5,precision:"approximate"}),
 (s:ReturnType<typeof sharp>)=>s.gamma(2.2).resize(9,7).blur({sigma:1.5,precision:"float"}).convolve(kernel),
 (s:ReturnType<typeof sharp>)=>s.resize(9,7).blur(1.5).convolve(kernel).gamma(2.2),
 (s:ReturnType<typeof sharp>)=>s.convolve(kernel),
 (s:ReturnType<typeof sharp>)=>s.resize(9,7).convolve(kernel),
 (s:ReturnType<typeof sharp>)=>s.gamma(2.2).resize(9,7).median(3).convolve(kernel).modulate({brightness:1.2}),
 (s:ReturnType<typeof sharp>)=>s.convolve(kernel).resize(9,7).flip().rotate(90).gamma(2.2),
 (s:ReturnType<typeof sharp>)=>s.resize(9,7).threshold(80).convolve({...kernel,offset:3}).normalize()
];
it.each(pipelines.map((pipeline,index)=>({pipeline,index})))("preserves convolution pipeline $index through backed files",async({pipeline})=>{
 const fs=new MemoryFileSystem(),data=Uint8Array.from({length:19*13*4},(_,i)=>(i*43+Math.floor(i/7))%256);
 const input=sharp(data,{raw:{width:19,height:13,channels:4}}).png().toBufferSync();await fs.writeFile("/in.png",input);
 const guarded=new Proxy(fs,{get(target,key){if(key==="readFile"||key==="writeFile") return ()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const expected=pipeline(sharp(input)).png().toBufferWithObjectSync();
 const info=await pipeline(sharp("/in.png",{filesystem:guarded})).png().toFile("/out.png"),output=await fs.readFile("/out.png");
 expect(info).toEqual({...expected.info,size:output.length});
 expect(Buffer.compare(sharp(output).raw().toBufferSync(),sharp(expected.data).raw().toBufferSync())).toBe(0);
 expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.png","out.png"]);
});
