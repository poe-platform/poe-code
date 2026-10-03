import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import type {ImageAstNode,RgbaImage} from "../ast.js";
import sharp from "../index.js";
import {transformStoredImage} from "./storage.js";
import {claheImage} from "./transform.js";
type Operation=Extract<ImageAstNode,{kind:"clahe"}>;
type Profile=Pick<RgbaImage,"channels"|"space"|"hasAlpha">;
// Independent output vectors from committed c29d0b9919, before histogram extraction.
const vectors:{sw:number;sh:number;profile:Profile;operation:Operation;hash:string}[]=[
{"sw":17,"sh":11,"profile":{"channels":1,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":3,"height":5,"maxSlope":0},"hash":"59f3e2b41cd9340e0eabd45c72b58811c79c11c232cf4a989e8bcf5d5e85300c"},
{"sw":17,"sh":11,"profile":{"channels":2,"space":"b-w","hasAlpha":true},"operation":{"kind":"clahe","width":3,"height":5,"maxSlope":0},"hash":"26f5eabbbd0fae98b4c566eb62a6aa9f5da5604b0ce9dffb417b1c4d3d739452"},
{"sw":17,"sh":11,"profile":{"channels":3,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":3,"height":5,"maxSlope":0},"hash":"a08e29bb1fb9f7bfae16814d2ca938730b845d0adbe614960be23e44b238d5db"},
{"sw":17,"sh":11,"profile":{"channels":4,"space":"srgb","hasAlpha":true},"operation":{"kind":"clahe","width":3,"height":5,"maxSlope":0},"hash":"e9515b4bfe65cd4e8e9b45a73e19e6f0b92934d10934c3da68a4fdf68db9f591"},
{"sw":17,"sh":11,"profile":{"channels":3,"space":"b-w","hasAlpha":false},"operation":{"kind":"clahe","width":3,"height":5,"maxSlope":0},"hash":"26f5eabbbd0fae98b4c566eb62a6aa9f5da5604b0ce9dffb417b1c4d3d739452"},
{"sw":17,"sh":11,"profile":{"channels":1,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":4,"height":6,"maxSlope":-2},"hash":"6003ced43cbb47261e384187fb0f03eaf05d232929bbacd67c3bafe7f3b13303"},
{"sw":17,"sh":11,"profile":{"channels":2,"space":"b-w","hasAlpha":true},"operation":{"kind":"clahe","width":4,"height":6,"maxSlope":-2},"hash":"83a13c9dc3dba8aff6b76e3d7e908c9718c0b11ed3b2e9d2338d6f4b3d72993b"},
{"sw":17,"sh":11,"profile":{"channels":3,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":4,"height":6,"maxSlope":-2},"hash":"30f5db78f32edd87a52945bd3867bdc669b37d9fe099f11bc94ca3e68e7cf007"},
{"sw":17,"sh":11,"profile":{"channels":4,"space":"srgb","hasAlpha":true},"operation":{"kind":"clahe","width":4,"height":6,"maxSlope":-2},"hash":"6a0d1442d1dd3894067be27a043b7df8a273ccc7d78e44b805d65c25e0a31aad"},
{"sw":17,"sh":11,"profile":{"channels":3,"space":"b-w","hasAlpha":false},"operation":{"kind":"clahe","width":4,"height":6,"maxSlope":-2},"hash":"83a13c9dc3dba8aff6b76e3d7e908c9718c0b11ed3b2e9d2338d6f4b3d72993b"},
{"sw":17,"sh":11,"profile":{"channels":1,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":25,"height":23,"maxSlope":1.75},"hash":"b41d7e6e251f5458e69bc61bf0599fb83ff7d6102400cf0e2621459b279dd7a9"},
{"sw":17,"sh":11,"profile":{"channels":2,"space":"b-w","hasAlpha":true},"operation":{"kind":"clahe","width":25,"height":23,"maxSlope":1.75},"hash":"7153eb97e400ffbbdf7b5129b2cbb6e8c500cf289c5c33f46e7e09a126a43139"},
{"sw":17,"sh":11,"profile":{"channels":3,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":25,"height":23,"maxSlope":1.75},"hash":"93dd929135b3e68845ea5fd4497e09105a0bf272185f2f23dfc5d5803c001b8d"},
{"sw":17,"sh":11,"profile":{"channels":4,"space":"srgb","hasAlpha":true},"operation":{"kind":"clahe","width":25,"height":23,"maxSlope":1.75},"hash":"0288788e9da7472315f49be0fbe49fb015b8cabdd3d9b16c115e5d870774b0a7"},
{"sw":17,"sh":11,"profile":{"channels":3,"space":"b-w","hasAlpha":false},"operation":{"kind":"clahe","width":25,"height":23,"maxSlope":1.75},"hash":"7153eb97e400ffbbdf7b5129b2cbb6e8c500cf289c5c33f46e7e09a126a43139"},
{"sw":1,"sh":17,"profile":{"channels":1,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":4,"height":7,"maxSlope":3},"hash":"c1f85cc0364f5932a44102dcfa91fd160176a4fa39f535c94385eb68c618563c"},
{"sw":1,"sh":17,"profile":{"channels":2,"space":"b-w","hasAlpha":true},"operation":{"kind":"clahe","width":4,"height":7,"maxSlope":3},"hash":"ee51b72e678206da9766c1f21e4c86f91d3db69032c13ad02527ff09fcff30db"},
{"sw":1,"sh":17,"profile":{"channels":3,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":4,"height":7,"maxSlope":3},"hash":"19d58b82fe077fd592ce73796b606eb9d900435aa0f3b61c2cf3936583a1f9f8"},
{"sw":1,"sh":17,"profile":{"channels":4,"space":"srgb","hasAlpha":true},"operation":{"kind":"clahe","width":4,"height":7,"maxSlope":3},"hash":"544feb4fafd68d11bf367af42bd527dcb397d4d2ad4e13049b239d62c95db555"},
{"sw":1,"sh":17,"profile":{"channels":3,"space":"b-w","hasAlpha":false},"operation":{"kind":"clahe","width":4,"height":7,"maxSlope":3},"hash":"ee51b72e678206da9766c1f21e4c86f91d3db69032c13ad02527ff09fcff30db"},
{"sw":17,"sh":1,"profile":{"channels":1,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":5,"height":4,"maxSlope":3},"hash":"2417cd05deb0ea5d6ed64766a22ca2206abcda81f80a30636a4f623c02e3675d"},
{"sw":17,"sh":1,"profile":{"channels":2,"space":"b-w","hasAlpha":true},"operation":{"kind":"clahe","width":5,"height":4,"maxSlope":3},"hash":"c69c356162254a9ec4934d46d544a9317e3fad4fa015aba724bebc0b4ec02a44"},
{"sw":17,"sh":1,"profile":{"channels":3,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":5,"height":4,"maxSlope":3},"hash":"115e81c597c5f97079b234815520e1894ecb26fd078b9315dff6121b865265bc"},
{"sw":17,"sh":1,"profile":{"channels":4,"space":"srgb","hasAlpha":true},"operation":{"kind":"clahe","width":5,"height":4,"maxSlope":3},"hash":"84da7641f1bf75cb94818b1bade5351eac8b4c7ff458712afb7a8f7c8d4655e7"},
{"sw":17,"sh":1,"profile":{"channels":3,"space":"b-w","hasAlpha":false},"operation":{"kind":"clahe","width":5,"height":4,"maxSlope":3},"hash":"c69c356162254a9ec4934d46d544a9317e3fad4fa015aba724bebc0b4ec02a44"},
{"sw":1,"sh":1,"profile":{"channels":1,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":8,"height":8,"maxSlope":100},"hash":"4075c41026f9638105995f40c772f5a93eea85c0da9b2e0181903a347d382b99"},
{"sw":1,"sh":1,"profile":{"channels":2,"space":"b-w","hasAlpha":true},"operation":{"kind":"clahe","width":8,"height":8,"maxSlope":100},"hash":"ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e"},
{"sw":1,"sh":1,"profile":{"channels":3,"space":"srgb","hasAlpha":false},"operation":{"kind":"clahe","width":8,"height":8,"maxSlope":100},"hash":"4075c41026f9638105995f40c772f5a93eea85c0da9b2e0181903a347d382b99"},
{"sw":1,"sh":1,"profile":{"channels":4,"space":"srgb","hasAlpha":true},"operation":{"kind":"clahe","width":8,"height":8,"maxSlope":100},"hash":"ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e"},
{"sw":1,"sh":1,"profile":{"channels":3,"space":"b-w","hasAlpha":false},"operation":{"kind":"clahe","width":8,"height":8,"maxSlope":100},"hash":"ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e"}
];
function fixture(profile:Profile={channels:4,space:"srgb",hasAlpha:true},width=17,height=11) {
  const data=Uint8Array.from({length:width*height*4},(_,i)=>(i*43+Math.floor(i/7))%256);
  const image:RgbaImage={width,height,data,format:"png",depth:"uchar",density:144,...profile};
  const memory=new Uint8Array(data.length*2+8),borrowed=new Uint8Array(4096);memory.set(data,8);let end=data.length+8;
  const storage={allocate:vi.fn((length:number)=>{const position=end;end+=length;if(end>memory.length)throw new Error("fixture exhausted");return position;}),read:vi.fn(async(position:number,length:number)=>{if(!Number.isSafeInteger(position)||position<8||length>4096||position+length>end)throw new Error("invalid backing read");borrowed.fill(89);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{if(!Number.isSafeInteger(position)||position<8||position+bytes.length>end)throw new Error("invalid backing write");memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  return {image,stored:{...metadata,position:8},storage,memory};
}
it.each(vectors)("preserves CLAHE $sw x $sh $operation for $profile",async({sw,sh,profile,operation,hash})=>{
  const {image,stored,storage,memory}=fixture(profile,sw,sh),expected=claheImage(image,operation);
  const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);
  expect({...actual,position:undefined}).toEqual({...expected,data:undefined});
  expect(createHash("sha256").update(expected.data).digest("hex")).toBe(hash);
  expect(createHash("sha256").update(memory.subarray(actual.position,actual.position+image.data.length)).digest("hex")).toBe(hash);
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
const operation:Operation={kind:"clahe",width:3,height:4,maxSlope:3};
it("keeps the public default slope and argument rejection semantics",()=>{
  const image=sharp({create:{width:1,height:1,channels:4,background:"red"}});
  expect(image.clahe({width:3,height:4}).getAst()).toContainEqual(operation);
  for(const maxSlope of [-1,1.75,101,NaN])expect(()=>image.clahe({width:3,height:4,maxSlope})).toThrow("Expected integer between 0 and 100");
  for(const width of [0,-1,1.75,Infinity])expect(()=>image.clahe({width,height:4})).toThrow("Expected integer greater than zero");
});
it.each(["before","read","write"])("honors cancellation at %s without further storage work",async phase=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={phase};let reads=0;
  if(phase==="before")controller.abort(reason);
  if(phase==="read"){const read=storage.read.getMockImplementation()!;storage.read.mockImplementationOnce(async(position,length)=>{const bytes=await read(position,length);reads=storage.read.mock.calls.length;controller.abort(reason);return bytes;});}
  if(phase==="write")storage.write.mockImplementationOnce(async()=>{reads=storage.read.mock.calls.length;controller.abort(reason);});
  await expect(transformStoredImage(stored,storage,operation,controller.signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(phase==="write"?1:0);
});
it.each(["read","write"])("propagates backend %s errors",async phase=>{
  const {stored,storage}=fixture(),reason=new Error(phase);let reads=0;
  if(phase==="read")storage.read.mockRejectedValueOnce(reason);
  else storage.write.mockImplementationOnce(async()=>{reads=storage.read.mock.calls.length;throw reason;});
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(phase==="read"?1:reads);expect(storage.write).toHaveBeenCalledTimes(phase==="read"?0:1);
});
it("rejects a truncated borrowed histogram page",async()=>{
  const {stored,storage}=fixture();storage.read.mockResolvedValueOnce(new Uint8Array(3));
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toThrow("Truncated image backing storage");expect(storage.write).not.toHaveBeenCalled();
});
it("rejects output allocation before reading histogram samples",async()=>{
  const {stored,storage}=fixture();storage.allocate.mockReturnValueOnce(-1);
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toThrow("Invalid image backing allocation");expect(storage.read).not.toHaveBeenCalled();
});
it("keeps byte pages and histogram tables bounded beyond the source cache",async()=>{
  const {image,stored,storage,memory}=fixture({channels:1,space:"b-w",hasAlpha:false},1031,32),expected=claheImage(image,operation);
  for(const name of ["Uint8Array","Int32Array"] as const){const Original=globalThis[name];vi.stubGlobal(name,new Proxy(Original,{construct(target,args){const length=typeof args[0]==="number"?args[0]:args[0]?.length??0;if(length>(name==="Int32Array"?256:4096))throw new Error("unbounded CLAHE buffer");return Reflect.construct(target,args);}}));}
  try {const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);expect(Buffer.compare(memory.subarray(actual.position,actual.position+image.data.length),expected.data)).toBe(0);expect(storage.read.mock.calls.length).toBeGreaterThan(32);}
  finally{vi.unstubAllGlobals();}
});
it.each([3,257])("yields to timer cancellation while processing window %s",async width=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={width},timer=setTimeout(()=>controller.abort(reason),0);
  try {await expect(transformStoredImage(stored,storage,{...operation,width,height:width},controller.signal)).rejects.toBe(reason);expect(storage.write).not.toHaveBeenCalled();}
  finally{clearTimeout(timer);}
});
