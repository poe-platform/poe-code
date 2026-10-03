import {expect,it,vi} from "vitest";
import type {ResizeKernel,RgbaImage} from "../ast.js";
import {resampleRawBitmap} from "./resize.js";
import {resampleStoredImage} from "./storage-resample.js";

const kernels:ResizeKernel[]=["nearest","linear","bilinear","cubic","mitchell","lanczos2","lanczos3"];
const cases=kernels.flatMap(kernel=>[[7,5],[40,30],[5,30],[40,5],[1,1],[19,13]].flatMap(([width,height])=>[false,true].map(alpha=>({kernel,width:width!,height:height!,alpha}))));
it.each(cases)("resamples $kernel to $width x $height with alpha=$alpha in caller storage",async({kernel,width,height,alpha})=>{
  const sourceWidth=19,sourceHeight=13;
  const data=Uint8Array.from({length:sourceWidth*sourceHeight*4},(_,i)=>i%4===3&&!alpha?255:(i*43+Math.floor(i/7))%256);
  const image:RgbaImage={width:sourceWidth,height:sourceHeight,data,format:"png",space:"srgb",channels:4,depth:"uchar",density:72,hasAlpha:alpha};
  const expected=resampleRawBitmap(data,sourceWidth,sourceHeight,width,height,kernel);
  let end=data.length+8;
  const memory=new Uint8Array(200_000);memory.set(data,8);
  const storage={allocate(length:number){const result=end;end+=length;return result;},read:vi.fn(async(position:number,length:number)=>memory.subarray(position,position+length)),write:vi.fn(async(position:number,bytes:Uint8Array)=>{memory.set(bytes,position);})};
  const {data:ignoredData,...metadata}=image;
  const actual=await resampleStoredImage({...metadata,position:8},storage,{width,height,kernel},new AbortController().signal);
  expect(actual).toMatchObject({width,height});
  expect(Buffer.compare(memory.subarray(actual.position,actual.position+width*height*4),expected)).toBe(0);
  expect(storage.read.mock.calls.every(([,length])=>length<=4096)).toBe(true);
  expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
});

it.each([0,Number.MIN_VALUE,Infinity,NaN,0.01,2])("rejects inconsistent explicit scales %s before storage I/O",async hscale=>{
  const storage={allocate:vi.fn(),read:vi.fn(),write:vi.fn()};
  await expect(resampleStoredImage({width:10,height:10,position:0,format:"png",space:"srgb",channels:4,depth:"uchar",density:72,hasAlpha:false},storage,{width:5,height:5,hscale},new AbortController().signal)).rejects.toThrow(RangeError);
  expect(storage.read).not.toHaveBeenCalled();
  expect(storage.allocate).not.toHaveBeenCalled();
});
