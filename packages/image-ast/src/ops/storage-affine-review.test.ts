import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import type {ImageAstNode,RgbaImage} from "../ast.js";
import {transformStoredImage} from "./storage.js";
import {affineImage,rotateImage} from "./transform.js";
type Operation=Extract<ImageAstNode,{kind:"affine"|"rotate"}>;
type Profile=Pick<RgbaImage,"channels"|"hasAlpha"|"isPremultiplied">;
// Independent outputs from committed d61c3bac7d, before affine sampler extraction.
const vectors:{profile:Profile;operation:Operation;expected:Omit<RgbaImage,"data">;hash:string}[]=[
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"nearest","background":{"r":27.25,"g":83.75,"b":151.5,"a":0}},"expected":{"width":24,"height":16,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":2,"hasAlpha":true},"hash":"ba098c882d75ed3be06623b5e3d3d48d11cef50360c785c21be1c55fce453210"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"nearest","background":{"r":27.25,"g":83.75,"b":151.5,"a":255}},"expected":{"width":24,"height":16,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":2,"hasAlpha":true},"hash":"f60909b9bac59a52e7ba1c984a10d2b65f17f62f728584e6d25933ed3c4af51b"},
{"profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"nearest","background":{"r":27.25,"g":83.75,"b":151.5,"a":73.5}},"expected":{"width":24,"height":16,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":4,"hasAlpha":true},"hash":"4fcb8bda7c9c727c367f33f9e4bb47b3d3fdd03e7c254b08dcc66e968faec930"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"bilinear","background":{"r":27.25,"g":83.75,"b":151.5,"a":0}},"expected":{"width":24,"height":16,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":4,"hasAlpha":true,"isPremultiplied":true},"hash":"304ede0293052782bff1637d0ba893719ce6dd4313edb5735cda88aa38dd407d"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"bilinear","background":{"r":27.25,"g":83.75,"b":151.5,"a":255}},"expected":{"width":24,"height":16,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":1,"hasAlpha":false},"hash":"dfdf8b8b7ed5bd19300de8580e15eec3f066df618ac367b99ce7cfe750ccbc8a"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"bilinear","background":{"r":27.25,"g":83.75,"b":151.5,"a":73.5}},"expected":{"width":24,"height":16,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":2,"hasAlpha":true},"hash":"ea3775c7c7890b0b0c8e53eabe082ba29d0b5fdc446ba90f9f91c6f3d3eca713"},
{"profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"bicubic","background":{"r":27.25,"g":83.75,"b":151.5,"a":0}},"expected":{"width":24,"height":16,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":4,"hasAlpha":true},"hash":"be34dfee2becc1201280016d7894f6d4530fd50983b0b910bf2dee21ab9ba1bd"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"bicubic","background":{"r":27.25,"g":83.75,"b":151.5,"a":255}},"expected":{"width":24,"height":16,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":4,"hasAlpha":true,"isPremultiplied":true},"hash":"7a3695e8e1ebe6f5963633ad4a9e2202ae2035e0ca891970c488adb0c2c6cd45"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"bicubic","background":{"r":27.25,"g":83.75,"b":151.5,"a":73.5}},"expected":{"width":24,"height":16,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":2,"hasAlpha":true},"hash":"fce7e4076e876cab155137151b3c6641401d1d06891a211ed2e4d9f36151b86c"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"nohalo","background":{"r":27.25,"g":83.75,"b":151.5,"a":0}},"expected":{"width":24,"height":16,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":2,"hasAlpha":true},"hash":"30cf0705087bb3548787cd5c8b99bcc61ed9f66afa1668ee6e68066bd74c824f"},
{"profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"nohalo","background":{"r":27.25,"g":83.75,"b":151.5,"a":255}},"expected":{"width":24,"height":16,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":3,"hasAlpha":false},"hash":"2d6c9095a465c70715ee761030aa31d55582ba59ee8730fbcaea034a88e9474c"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"affine","matrix":[1.2,0.3,-0.4,0.8],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"nohalo","background":{"r":27.25,"g":83.75,"b":151.5,"a":73.5}},"expected":{"width":24,"height":16,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":4,"hasAlpha":true,"isPremultiplied":true},"hash":"0f5e9f5819f97dcb9c0ea03af304bac62f7abc0fa84837308dced8111e79e2f1"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"affine","matrix":[-1,0.25,0.15,1],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"interpolator":"bicubic","background":{"r":21,"g":33,"b":77,"a":128}},"expected":{"width":20,"height":14,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":2,"hasAlpha":true},"hash":"2e8a889bec1d26ecbb6c32a3a38f084c4dd83bf4e4d674a22bc26ccc98acf933"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"affine","matrix":[1,2,2,4],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"background":{"r":1,"g":2,"b":3,"a":0}},"expected":{"width":17,"height":11,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":2,"hasAlpha":true},"hash":"4a37610a9162e535567b440b4166b70af616cc9a32093796a3e6e616bcf3d2d3"},
{"profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"affine","matrix":[1,1,1,1.0000000001],"idx":0.4,"idy":-0.2,"odx":1.2,"ody":-0.7,"background":{"r":1,"g":2,"b":3,"a":128}},"expected":{"width":17,"height":11,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":3,"hasAlpha":false},"hash":"3ca01c5071ac94efb06871a5fd0db951217bc8e74685c7788a1adad417fb10f0"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"rotate","angle":-23,"background":{"r":21.5,"g":44.25,"b":98.75,"a":71.5}},"expected":{"width":20,"height":17,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":4,"hasAlpha":true,"isPremultiplied":true},"hash":"7b82c59060342131861911314005d124c5764d8fcaf651fd8305d03a10ccf0fa"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"rotate","angle":-1e-7,"background":{"r":21.5,"g":44.25,"b":98.75,"a":71.5}},"expected":{"width":17,"height":11,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":2,"hasAlpha":true},"hash":"89123d51c799aee0180abe85c766d9a1ef1a8fa090491f4de13a3bff5a01ac3d"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"rotate","angle":1e-7,"background":{"r":21.5,"g":44.25,"b":98.75,"a":71.5}},"expected":{"width":17,"height":11,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":2,"hasAlpha":true},"hash":"4a37610a9162e535567b440b4166b70af616cc9a32093796a3e6e616bcf3d2d3"},
{"profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"rotate","angle":89.9999999,"background":{"r":21.5,"g":44.25,"b":98.75,"a":71.5}},"expected":{"width":11,"height":17,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":3,"hasAlpha":false},"hash":"e8f72613fbae3a81e3517bf481505ad862fd5d006868d09d96d0fcf9ba75a991"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"rotate","angle":90.0000011,"background":{"r":21.5,"g":44.25,"b":98.75,"a":71.5}},"expected":{"width":11,"height":17,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":4,"hasAlpha":true,"isPremultiplied":true},"hash":"4e3ba4f3ca133afb896dcadc41cf33e8782709ef42511946321f62c411b2134f"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"rotate","angle":179.9999999,"background":{"r":21.5,"g":44.25,"b":98.75,"a":71.5}},"expected":{"width":17,"height":11,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":1,"hasAlpha":false},"hash":"7ff09f2d7e71955e8e6c542b59a312ec272c3aae8a96c6085c7eb3f1f67510aa"},
{"profile":{"channels":2,"hasAlpha":true},"operation":{"kind":"rotate","angle":269.9999999,"background":{"r":21.5,"g":44.25,"b":98.75,"a":71.5}},"expected":{"width":11,"height":17,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":2,"hasAlpha":true},"hash":"47c7d431b9d25f47f68e9f9d56bc9b67f943c86a9cee5134acacb8ea580329e1"},
{"profile":{"channels":3,"hasAlpha":false},"operation":{"kind":"rotate","angle":359.9999999,"background":{"r":21.5,"g":44.25,"b":98.75,"a":71.5}},"expected":{"width":17,"height":11,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":4,"hasAlpha":true},"hash":"3ca01c5071ac94efb06871a5fd0db951217bc8e74685c7788a1adad417fb10f0"},
{"profile":{"channels":4,"hasAlpha":true,"isPremultiplied":true},"operation":{"kind":"rotate","angle":360,"background":{"r":21.5,"g":44.25,"b":98.75,"a":71.5}},"expected":{"width":17,"height":11,"format":"png","space":"srgb","depth":"uchar","density":144,"channels":4,"hasAlpha":true,"isPremultiplied":true},"hash":"2dcd82a3bfa379f2d66a87acb7085b64631053de7166df3dc8362326c93fad55"},
{"profile":{"channels":1,"hasAlpha":false},"operation":{"kind":"rotate","angle":450,"background":{"r":21.5,"g":44.25,"b":98.75,"a":71.5}},"expected":{"width":11,"height":17,"format":"png","space":"b-w","depth":"uchar","density":144,"channels":1,"hasAlpha":false},"hash":"a0544466914d1cee0f5dcfcd42ff56f3b0ac47dafddd5dfe1c392f5960105a1d"}
];
function fixture(profile:Profile={channels:4,hasAlpha:true},width=17,height=11) {
  const data=Uint8Array.from({length:width*height*4},(_,i)=>i%4===3&&profile.channels%2?255:(i*43+Math.floor(i/7))%256);
  if(profile.channels<3)for(let i=0;i<data.length;i+=4)data[i+1]=data[i+2]=data[i]!;
  const image:RgbaImage={width,height,data,format:"png",space:profile.channels<3?"b-w":"srgb",depth:"uchar",density:144,...profile};
  const memory=new Uint8Array(Math.max(1_000_000,data.length*5+8)),borrowed=new Uint8Array(4096);memory.set(data,8);let end=data.length+8;
  const storage={allocate:vi.fn((length:number)=>{const position=end;end+=length;if(end>memory.length)throw new Error("fixture exhausted");return position;}),read:vi.fn(async(position:number,length:number)=>{if(!Number.isSafeInteger(position)||position<8||length>4096||position+length>end)throw new Error("invalid backing read");borrowed.fill(97);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{if(!Number.isSafeInteger(position)||position<8||position+bytes.length>end)throw new Error("invalid backing write");memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  return {image,stored:{...metadata,position:8},storage,memory};
}
it.each(vectors.map((vector,index)=>({...vector,index})))("preserves pre-refactor affine/rotation case $index",async({profile,operation,expected,hash})=>{
  const {image,stored,storage,memory}=fixture(profile),buffered=operation.kind==="affine"?affineImage(image,operation):rotateImage(image,operation.angle,operation.background);
  const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);
  expect({...actual,position:undefined}).toEqual(expected);expect({...buffered,data:undefined}).toEqual(expected);
  expect(createHash("sha256").update(buffered.data).digest("hex")).toBe(hash);
  expect(createHash("sha256").update(memory.subarray(actual.position,actual.position+actual.width*actual.height*4)).digest("hex")).toBe(hash);
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
const operation:Extract<Operation,{kind:"affine"}>={kind:"affine",matrix:[1,0.15,-0.02,1],idx:0.3,idy:-0.1,interpolator:"bicubic",background:{r:37.5,g:111.25,b:209.75,a:83.5}};
it.each([0,180,179.9999999,360])("preserves allowed multi-page rotation %s",async angle=>{
  const {image,stored,storage,memory}=fixture(undefined,17,12),metadata={pages:3,pageHeight:4};
  const expected=rotateImage({...image,...metadata},angle),actual=await transformStoredImage({...stored,...metadata},storage,{kind:"rotate",angle,background:{r:0,g:0,b:0,a:255}},new AbortController().signal);
  expect({...actual,position:undefined}).toEqual({...expected,data:undefined});expect(Buffer.compare(memory.subarray(actual.position,actual.position+image.data.length),expected.data)).toBe(0);
});
it.each([23,90,269.9999999,359.9999999])("rejects forbidden multi-page rotation %s before I/O",async angle=>{
  const {stored,storage}=fixture(undefined,17,12);
  await expect(transformStoredImage({...stored,pages:3,pageHeight:4},storage,{kind:"rotate",angle,background:{r:0,g:0,b:0,a:255}},new AbortController().signal)).rejects.toThrow("multi-page");
  expect(storage.allocate).not.toHaveBeenCalled();expect(storage.read).not.toHaveBeenCalled();
});
it.each(["before","read","write"])("preserves cancellation at %s",async phase=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={phase};let reads=0;
  if(phase==="before")controller.abort(reason);
  if(phase==="read"){const read=storage.read.getMockImplementation()!;storage.read.mockImplementationOnce(async(position,length)=>{const bytes=await read(position,length);reads=storage.read.mock.calls.length;controller.abort(reason);return bytes;});}
  if(phase==="write")storage.write.mockImplementationOnce(async()=>{reads=storage.read.mock.calls.length;controller.abort(reason);});
  await expect(transformStoredImage(stored,storage,operation,controller.signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(reads);expect(storage.write).toHaveBeenCalledTimes(phase==="write"?1:0);
});
it("propagates storage failure after interpolation without further reads",async()=>{
  const {stored,storage}=fixture(),reason=new Error("affine write failed");let reads=0;
  storage.write.mockImplementationOnce(async()=>{reads=storage.read.mock.calls.length;throw reason;});
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toBe(reason);expect(storage.read).toHaveBeenCalledTimes(reads);
});
it("rejects invalid output allocation before sampling",async()=>{
  const {stored,storage}=fixture();storage.allocate.mockReturnValueOnce(-1);
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toThrow("Invalid image backing allocation");expect(storage.read).not.toHaveBeenCalled();
});
it("rejects truncated borrowed pages before output",async()=>{
  const {stored,storage}=fixture();storage.read.mockResolvedValueOnce(new Uint8Array(3));
  await expect(transformStoredImage(stored,storage,operation,new AbortController().signal)).rejects.toThrow("Truncated image backing storage");expect(storage.write).not.toHaveBeenCalled();
});
it("keeps bicubic sampling bounded across wide borrowed cache pages",async()=>{
  const {image,stored,storage,memory}=fixture({channels:2,hasAlpha:true},1031,37),expected=affineImage(image,operation);
  for(const name of ["Uint8Array","Float64Array"] as const){const Original=globalThis[name];vi.stubGlobal(name,new Proxy(Original,{construct(target,args){const length=typeof args[0]==="number"?args[0]:args[0]?.length??0;if(length>4096)throw new Error("unbounded affine bytes");return Reflect.construct(target,args);}}));}
  try {const actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);expect(Buffer.compare(memory.subarray(actual.position,actual.position+expected.data.length),expected.data)).toBe(0);expect(storage.read.mock.calls.length).toBeGreaterThan(32);}
  finally{vi.unstubAllGlobals();}
});
it("yields to timer cancellation while producing only affine background",async()=>{
  const {stored,storage}=fixture(undefined,257,129),controller=new AbortController(),reason={cancel:"background"},timer=setTimeout(()=>controller.abort(reason),0);
  try {await expect(transformStoredImage(stored,storage,{...operation,matrix:[1,0,0,1],odx:1e6,ody:1e6},controller.signal)).rejects.toBe(reason);expect(storage.read).not.toHaveBeenCalled();}
  finally{clearTimeout(timer);}
});
