import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import type {ResizeKernel,RgbaImage} from "../ast.js";
import {resampleRawBitmap} from "./resize.js";
import {resampleStoredImage,type StoredResampleOptions} from "./storage-resample.js";

type Vector=StoredResampleOptions&{sw:number;sh:number;alpha?:boolean;premultiplied?:boolean;hash:string};
// Independently recorded from resampleRawBitmap at 2a867936bd, before coordinate extraction.
const vectors:Vector[]=[
{sw:53,sh:47,width:11,height:89,kernel:"nearest",hash:"81da504da7b41357d5890ef1b430a57a6eff2bb8cdf2aebc3580842bef5f7657"},
{sw:53,sh:47,width:97,height:7,kernel:"nearest",alpha:true,hash:"e5f19a6689c698f8fda62a4e223cf44a285e1db68454b1d80a6605fe3264ede6"},
{sw:71,sh:67,width:3,height:2,kernel:"nearest",hash:"7918b4c54b38476c0c8f33a479adc87fd81cedf92781992d663b09c38611e982"},
{sw:13,sh:17,width:39,height:34,kernel:"nearest",hash:"f8dc45f550bd4b3a8a2e5ffa08910258f6b70b865bd39e5de908bf935617c686"},
{sw:31,sh:23,width:41,height:37,kernel:"nearest",hscale:1.33,vscale:1.61,hash:"364d83985dd77831efb22b75c5b6c5d0989eb379cd6792c35ed77fa1b148896b"},
{sw:31,sh:23,width:5,height:39,kernel:"nearest",hscale:0.161,vscale:1.7,hash:"ba03fc2f2fea2dcb7f1a4d700814578f1b8b3e9d1e4a208ffdc403ee3a750a20"},
{sw:1031,sh:41,width:67,height:3,kernel:"lanczos3",hash:"4a980bdaf2b620e53a70eb5f6e40ac0e8f85e57be07267f03fd12c4d6fed4600"},
{sw:4099,sh:9,width:7,height:3,kernel:"cubic",alpha:true,hash:"5e7f6bc9ffc6742824cde83c126722daba8f6f572b63d3433b4826d661a8af06"},
{sw:7,sh:4099,width:3,height:7,kernel:"linear",hash:"344ef94c88a8f1a97e5d4c9426565cf5f8580f6c50a42da13784a670dd8fcc86"},
{sw:37,sh:29,width:11,height:7,kernel:"mitchell",hscale:0.3,vscale:0.24,hash:"6e3b14edf3c692cabd1fabc221ef395ff9b81a670ed03470f2076979a922d8f9"},
{sw:19,sh:13,width:31,height:23,kernel:"bilinear",hscale:1.62,vscale:1.77,alpha:true,hash:"6092826fdbd0c37253cf2191aa3c49087c07c6871efb3e3a40c7ed37ab13c242"},
{sw:61,sh:43,width:13,height:9,kernel:"lanczos2",alpha:true,premultiplied:true,hash:"95b6e0a44149e4893745f7043c9c097b7bb885fe611dc25692f73a9c8b06a366"}
];
function fixture(sw=71,sh=43,alpha=false,premultiplied=false) {
  const data=Uint8Array.from({length:sw*sh*4},(_,i)=>i%4===3&&!alpha?255:(i*43+Math.floor(i/257)*17)%256);
  const image:RgbaImage={width:sw,height:sh,data,format:"png",space:"srgb",channels:4,hasAlpha:alpha,depth:"uchar",density:144,isPremultiplied:premultiplied};
  const memory=new Uint8Array(Math.max(1_000_000,data.length*10)),borrowed=new Uint8Array(4096);memory.set(data,8);let end=data.length+8;
  const storage={allocate:vi.fn((length:number)=>{const position=end;end+=length;if(end>memory.length)throw new Error("fixture exhausted");return position;}),read:vi.fn(async(position:number,length:number)=>{if(!Number.isSafeInteger(position)||position<8||!Number.isSafeInteger(length)||length<0||length>4096||position+length>end)throw new Error("invalid storage read");borrowed.fill(117);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{if(position<8||position+bytes.length>end)throw new Error("invalid storage write");memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  return {image,stored:{...metadata,position:8},storage,memory};
}
it.each(vectors)("matches committed $kernel output for $sw x $sh to $width x $height",async vector=>{
  const {image,stored,storage,memory}=fixture(vector.sw,vector.sh,vector.alpha,vector.premultiplied);
  const expected=resampleRawBitmap(image.data,vector.sw,vector.sh,vector.width,vector.height,vector.kernel,vector.hscale,vector.vscale,vector.premultiplied);
  const actual=await resampleStoredImage(stored,storage,vector,new AbortController().signal);
  expect(createHash("sha256").update(expected).digest("hex")).toBe(vector.hash);
  expect(createHash("sha256").update(memory.subarray(actual.position,actual.position+actual.width*actual.height*4)).digest("hex")).toBe(vector.hash);
  expect(actual).toEqual({...stored,position:actual.position,width:vector.width,height:vector.height});
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});
it.each(["nearest","linear","lanczos3"] as ResizeKernel[])("stops %s resampling when a retained read cancels",async kernel=>{
  const {stored,storage}=fixture(71,43,false,true),controller=new AbortController(),reason={kernel};
  const read=storage.read.getMockImplementation()!;
  storage.read.mockImplementationOnce(async(position,length)=>{const bytes=await read(position,length);controller.abort(reason);return bytes;});
  await expect(resampleStoredImage(stored,storage,{width:31,height:19,kernel},controller.signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(1);expect(storage.write).not.toHaveBeenCalled();
});
it.each(["cancel","error"])("stops after output write %s",async mode=>{
  const {stored,storage}=fixture(71,43,true),controller=new AbortController(),reason=new Error(mode);let readsAtFailure=0;
  storage.write.mockImplementationOnce(async()=>{readsAtFailure=storage.read.mock.calls.length;if(mode==="cancel")controller.abort(reason);else throw reason;});
  await expect(resampleStoredImage(stored,storage,{width:31,height:19,kernel:"lanczos3"},controller.signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(readsAtFailure);expect(storage.write).toHaveBeenCalledTimes(1);
});
it("rejects pre-aborted work without storage access",async()=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={cancel:true};controller.abort(reason);
  await expect(resampleStoredImage(stored,storage,{width:3,height:2},controller.signal)).rejects.toBe(reason);
  expect(storage.allocate).not.toHaveBeenCalled();expect(storage.read).not.toHaveBeenCalled();
});
it("rejects short borrowed cache pages before writing",async()=>{
  const {stored,storage}=fixture(71,43,false,true);storage.read.mockResolvedValueOnce(new Uint8Array(4095));
  await expect(resampleStoredImage(stored,storage,{width:3,height:2,kernel:"nearest"},new AbortController().signal)).rejects.toThrow("Truncated image backing storage");
  expect(storage.write).not.toHaveBeenCalled();
});
it.each([{width:0,height:2},{width:1.5,height:2},{width:2,height:NaN},{width:2,height:2,hscale:0},{width:2,height:2,vscale:Infinity}])("rejects invalid dimensions or scale %j before I/O",async options=>{
  const {stored,storage}=fixture();
  await expect(resampleStoredImage(stored,storage,options,new AbortController().signal)).rejects.toThrow("Invalid stored resample");
  expect(storage.allocate).not.toHaveBeenCalled();expect(storage.read).not.toHaveBeenCalled();
});
it.each(["nearest","lanczos3"] as ResizeKernel[])("rejects an explicit %s scale which rounds to no source samples",async kernel=>{
  const {stored,storage}=fixture(71,43,false,true);
  await expect(resampleStoredImage(stored,storage,{width:2,height:2,hscale:1e-10,vscale:1e-10,kernel},new AbortController().signal)).rejects.toThrow(RangeError);
  expect(storage.allocate).not.toHaveBeenCalled();expect(storage.read).not.toHaveBeenCalled();
});

it("keeps owned byte buffers bounded during large reductions",async()=>{
  const {stored,storage}=fixture(1031,41,true);
  const Original=Uint8Array;
  vi.stubGlobal("Uint8Array",new Proxy(Original,{construct(target,args){
    const length=typeof args[0]==="number"?args[0]:args[0]?.byteLength??0;
    if(length>4096)throw new Error("unbounded resampler bytes");
    return Reflect.construct(target,args);
  }}));
  try {await resampleStoredImage(stored,storage,{width:67,height:3,kernel:"lanczos3"},new AbortController().signal);}
  finally {vi.unstubAllGlobals();}
});
