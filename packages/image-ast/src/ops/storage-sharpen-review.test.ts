import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import type {ImageAstNode,RgbaImage} from "../ast.js";
import {transformStoredImage} from "./storage.js";
import {sharpenImage} from "./transform.js";
type SharpenOperation=Extract<ImageAstNode,{kind:"sharpen"}>;
type Profile=Pick<RgbaImage,"channels"|"hasAlpha"|"isPremultiplied">&{opaque?:boolean};
// Independently recorded from buffered sharpenImage at committed fab85b537c.
const vectors:{profile:Profile;operation:SharpenOperation;hash:string}[]=[
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":-1,"m1":1,"m2":2},"hash":"d0bacfb121e480ea1b446330100b2a5ed542b9848f66affbabbf210ca3ff0eff"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"sharpen","sigma":-1,"m1":1,"m2":2},"hash":"41f389509ba8b4a856365c87b1faf2e6e3fd2499657aed236393868dd72468fb"},
{"profile":{"channels":4,"hasAlpha":true,"opaque":true},"operation":{"kind":"sharpen","sigma":-1,"m1":1,"m2":2},"hash":"4eefbec3c2c9ebc3d492b3a8cc4eafde5ddd150e5d101966f56cc1995cea39ed"},
{"profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":-1,"m1":1,"m2":2},"hash":"69dc46b69cf5b53ece380edf3407c3b8294e84ea6fdeae1836fbc15233d2e8aa"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"sharpen","sigma":-1,"m1":1,"m2":2},"hash":"23dc4a92228f0a69710e6a7f6efa514850081de8fbf674722f3266f4c5282d80"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":0,"m1":1,"m2":2},"hash":"e82900a1f5f6cc926902910941094411334b789e46204c98e37d65473c86eb2c"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"sharpen","sigma":0,"m1":1,"m2":2},"hash":"7bd3173131d9be5d8db3526805d5895cda8952c7889766e41e5b36987d4a6bfc"},
{"profile":{"channels":4,"hasAlpha":true,"opaque":true},"operation":{"kind":"sharpen","sigma":0,"m1":1,"m2":2},"hash":"be7e85c4850c59231acab8419b6982689e2c757c7713351e7d561588109846ab"},
{"profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":0,"m1":1,"m2":2},"hash":"084f422690ac8ed42c3d91ba87a33a9507ad2cd191d11c4ba0054cb6f71a18f9"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"sharpen","sigma":0,"m1":1,"m2":2},"hash":"82a3df0286306e22a5bfb98b594c1d67004fe5651285f65a3badb416fce8605c"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":0.1,"m1":1,"m2":2},"hash":"1779e2a4e2f7f1680200bd2d2ef792d84b7a1b8653ae153694d3d1d2826255b8"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"sharpen","sigma":0.1,"m1":1,"m2":2},"hash":"5169682776f26d235d32ea9f435948d93c86b638f962b4800539c5f65f4cd20c"},
{"profile":{"channels":4,"hasAlpha":true,"opaque":true},"operation":{"kind":"sharpen","sigma":0.1,"m1":1,"m2":2},"hash":"cfa7e57689f8de859f0ed58739cfaf05f75bd8918f83052b077bea8ab19b8366"},
{"profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":0.1,"m1":1,"m2":2},"hash":"e7b55d9580ccd57a35c9a86adc83d7372b2cd47233be8088145910727f19f597"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"sharpen","sigma":0.1,"m1":1,"m2":2},"hash":"b318afeae9639ad4d3dedc1e1296ab93d2ac6efc7bdfca1ced0f525a898dbd0e"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":1.5,"m1":1,"m2":2},"hash":"2fa184a7dd847921ad40d63dbd652037fe81dac2bd87c000bab6efe2a77f4775"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"sharpen","sigma":1.5,"m1":1,"m2":2},"hash":"636145377d624e3f17219d8c9969328384b8aba703c4dbb68dc4c89e8b322437"},
{"profile":{"channels":4,"hasAlpha":true,"opaque":true},"operation":{"kind":"sharpen","sigma":1.5,"m1":1,"m2":2},"hash":"c44dbb6fb6db8dc2b404a9fae9f0963dd3f7f48ee4b70ee000c6fe5eb3dbe68b"},
{"profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":1.5,"m1":1,"m2":2},"hash":"5a291a0a9556d43617cdea0555b3b52c0bb2a8e7e130143f60a8e15f6fece6e3"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"sharpen","sigma":1.5,"m1":1,"m2":2},"hash":"bfe386183f8fa462c05ae6b50344f8681f9cdfcdd8fb5711dc78671ffc514637"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":4.9,"m1":1,"m2":2},"hash":"e22e81db380d987a87566fc5aed916e89f5777577f91d26d3c55c1b46ba7e127"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"sharpen","sigma":4.9,"m1":1,"m2":2},"hash":"e942d65f3e44bee1c364e8f28c1d828d99a3fda49a97ee227306140d433e598a"},
{"profile":{"channels":4,"hasAlpha":true,"opaque":true},"operation":{"kind":"sharpen","sigma":4.9,"m1":1,"m2":2},"hash":"85fc0c14bf6bfd90103d194b9b207e32b95dd7b95b781a11e4391292c4159a71"},
{"profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":4.9,"m1":1,"m2":2},"hash":"936714892c37363c3d3358aa555b92508fd4f46ba87e00ff1e7d08b8632d8aa6"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"sharpen","sigma":4.9,"m1":1,"m2":2},"hash":"c9d44ef81e24e8265d874f1aa720a7b98ab5c6380ac1dfce1ba953060cd5b885"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":2.2,"m1":0.4,"m2":3.7,"x1":1.25,"y2":4.5,"y3":35},"hash":"2e44b6af04542a79a35b31683f9d9ff0b1e6c9d4d766f1ee22620babf4d1d491"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"sharpen","sigma":2.2,"m1":0.4,"m2":3.7,"x1":1.25,"y2":4.5,"y3":35},"hash":"c7a213c7e26ef49b3b8e27f58bed318da5e6d3d453b11dcba66d15a2dc2fd1b7"},
{"profile":{"channels":4,"hasAlpha":true,"opaque":true},"operation":{"kind":"sharpen","sigma":2.2,"m1":0.4,"m2":3.7,"x1":1.25,"y2":4.5,"y3":35},"hash":"3da9a05bdcd6d71a1f78af465a1ef40397f8912ae7fa8110e52a50b4f39b5873"},
{"profile":{"channels":4,"hasAlpha":false},"operation":{"kind":"sharpen","sigma":2.2,"m1":0.4,"m2":3.7,"x1":1.25,"y2":4.5,"y3":35},"hash":"8b069da56e67286bb0f3af03bb6211cde9a71577eacba8aedccface1089e1911"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"sharpen","sigma":2.2,"m1":0.4,"m2":3.7,"x1":1.25,"y2":4.5,"y3":35},"hash":"96a478baf0fb10d144b763d7a08bd9a482b2332dcf6739d0c7c480a552cf26af"}
];
function fixture(profile:Profile={channels:4,hasAlpha:true},width=67,height=19) {
  const data=Uint8Array.from({length:width*height*4},(_,i)=>i%4===3&&(profile.opaque||profile.channels%2)?255:Math.floor(i/4)%11===0?255:(i*43+Math.floor(i/7))%256);
  if(profile.channels<3)for(let i=0;i<data.length;i+=4)data[i+1]=data[i+2]=data[i]!;
  const {opaque:ignoredOpaque,...meta}=profile;
  const image:RgbaImage={width,height,data,format:"png",space:profile.channels<3?"b-w":"srgb",depth:"uchar",density:144,...meta};
  const memory=new Uint8Array(data.length*4+8),borrowed=new Uint8Array(4096);memory.set(data,8);let end=data.length+8;
  const storage={allocate:vi.fn((length:number)=>{const position=end;end+=length;if(end>memory.length)throw new Error("fixture exhausted");return position;}),read:vi.fn(async(position:number,length:number)=>{if(!Number.isSafeInteger(position)||position<8||length>4096||position+length>end)throw new Error("invalid backing read");borrowed.fill(79);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{if(!Number.isSafeInteger(position)||position<8||position+bytes.length>end)throw new Error("invalid backing write");memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  return {image,stored:{...metadata,position:8},storage,memory};
}
it.each(vectors)("preserves committed sigma=$operation.sigma sharpening for $profile",async({profile,operation,hash})=>{
  const {image,stored,storage,memory}=fixture(profile),expected=sharpenImage(image,operation.sigma,operation.m1,operation.m2,operation.x1,operation.y2,operation.y3);
  const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);
  expect({...actual,position:undefined}).toEqual({...expected,data:undefined});
  expect(createHash("sha256").update(expected.data).digest("hex")).toBe(hash);
  expect(createHash("sha256").update(memory.subarray(actual.position,actual.position+image.data.length)).digest("hex")).toBe(hash);
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
const operation:SharpenOperation={kind:"sharpen",sigma:1.5,m1:1,m2:2};
it.each([1,2,3])("honors cancellation during sharpening pass %i",async pass=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={pass};let reads=0,writes=0;
  const read=storage.read.getMockImplementation()!;
  storage.read.mockImplementation(async(position,length)=>{const bytes=await read(position,length);if(storage.allocate.mock.calls.length===pass){reads=storage.read.mock.calls.length;writes=storage.write.mock.calls.length;controller.abort(reason);}return bytes;});
  await expect(transformStoredImage(stored,storage,operation,controller.signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(writes);
});
it.each([1,2,3])("propagates sharpening pass %i write errors without further reads",async pass=>{
  const {stored,storage}=fixture(),reason=new Error("sharpen write failed");const write=storage.write.getMockImplementation()!;let reads=0,writes=0;
  storage.write.mockImplementation(async(position,bytes)=>{if(storage.allocate.mock.calls.length===pass){reads=storage.read.mock.calls.length;writes=storage.write.mock.calls.length;throw reason;}await write(position,bytes);});
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(writes);
});
it.each([2,3])("rejects truncated luminance pages in pass %i",async pass=>{
  const {stored,storage}=fixture();const read=storage.read.getMockImplementation()!;
  storage.read.mockImplementation(async(position,length)=>storage.allocate.mock.calls.length===pass?new Uint8Array(length-1):read(position,length));
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toThrow("Truncated float backing storage");
});
it.each([1,2,3])("rejects invalid pass %i allocation before using it",async pass=>{
  const {stored,storage}=fixture();const allocate=storage.allocate.getMockImplementation()!;
  storage.allocate.mockImplementation(length=>storage.allocate.mock.calls.length===pass?-1:allocate(length));
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toThrow(pass===3?"Invalid image backing allocation":"Invalid float backing allocation");
});
it("keeps luminance, chroma and output buffers bounded across borrowed cache eviction",async()=>{
  const {image,stored,storage,memory}=fixture({channels:4,hasAlpha:true},1031,37),expected=sharpenImage(image,1.5,1,2);
  for(const name of ["Uint8Array","Int16Array","Float32Array","Float64Array"] as const) {
    const Original=globalThis[name];
    vi.stubGlobal(name,new Proxy(Original,{construct(target,args){const length=typeof args[0]==="number"?args[0]:args[0]?.length??0;if(length>4096)throw new Error("unbounded sharpening buffer");return Reflect.construct(target,args);}}));
  }
  try {
    const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);
    expect(Buffer.compare(memory.subarray(actual.position,actual.position+image.data.length),expected.data)).toBe(0);
    expect(storage.read.mock.calls.length).toBeGreaterThan(96);
  } finally {vi.unstubAllGlobals();}
});
it("honors a pre-aborted sharpening request without allocation",async()=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={cancel:true};controller.abort(reason);
  await expect(transformStoredImage(stored,storage,operation,controller.signal)).rejects.toBe(reason);
  expect(storage.allocate).not.toHaveBeenCalled();expect(storage.read).not.toHaveBeenCalled();
});
