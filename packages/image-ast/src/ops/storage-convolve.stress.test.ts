import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import type {ImageAstNode,RgbaImage} from "../ast.js";
import {transformStoredImage} from "./storage.js";
import {convolveImage} from "./transform.js";
type ConvolveOperation=Extract<ImageAstNode,{kind:"convolve"}>;
type Profile=Pick<RgbaImage,"channels"|"hasAlpha"|"isPremultiplied">;
// Recorded from original buffered convolveImage at committed705f613eb8.
const vectors:{name:string;profile:Profile;operation:ConvolveOperation;hash:string}[]=[
{"name":"odd","profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"convolve","width":3,"height":3,"kernel":[1,2,-1,0,3,0,-1,2,1],"scale":3.3,"offset":17},"hash":"9a8924c93e39c901b095cdedbad23b5089985fc3e7c4b428dd586612417abf0b"},
{"name":"odd","profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"convolve","width":3,"height":3,"kernel":[1,2,-1,0,3,0,-1,2,1],"scale":3.3,"offset":17},"hash":"b021c17249aa756ba5cdb9c2a673938cc6efc4e8c665f1d87bb6f51af8088866"},
{"name":"odd","profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"convolve","width":3,"height":3,"kernel":[1,2,-1,0,3,0,-1,2,1],"scale":3.3,"offset":17},"hash":"a0a783ac501339221a0c820678cb65758c5a7ebda6daf7099565957bc909284f"},
{"name":"odd","profile":{"channels":4,"hasAlpha":true},"operation":{"kind":"convolve","width":3,"height":3,"kernel":[1,2,-1,0,3,0,-1,2,1],"scale":3.3,"offset":17},"hash":"e2275b7cc4654958aef59992463a1bb7ef00bdb76a1b798831aff5aad8d16982"},
{"name":"odd","profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"convolve","width":3,"height":3,"kernel":[1,2,-1,0,3,0,-1,2,1],"scale":3.3,"offset":17},"hash":"e2275b7cc4654958aef59992463a1bb7ef00bdb76a1b798831aff5aad8d16982"},
{"name":"odd","profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"convolve","width":3,"height":3,"kernel":[1,2,-1,0,3,0,-1,2,1],"scale":3.3,"offset":17},"hash":"203f7e351bab5195960a3234f5e1d15a8bff71046c5d176b3bd03a1371126759"},
{"name":"even-rectangle","profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"convolve","width":2,"height":4,"kernel":[0.5,-1,2,0.2,3,-0.75,1,0],"scale":0,"offset":-17},"hash":"58d979527919d5cac1ea60b253c8ee53ea649fcb42d214b828958d5e7b6e0f14"},
{"name":"even-rectangle","profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"convolve","width":2,"height":4,"kernel":[0.5,-1,2,0.2,3,-0.75,1,0],"scale":0,"offset":-17},"hash":"6ce38c6b9217bc507c8e3f67b0419a2f42ca72c3179d4c88a5a48cbcdc484907"},
{"name":"even-rectangle","profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"convolve","width":2,"height":4,"kernel":[0.5,-1,2,0.2,3,-0.75,1,0],"scale":0,"offset":-17},"hash":"2f2df140215d619afc7900ddaa5906c08c5e0470b77b3bd55d81552227579708"},
{"name":"even-rectangle","profile":{"channels":4,"hasAlpha":true},"operation":{"kind":"convolve","width":2,"height":4,"kernel":[0.5,-1,2,0.2,3,-0.75,1,0],"scale":0,"offset":-17},"hash":"6ec1ba65cf3879364a219ea58d6b4bef78101f9943c855e6ec611276e1ea01c3"},
{"name":"even-rectangle","profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"convolve","width":2,"height":4,"kernel":[0.5,-1,2,0.2,3,-0.75,1,0],"scale":0,"offset":-17},"hash":"6ec1ba65cf3879364a219ea58d6b4bef78101f9943c855e6ec611276e1ea01c3"},
{"name":"even-rectangle","profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"convolve","width":2,"height":4,"kernel":[0.5,-1,2,0.2,3,-0.75,1,0],"scale":0,"offset":-17},"hash":"bc141eb959d613ac5fde19c4d0967b433d56d83d4c150201cb9625e9b338ed6f"},
{"name":"wide-negative","profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"convolve","width":4,"height":1,"kernel":[-1,2,-3,4],"scale":-2.5,"offset":131},"hash":"d45bfbc6c01a03ed0bfff2e8537c1bbdd0800eff2e53be7c666a4221782c3731"},
{"name":"wide-negative","profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"convolve","width":4,"height":1,"kernel":[-1,2,-3,4],"scale":-2.5,"offset":131},"hash":"fd414981c17e8313f30965800e9d5cd9e71380b412ff653abd207a5a2e0fdb23"},
{"name":"wide-negative","profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"convolve","width":4,"height":1,"kernel":[-1,2,-3,4],"scale":-2.5,"offset":131},"hash":"13a08a6914fff103e39a38aeacd0c7c9457136f86d40443de0b55a17e80069ad"},
{"name":"wide-negative","profile":{"channels":4,"hasAlpha":true},"operation":{"kind":"convolve","width":4,"height":1,"kernel":[-1,2,-3,4],"scale":-2.5,"offset":131},"hash":"ff3a7ba61cd99bc76674d3dab228a789c60c66762866f161dcedcd041e5131d1"},
{"name":"wide-negative","profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"convolve","width":4,"height":1,"kernel":[-1,2,-3,4],"scale":-2.5,"offset":131},"hash":"ff3a7ba61cd99bc76674d3dab228a789c60c66762866f161dcedcd041e5131d1"},
{"name":"wide-negative","profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"convolve","width":4,"height":1,"kernel":[-1,2,-3,4],"scale":-2.5,"offset":131},"hash":"375ffdf34838b42e20e120560064e5b57ee83a3d539c5c857a935c2859bb3d5f"},
{"name":"missing-entries","profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"convolve","width":2,"height":3,"kernel":[1,-1],"scale":1,"offset":0},"hash":"8ce15b62948958372e3ef308e2d493e6d07fe4508f163f7517a3accb31278bc9"},
{"name":"missing-entries","profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"convolve","width":2,"height":3,"kernel":[1,-1],"scale":1,"offset":0},"hash":"a349975ba7efdec3cc296d96a14aceae6f333a8a7f7f6d561a4c63fcf09d1059"},
{"name":"missing-entries","profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"convolve","width":2,"height":3,"kernel":[1,-1],"scale":1,"offset":0},"hash":"9f86d2bb5f5cbde895b72717ef43d4455a89eec5af73dfc3b9b661c6d7b073e2"},
{"name":"missing-entries","profile":{"channels":4,"hasAlpha":true},"operation":{"kind":"convolve","width":2,"height":3,"kernel":[1,-1],"scale":1,"offset":0},"hash":"7baa59daaa462f9abc48bf9519daee59c29e17f5dfcb8a7d5eb1e68ee2312fac"},
{"name":"missing-entries","profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"convolve","width":2,"height":3,"kernel":[1,-1],"scale":1,"offset":0},"hash":"7baa59daaa462f9abc48bf9519daee59c29e17f5dfcb8a7d5eb1e68ee2312fac"},
{"name":"missing-entries","profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"convolve","width":2,"height":3,"kernel":[1,-1],"scale":1,"offset":0},"hash":"8318abe190b842626bc4644430fa3f589790958d83f369b83b6a844e4abb8be1"}
];
function fixture(profile:Profile={channels:4,hasAlpha:true},width=67,height=19) {
  const data=Uint8Array.from({length:width*height*4},(_,i)=>i%4===3&&profile.channels%2?255:(i*43+Math.floor(i/7))%256);
  if(profile.channels<3)for(let i=0;i<data.length;i+=4)data[i+1]=data[i+2]=data[i]!;
  const image:RgbaImage={width,height,data,format:"png",space:profile.channels<3?"b-w":"srgb",depth:"uchar",density:144,...profile};
  const memory=new Uint8Array(data.length*2+8),borrowed=new Uint8Array(4096);memory.set(data,8);let end=data.length+8;
  const storage={allocate:vi.fn((length:number)=>{const position=end;end+=length;if(end>memory.length)throw new Error("fixture exhausted");return position;}),read:vi.fn(async(position:number,length:number)=>{if(!Number.isSafeInteger(position)||position<8||length>4096||position+length>end)throw new Error("invalid backing read");borrowed.fill(53);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{if(!Number.isSafeInteger(position)||position<8||position+bytes.length>end)throw new Error("invalid backing write");memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  return {image,stored:{...metadata,position:8},storage,memory};
}
it.each(vectors)("preserves committed $name convolution for $profile",async({profile,operation,hash})=>{
  const {image,stored,storage,memory}=fixture(profile),expected=convolveImage(image,operation);
  const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);
  expect({...actual,position:undefined}).toEqual({...expected,data:undefined});
  expect(createHash("sha256").update(expected.data).digest("hex")).toBe(hash);
  expect(createHash("sha256").update(memory.subarray(actual.position,actual.position+image.data.length)).digest("hex")).toBe(hash);
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
const operation:ConvolveOperation={kind:"convolve",width:3,height:3,kernel:[1,1,1,1,1,1,1,1,1],scale:9,offset:0};
it.each(["before","read","write"])("preserves %s cancellation without additional I/O",async phase=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={phase};let reads=0;
  if(phase==="before")controller.abort(reason);
  if(phase==="read") {const read=storage.read.getMockImplementation()!;storage.read.mockImplementationOnce(async(position,length)=>{const bytes=await read(position,length);reads=storage.read.mock.calls.length;controller.abort(reason);return bytes;});}
  if(phase==="write")storage.write.mockImplementationOnce(async()=>{reads=storage.read.mock.calls.length;controller.abort(reason);});
  await expect(transformStoredImage(stored,storage,operation,controller.signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(phase==="write"?1:0);
});
it("rejects truncated borrowed source pages",async()=>{
  const {stored,storage}=fixture();storage.read.mockResolvedValueOnce(new Uint8Array(4095));
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toThrow("Truncated image backing storage");
  expect(storage.write).not.toHaveBeenCalled();
});
it("propagates a write failure without continuing to another output chunk",async()=>{
  const {stored,storage}=fixture(),reason=new Error("convolution output failed");let reads=0;
  storage.write.mockImplementationOnce(async()=>{reads=storage.read.mock.calls.length;throw reason;});
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(1);
});
it("keeps cache and scratch byte buffers bounded across wide borrowed pages",async()=>{
  const {image,stored,storage,memory}=fixture({channels:4,hasAlpha:true},1031,37),expected=convolveImage(image,operation),Original=Uint8Array;
  vi.stubGlobal("Uint8Array",new Proxy(Original,{construct(target,args){const length=typeof args[0]==="number"?args[0]:args[0]?.byteLength??0;if(length>4096)throw new Error("unbounded convolution bytes");return Reflect.construct(target,args);}}));
  try {
    const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);
    expect(Buffer.compare(memory.subarray(actual.position,actual.position+image.data.length),expected.data)).toBe(0);
    expect(storage.read.mock.calls.length).toBeGreaterThan(32);
  } finally {vi.unstubAllGlobals();}
});
it("yields to timer cancellation while repeatedly sampling cached kernel pixels",async()=>{
  const {stored,storage}=fixture({channels:4,hasAlpha:true},3,3),controller=new AbortController(),reason={cancel:"large kernel"};
  const timer=setTimeout(()=>controller.abort(reason),0);
  try {
    await expect(transformStoredImage(stored,storage,{...operation,width:129,height:129,kernel:[]},controller.signal)).rejects.toBe(reason);
    expect(storage.write).not.toHaveBeenCalled();
  } finally {clearTimeout(timer);}
});
