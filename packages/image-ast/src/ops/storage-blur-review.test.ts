import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import type {ImageAstNode,RgbaImage} from "../ast.js";
import {transformStoredImage} from "./storage.js";
import {blurImage} from "./transform.js";
import {FloatReader,FloatWriter} from "./storage-floats.js";
type BlurOperation=Extract<ImageAstNode,{kind:"blur"}>;
type Profile=Pick<RgbaImage,"channels"|"hasAlpha"|"isPremultiplied">;
// Independently recorded from buffered blurImage at committed c3c6c41af9.
const vectors:{profile:Profile;operation:BlurOperation;hash:string}[]=[
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"blur","sigma":1.5,"minAmplitude":0.2,"precision":"float"},"hash":"1be19de34bd984d984ce75f528e7a345ac4e5f61eeaef48efb0c6f7723636f5c"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"blur","sigma":1.5,"minAmplitude":0.2,"precision":"float"},"hash":"5f9d86d059b392eb5ea4b6508f71ecc87da18b687dc15369201cb5f761de74d2"},
{"profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"blur","sigma":1.5,"minAmplitude":0.2,"precision":"float"},"hash":"d53d3e710b68ab53d701abf5dfa2e5a222291cdc9035046f4f42ed2c8a18aade"},
{"profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"blur","sigma":1.5,"minAmplitude":0.2,"precision":"float"},"hash":"951d77ae7ca141d7740a5cbcafbd0f78165d8525b6368bb7b2561742f947ca7a"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"blur","sigma":1.5,"minAmplitude":0.2,"precision":"float"},"hash":"de947d4192a5d74e6e7d0e58424a6f2a69d2e93dbb6107caca48a50b6088a418"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"blur","sigma":4.7,"minAmplitude":0.05,"precision":"float"},"hash":"4dc1066b7d6aa4ed506b9f29a8aad5024160938c6ff7e2c6cb8c1c1411317a2c"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"blur","sigma":4.7,"minAmplitude":0.05,"precision":"float"},"hash":"3667ec7706b676277c8bdd24d21e98af4c33e15dafe3cf868af4fbd46b5a4729"},
{"profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"blur","sigma":4.7,"minAmplitude":0.05,"precision":"float"},"hash":"d0f51108b31e1496b530b38beb42433fb8c4becec339d16c9365720879c7c26c"},
{"profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"blur","sigma":4.7,"minAmplitude":0.05,"precision":"float"},"hash":"6f29cb2d18375fb87fc5dd668651ca72cd7aebf89fd913004e2c10243a675c72"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"blur","sigma":4.7,"minAmplitude":0.05,"precision":"float"},"hash":"ccb1f7b674266019fc9b06e904a0170fa0684bdf5756d79033fb39761d76763e"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"blur","sigma":2.7,"minAmplitude":0.13,"precision":"integer"},"hash":"9b71b2a88d4d352d17a166d0e919f72e595bf7077020214f945c8224818141bb"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"blur","sigma":2.7,"minAmplitude":0.13,"precision":"integer"},"hash":"66cca2a5c76187c159b61bd248f8b04524aa33125b7a4499043af9116f25fcb4"},
{"profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"blur","sigma":2.7,"minAmplitude":0.13,"precision":"integer"},"hash":"55d2de126964debf052ab97ab8dc9d7e204fda9997e414d116d9d68c0edf30ce"},
{"profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"blur","sigma":2.7,"minAmplitude":0.13,"precision":"integer"},"hash":"4657b45040e6897b84a67866d732b3caa996a15daa0baba897a58590c87cd97a"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"blur","sigma":2.7,"minAmplitude":0.13,"precision":"integer"},"hash":"b99efcd214ebb720e61df6fd27405103d464aa084b694feeeaeada0803b1a189"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"blur","sigma":2.7,"minAmplitude":0.13,"precision":"approximate"},"hash":"9b71b2a88d4d352d17a166d0e919f72e595bf7077020214f945c8224818141bb"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"blur","sigma":2.7,"minAmplitude":0.13,"precision":"approximate"},"hash":"66cca2a5c76187c159b61bd248f8b04524aa33125b7a4499043af9116f25fcb4"},
{"profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"blur","sigma":2.7,"minAmplitude":0.13,"precision":"approximate"},"hash":"55d2de126964debf052ab97ab8dc9d7e204fda9997e414d116d9d68c0edf30ce"},
{"profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"blur","sigma":2.7,"minAmplitude":0.13,"precision":"approximate"},"hash":"4657b45040e6897b84a67866d732b3caa996a15daa0baba897a58590c87cd97a"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"blur","sigma":2.7,"minAmplitude":0.13,"precision":"approximate"},"hash":"b99efcd214ebb720e61df6fd27405103d464aa084b694feeeaeada0803b1a189"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"blur","sigma":1.5,"minAmplitude":1,"precision":"float"},"hash":"c4a185dd89630fbd51ec4645e4f015a289c6a70ac5d053389f045d9c475569cd"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"blur","sigma":1.5,"minAmplitude":1,"precision":"float"},"hash":"d7172941c4b666120b8d6a45ca068d1cfb8bcdcd0333ffbf98cf36f830b4efe1"},
{"profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"blur","sigma":1.5,"minAmplitude":1,"precision":"float"},"hash":"d55c04f43a4c521582c07694a4912b49c15c4e8827068a4820661ba497250b5e"},
{"profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"blur","sigma":1.5,"minAmplitude":1,"precision":"float"},"hash":"c7630aec8d533041593eb669dcace75bf3f48003a9a0e1f99e677f933f3ae9fd"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"blur","sigma":1.5,"minAmplitude":1,"precision":"float"},"hash":"c7630aec8d533041593eb669dcace75bf3f48003a9a0e1f99e677f933f3ae9fd"}
];
function fixture(profile:Profile={channels:3,hasAlpha:false},width=67,height=19) {
  const data=Uint8Array.from({length:width*height*4},(_,i)=>i%4===3&&profile.channels%2?255:(i*43+Math.floor(i/7))%256);
  if(profile.channels<3)for(let i=0;i<data.length;i+=4)data[i+1]=data[i+2]=data[i]!;
  const image:RgbaImage={width,height,data,format:"png",space:profile.channels<3?"b-w":"srgb",depth:"uchar",density:144,...profile};
  const memory=new Uint8Array(Math.max(1_000_000,data.length*8+8)),borrowed=new Uint8Array(4096);memory.set(data,8);let end=data.length+8;
  const storage={allocate:vi.fn((length:number)=>{const position=end;end+=length;if(end>memory.length)throw new Error("fixture exhausted");return position;}),read:vi.fn(async(position:number,length:number)=>{if(!Number.isSafeInteger(position)||position<8||length>4096||position+length>end)throw new Error("invalid backing read");borrowed.fill(59);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{if(!Number.isSafeInteger(position)||position<8||position+bytes.length>end)throw new Error("invalid backing write");memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  return {image,stored:{...metadata,position:8},storage,memory};
}
it.each(vectors)("preserves committed $operation.precision sigma=$operation.sigma for $profile",async({profile,operation,hash})=>{
  const {image,stored,storage,memory}=fixture(profile),expected=blurImage(image,operation.sigma,operation.minAmplitude,operation.precision);
  const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);
  expect({...actual,position:undefined}).toEqual({...expected,data:undefined});
  expect(createHash("sha256").update(expected.data).digest("hex")).toBe(hash);
  expect(createHash("sha256").update(memory.subarray(actual.position,actual.position+image.data.length)).digest("hex")).toBe(hash);
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
const operation:BlurOperation={kind:"blur",sigma:1.5,minAmplitude:0.2,precision:"float"};
it.each([1,2])("preserves cancellation in float blur pass %i",async pass=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={pass};let reads=0,writes=0;
  const read=storage.read.getMockImplementation()!;
  storage.read.mockImplementation(async(position,length)=>{const bytes=await read(position,length);if(storage.allocate.mock.calls.length===pass){reads=storage.read.mock.calls.length;writes=storage.write.mock.calls.length;controller.abort(reason);}return bytes;});
  await expect(transformStoredImage(stored,storage,operation,controller.signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(writes);
});
it("rejects truncated float scratch pages",async()=>{
  const {stored,storage}=fixture();const read=storage.read.getMockImplementation()!;
  storage.read.mockImplementation(async(position,length)=>storage.allocate.mock.calls.length===2?new Uint8Array(length-1):read(position,length));
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toThrow("Truncated float backing storage");
});
it.each([1,2])("propagates pass %i output failure without further reads",async pass=>{
  const {stored,storage}=fixture(),reason=new Error("blur write failed");const write=storage.write.getMockImplementation()!;let reads=0,writes=0;
  storage.write.mockImplementation(async(position,bytes)=>{if(storage.allocate.mock.calls.length===pass){reads=storage.read.mock.calls.length;writes=storage.write.mock.calls.length;throw reason;}await write(position,bytes);});
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(writes);
});
it("keeps float blur bytes bounded beyond both cache capacities",async()=>{
  const {image,stored,storage,memory}=fixture({channels:4,hasAlpha:true},1031,37),expected=blurImage(image,1.5,0.2,"float"),Original=Uint8Array;
  vi.stubGlobal("Uint8Array",new Proxy(Original,{construct(target,args){const length=typeof args[0]==="number"?args[0]:args[0]?.byteLength??0;if(length>4096)throw new Error("unbounded blur bytes");return Reflect.construct(target,args);}}));
  try {
    const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);
    expect(Buffer.compare(memory.subarray(actual.position,actual.position+image.data.length),expected.data)).toBe(0);
    expect(storage.read.mock.calls.length).toBeGreaterThan(64);
  } finally {vi.unstubAllGlobals();}
});
it("roundtrips Float32 values through little-endian borrowed pages and cache eviction",async()=>{
  const {storage,memory}=fixture(),signal=new AbortController().signal,length=34*1024+3,writer=new FloatWriter(length,storage,signal);
  const special=[-0,Infinity,-Infinity,NaN,1/3,1e-45,1e38];
  const value=(i:number)=>i<special.length?special[i]!:Math.sin(i)*1000;
  for(let i=0;i<length;i++)await writer.value(value(i));
  const values=await writer.finish(),reader=new FloatReader(values,storage,signal),view=new DataView(memory.buffer,values.position,length*4);
  for(const i of [0,1,2,3,4,5,6,...Array.from({length:35},(_,i)=>i*1024),length-1,0,4]) {
    expect(await reader.value(i)).toBe(Math.fround(value(i)));expect(view.getFloat32(i*4,true)).toBe(Math.fround(value(i)));
  }
  expect(storage.read.mock.calls.filter(([position])=>position===values.position).length).toBe(2);
});
it.each([-1,1.5,NaN,Number.MAX_SAFE_INTEGER])("rejects invalid float length %s before allocation",length=>{
  const {storage}=fixture();expect(()=>new FloatWriter(length,storage,new AbortController().signal)).toThrow("Invalid float storage length");expect(storage.allocate).not.toHaveBeenCalled();
});
it.each([-1,0.5,Number.MAX_SAFE_INTEGER])("rejects invalid float allocation %s",position=>{
  const {storage}=fixture();storage.allocate.mockReturnValueOnce(position);expect(()=>new FloatWriter(3,storage,new AbortController().signal)).toThrow("Invalid float backing allocation");
});
it("rejects incomplete or overflowing float writes",async()=>{
  const {storage}=fixture(),writer=new FloatWriter(2,storage,new AbortController().signal);await writer.value(1);
  await expect(writer.finish()).rejects.toThrow("Incomplete float backing storage");await writer.value(2);await writer.finish();
  await expect(writer.value(3)).rejects.toThrow("Float backing storage overflow");
});
it.each([-1,0.5,3,Infinity])("rejects float read index %s before backend access",async index=>{
  const {storage}=fixture(),reader=new FloatReader({position:8,length:3},storage,new AbortController().signal);
  await expect(reader.value(index)).rejects.toThrow("Invalid float storage index");expect(storage.read).not.toHaveBeenCalled();
});
it("preserves cancellation from a float writer backend",async()=>{
  const {storage}=fixture(),controller=new AbortController(),reason={cancel:true},writer=new FloatWriter(1,storage,controller.signal);
  storage.write.mockImplementationOnce(async()=>{controller.abort(reason);});await writer.value(1);await expect(writer.finish()).rejects.toBe(reason);
});
