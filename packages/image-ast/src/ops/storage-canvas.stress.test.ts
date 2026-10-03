import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import type {ImageAstNode,RgbaImage} from "../ast.js";
import {transformStoredImage} from "./storage.js";
import {extendImage,medianImage,trimImage} from "./transform.js";
type CanvasOperation=Extract<ImageAstNode,{kind:"extend"|"median"|"trim"}>;
type Vector={name:string;pages?:number;alpha?:boolean;gray?:boolean;premultiplied?:boolean;shape?:string;operation:CanvasOperation;expected:Omit<RgbaImage,"data">;hash:string};
// Independently recorded from buffered transform.ts at committed 5fe660000f.
const vectors:Vector[]=[
{"name":"multipage-background","pages":3,"alpha":true,"operation":{"kind":"extend","top":19,"bottom":3,"left":21,"right":5,"background":{"r":31,"g":73,"b":19,"a":128},"extendWith":"background"},"expected":{"width":43,"height":105,"format":"png","space":"srgb","channels":4,"depth":"uchar","density":144,"hasAlpha":true,"isPremultiplied":false,"pages":3,"pageHeight":35},"hash":"be4848817478d13a92474c9c485ebf52186df0535b53fe712a0291c698d127c8"},
{"name":"multipage-copy","pages":3,"alpha":true,"operation":{"kind":"extend","top":19,"bottom":3,"left":21,"right":5,"background":{"r":31,"g":73,"b":19,"a":128},"extendWith":"copy"},"expected":{"width":43,"height":105,"format":"png","space":"srgb","channels":4,"depth":"uchar","density":144,"hasAlpha":true,"isPremultiplied":false,"pages":3,"pageHeight":35},"hash":"cf5ae092a3cb6730d83f68496a8d8b4c4820d61e5e97b3bc1ef53c50934aec7f"},
{"name":"multipage-repeat","pages":3,"alpha":true,"operation":{"kind":"extend","top":19,"bottom":3,"left":21,"right":5,"background":{"r":31,"g":73,"b":19,"a":128},"extendWith":"repeat"},"expected":{"width":43,"height":105,"format":"png","space":"srgb","channels":4,"depth":"uchar","density":144,"hasAlpha":true,"isPremultiplied":false,"pages":3,"pageHeight":35},"hash":"85e3b6ed6763b6cbf88e102a5a1acb678c9e8fe57e3b8066a0b8f39f903352ec"},
{"name":"multipage-mirror","pages":3,"alpha":true,"operation":{"kind":"extend","top":19,"bottom":3,"left":21,"right":5,"background":{"r":31,"g":73,"b":19,"a":128},"extendWith":"mirror"},"expected":{"width":43,"height":105,"format":"png","space":"srgb","channels":4,"depth":"uchar","density":144,"hasAlpha":true,"isPremultiplied":false,"pages":3,"pageHeight":35},"hash":"fc4e4cbd8c977a358053971274358f8c546156bc208d52cc967eb0be39a2f7a3"},
{"name":"gray-background","gray":true,"operation":{"kind":"extend","top":19,"bottom":3,"left":21,"right":5,"background":{"r":31,"g":73,"b":19,"a":128},"extendWith":"background"},"expected":{"width":43,"height":35,"format":"png","space":"b-w","channels":2,"depth":"uchar","density":144,"hasAlpha":true,"isPremultiplied":false},"hash":"4aafbb7c3c53680fcfcb293ef014a9e07455e57f16b67f69c59e1e10c5da9389"},
{"name":"premultiplied-background","premultiplied":true,"alpha":true,"operation":{"kind":"extend","top":19,"bottom":3,"left":21,"right":5,"background":{"r":31,"g":73,"b":19,"a":128},"extendWith":"background"},"expected":{"width":43,"height":35,"format":"png","space":"srgb","channels":4,"depth":"uchar","density":144,"hasAlpha":true,"isPremultiplied":true},"hash":"9dbe2af99277dee55e55cb7a82bbf7070c495f42936b311797dc68ddf2be40f9"},
{"name":"rounded-edges","operation":{"kind":"extend","top":1.5,"bottom":-2,"left":2.49,"right":0,"background":{"r":31,"g":73,"b":19,"a":128},"extendWith":"mirror"},"expected":{"width":19,"height":15,"format":"png","space":"srgb","channels":3,"depth":"uchar","density":144,"hasAlpha":false,"isPremultiplied":false},"hash":"beba1554d610a8150959a63a9d08d7b7db66b336f0edef6c1557b45a362aa3a2"},
{"name":"median-1","alpha":true,"operation":{"kind":"median","size":1},"expected":{"width":17,"height":13,"format":"png","space":"srgb","channels":4,"depth":"uchar","density":144,"hasAlpha":true,"isPremultiplied":false},"hash":"cc60dd869ce03bbad709905de9f7f163e327699873f7bdb50805fb4e306b88db"},
{"name":"median-2","alpha":true,"operation":{"kind":"median","size":2},"expected":{"width":17,"height":13,"format":"png","space":"srgb","channels":4,"depth":"uchar","density":144,"hasAlpha":true,"isPremultiplied":false},"hash":"cc60dd869ce03bbad709905de9f7f163e327699873f7bdb50805fb4e306b88db"},
{"name":"median-7","alpha":true,"operation":{"kind":"median","size":7},"expected":{"width":17,"height":13,"format":"png","space":"srgb","channels":4,"depth":"uchar","density":144,"hasAlpha":true,"isPremultiplied":false},"hash":"8e5a99947920a4acd38f4f7d59507904323e1850f8e1e2b94ef78ad2e8536892"},
{"name":"one-pixel-median","shape":"single","operation":{"kind":"median","size":1},"expected":{"width":1,"height":1,"format":"png","space":"srgb","channels":3,"depth":"uchar","density":144,"hasAlpha":false,"isPremultiplied":false},"hash":"ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e"},
{"name":"trim-filtered","alpha":true,"operation":{"kind":"trim","threshold":10},"expected":{"width":11,"height":7,"format":"png","space":"srgb","channels":4,"depth":"uchar","density":144,"hasAlpha":true,"isPremultiplied":false,"trimOffsetLeft":-3,"trimOffsetTop":-3},"hash":"6fd4b492f29a184cdef0b28e42eca02093be70eabd3aaa1ee425469c596861db"},
{"name":"trim-line-art","operation":{"kind":"trim","threshold":10,"lineArt":true},"expected":{"width":11,"height":7,"format":"png","space":"srgb","channels":3,"depth":"uchar","density":144,"hasAlpha":false,"isPremultiplied":false,"trimOffsetLeft":-3,"trimOffsetTop":-3},"hash":"6fc19295426efcf0eaca8dce19814b47a93aa9449329545953eb08431cb60724"},
{"name":"trim-flat","shape":"flat","operation":{"kind":"trim","threshold":0},"expected":{"width":17,"height":13,"format":"png","space":"srgb","channels":3,"depth":"uchar","density":144,"hasAlpha":false,"isPremultiplied":false,"trimOffsetLeft":0,"trimOffsetTop":0},"hash":"0cda43408c8cfcd557d6e0d43df18ddc43fd94eaa9d6f5648b94178396867382"},
{"name":"trim-transparent","shape":"transparent","alpha":true,"operation":{"kind":"trim","threshold":0,"lineArt":true},"expected":{"width":17,"height":13,"format":"png","space":"srgb","channels":4,"depth":"uchar","density":144,"hasAlpha":true,"isPremultiplied":false,"trimOffsetLeft":0,"trimOffsetTop":0},"hash":"3ded7cea001f6eed8a7f2246ee8863ddb260969fa94509dd365c33476a4dbadb"},
{"name":"trim-equal-threshold","shape":"threshold","operation":{"kind":"trim","threshold":10,"lineArt":true},"expected":{"width":17,"height":13,"format":"png","space":"srgb","channels":3,"depth":"uchar","density":144,"hasAlpha":false,"isPremultiplied":false,"trimOffsetLeft":0,"trimOffsetTop":0},"hash":"5fcaf9126c93c1728b039f8c02b902a3740317948fbf87a38419722210cd7d96"},
{"name":"trim-below-threshold","shape":"threshold","operation":{"kind":"trim","threshold":9,"lineArt":true},"expected":{"width":11,"height":7,"format":"png","space":"srgb","channels":3,"depth":"uchar","density":144,"hasAlpha":false,"isPremultiplied":false,"trimOffsetLeft":-3,"trimOffsetTop":-3},"hash":"844530022fd37c2a4a2ea0e776902d406716f606ff256771c08d8560bc6263d9"},
{"name":"trim-explicit-background","operation":{"kind":"trim","threshold":10,"lineArt":true,"background":{"r":255,"g":255,"b":255,"a":255}},"expected":{"width":11,"height":7,"format":"png","space":"srgb","channels":3,"depth":"uchar","density":144,"hasAlpha":false,"isPremultiplied":false,"trimOffsetLeft":-3,"trimOffsetTop":-3},"hash":"6fc19295426efcf0eaca8dce19814b47a93aa9449329545953eb08431cb60724"}
];
function fixture(c:Partial<Vector>={}) {
  const width=c.shape==="single"?1:c.shape==="wide"?1031:17,pageHeight=c.shape==="single"?1:13,height=pageHeight*(c.pages??1);
  const data=Uint8Array.from({length:width*height*4},(_,i)=>{
    const p=Math.floor(i/4),x=p%width,y=Math.floor(p/width)%pageHeight,border=x<3||x>13||y<3||y>9;
    if(i%4===3)return c.shape==="transparent"?0:!c.alpha||border?255:(i*43+Math.floor(i/7))%256;
    if(c.shape==="flat")return 255;if(c.shape==="threshold")return border?100:110;
    return border?255:(i*43+Math.floor(i/7))%256;
  });
  if(c.gray)for(let i=0;i<data.length;i+=4)data[i+1]=data[i+2]=data[i]!;
  const image:RgbaImage={width,height,data,format:"png",space:c.gray?"b-w":"srgb",channels:c.gray?(c.alpha?2:1):(c.alpha?4:3),depth:"uchar",density:144,hasAlpha:!!c.alpha,isPremultiplied:!!c.premultiplied,...(c.pages?{pages:c.pages,pageHeight}:{})};
  const memory=new Uint8Array(2_000_000),borrowed=new Uint8Array(4096);memory.set(data,8);let end=data.length+8;
  const storage={allocate:vi.fn((length:number)=>{const position=end;end+=length;if(end>memory.length)throw new Error("fixture exhausted");return position;}),read:vi.fn(async(position:number,length:number)=>{if(!Number.isSafeInteger(position)||position<8||length>4096||position+length>end)throw new Error("invalid backing read");borrowed.fill(33);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{if(!Number.isSafeInteger(position)||position<8||position+bytes.length>end)throw new Error("invalid backing write");memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  return {image,stored:{...metadata,position:8},storage,memory};
}
it.each(vectors)("preserves committed $name pixels and metadata",async vector=>{
  const {image,stored,storage,memory}=fixture(vector),op=vector.operation;
  const expected=op.kind==="extend"?extendImage(image,op):op.kind==="median"?medianImage(image,op.size):trimImage(image,op);
  const actual=await transformStoredImage(stored,storage,op,new AbortController().signal);
  expect({...expected,data:undefined}).toEqual(vector.expected);
  expect({...actual,position:undefined}).toEqual(vector.expected);
  expect(createHash("sha256").update(expected.data).digest("hex")).toBe(vector.hash);
  expect(createHash("sha256").update(memory.subarray(actual.position,actual.position+actual.width*actual.height*4)).digest("hex")).toBe(vector.hash);
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
it("rejects multi-page trim before allocating or reading",async()=>{
  const {stored,storage}=fixture({pages:3});
  await expect(transformStoredImage(stored,storage,{kind:"trim",threshold:10},new AbortController().signal)).rejects.toThrow("multi-page");
  expect(storage.allocate).not.toHaveBeenCalled();expect(storage.read).not.toHaveBeenCalled();
});
it.each([NaN,Infinity,Number.MAX_SAFE_INTEGER])("rejects unrepresentable extension %s",async top=>{
  const {stored,storage}=fixture();
  await expect(transformStoredImage(stored,storage,{kind:"extend",top,bottom:1,left:1,right:1,extendWith:"background",background:{r:0,g:0,b:0,a:255}},new AbortController().signal)).rejects.toThrow("Invalid extended image dimensions");
  expect(storage.allocate).not.toHaveBeenCalled();expect(storage.read).not.toHaveBeenCalled();
});
it.each([{kind:"median",size:3},{kind:"trim",threshold:10,lineArt:true}] as CanvasOperation[])("preserves cancellation during $kind reads",async operation=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={cancel:operation.kind};
  const read=storage.read.getMockImplementation()!;
  storage.read.mockImplementationOnce(async(position,length)=>{const bytes=await read(position,length);controller.abort(reason);return bytes;});
  await expect(transformStoredImage(stored,storage,operation,controller.signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(1);expect(storage.write).not.toHaveBeenCalled();
});
it("propagates extension output failure before reading the source",async()=>{
  const {stored,storage}=fixture({shape:"single"}),reason=new Error("output failed");storage.write.mockRejectedValueOnce(reason);
  await expect(transformStoredImage(stored,storage,{kind:"extend",top:4096,bottom:0,left:0,right:0,background:{r:1,g:2,b:3,a:255},extendWith:"background"},new AbortController().signal)).rejects.toBe(reason);
  expect(storage.read).not.toHaveBeenCalled();expect(storage.write).toHaveBeenCalledTimes(1);
});
it("yields to timer cancellation while emitting only extension background",async()=>{
  const {stored,storage}=fixture({shape:"single"}),controller=new AbortController(),reason={cancel:"background"};
  const timer=setTimeout(()=>controller.abort(reason),0);
  try {
    await expect(transformStoredImage(stored,storage,{kind:"extend",top:32768,bottom:0,left:0,right:0,background:{r:1,g:2,b:3,a:255},extendWith:"background"},controller.signal)).rejects.toBe(reason);
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.write.mock.calls.length).toBeLessThan(32);
  } finally {clearTimeout(timer);}
});
it("keeps extension output and borrowed pixel pages bounded",async()=>{
  const {stored,storage}=fixture(),Original=Uint8Array;
  vi.stubGlobal("Uint8Array",new Proxy(Original,{construct(target,args){const length=typeof args[0]==="number"?args[0]:args[0]?.byteLength??0;if(length>4096)throw new Error("unbounded canvas bytes");return Reflect.construct(target,args);}}));
  try {await transformStoredImage(stored,storage,{kind:"extend",top:31,bottom:33,left:71,right:89,background:{r:1,g:2,b:3,a:128},extendWith:"mirror"},new AbortController().signal);}
  finally {vi.unstubAllGlobals();}
});

it("retains borrowed source pages across wide mirrored rows",async()=>{
  const {image,stored,storage,memory}=fixture({shape:"wide",alpha:true});
  const operation:CanvasOperation={kind:"extend",top:2,bottom:1,left:3,right:7,background:{r:1,g:2,b:3,a:255},extendWith:"mirror"};
  const expected=extendImage(image,operation),actual=await transformStoredImage(stored,storage,operation,new AbortController().signal);
  expect(storage.read.mock.calls.length).toBeGreaterThan(1);
  expect(Buffer.compare(memory.subarray(actual.position,actual.position+actual.width*actual.height*4),expected.data)).toBe(0);
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
});
