import {expect,it,vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import type {RgbaImage} from "../ast.js";
import sharp from "../index.js";
import type {StoredPixelOperation} from "./storage-pixels.js";
import {transformStoredImage} from "./storage.js";
import * as pixels from "./transform.js";

type Case={node:StoredPixelOperation;oracle:(image:RgbaImage)=>RgbaImage};
const color={r:39,g:151,b:227,a:128};
const matrix=[[0.9,0.1,0.2],[0.2,0.8,0.1],[0.1,0.3,0.7]];
const cases:Case[]=[
  {node:{kind:"grayscale"},oracle:pixels.grayscaleImage},
  {node:{kind:"flatten",background:color},oracle:image=>pixels.flattenImage(image,color)},
  {node:{kind:"unflatten"},oracle:pixels.unflattenImage},
  ...[true,false].map(alpha=>({node:{kind:"negate" as const,alpha},oracle:(image:RgbaImage)=>pixels.negateImage(image,{alpha})})),
  {node:{kind:"modulate",brightness:1.3,saturation:0.7,hue:31,lightness:4},oracle:image=>pixels.modulateImage(image,{brightness:1.3,saturation:0.7,hue:31,lightness:4})},
  {node:{kind:"tint",color},oracle:image=>pixels.tintImage(image,color)},
  {node:{kind:"gamma",gamma:1.8,gammaOut:2.4},oracle:image=>pixels.gammaImage(image,1.8,2.4)},
  {node:{kind:"linear",a:[1.1,0.7,1.3,0.8],b:[4,7,-8,20]},oracle:image=>pixels.linearImage(image,[1.1,0.7,1.3,0.8],[4,7,-8,20])},
  ...[true,false].map(grayscale=>({node:{kind:"threshold" as const,value:140,grayscale},oracle:(image:RgbaImage)=>pixels.thresholdImage(image,140,grayscale)})),
  {node:{kind:"ensureAlpha",alpha:0.4},oracle:image=>pixels.ensureAlphaImage(image,0.4)},
  {node:{kind:"removeAlpha"},oracle:pixels.removeAlphaImage},
  ...([0,1,2] as const).map(channel=>({node:{kind:"extractChannel" as const,channel},oracle:(image:RgbaImage)=>pixels.extractChannelImage(image,channel)})),
  {node:{kind:"recomb",matrix},oracle:image=>pixels.recombImage(image,matrix)},
  ...(["srgb","b-w","rgb16","grey16"] as const).map(space=>({node:{kind:"toColorspace" as const,space},oracle:(image:RgbaImage)=>pixels.toColorspaceImage(image,space)})),
  ...(["and","or","eor"] as const).map(op=>({node:{kind:"bandbool" as const,op},oracle:(image:RgbaImage)=>pixels.bandboolImage(image,op)})),
  {node:{kind:"withMetadata",density:144,orientation:6},oracle:image=>({...image,density:144,orientation:6})}
];
function fixture(channels:1|2|3|4=4) {
  const width=73,height=19;
  const data=Uint8Array.from({length:width*height*4},(_,i)=>i%97<8?255:(i*37+Math.floor(i/7))%256);
  if(channels<3)for(let i=0;i<data.length;i+=4)data[i+1]=data[i+2]=data[i]!;
  if(channels%2)for(let i=3;i<data.length;i+=4)data[i]=255;
  const image:RgbaImage={width,height,data,channels,hasAlpha:channels%2===0,space:channels<3?"b-w":"srgb",depth:"uchar",format:"png",density:96,orientation:3,pages:1,pageHeight:height};
  const memory=new Uint8Array(data.length*3+16),borrowed=new Uint8Array(4096);memory.set(data,8);
  const storage={allocate:vi.fn(()=>data.length+8),read:vi.fn(async(position:number,length:number)=>{borrowed.fill(19);borrowed.set(memory.subarray(position,position+length));return borrowed.subarray(0,length);}),write:vi.fn(async(position:number,bytes:Uint8Array)=>{memory.set(bytes,position);})};
  const {data:ignored,...metadata}=image;
  return {image,stored:{...metadata,position:8},storage,memory};
}
for(const channels of [1,2,3,4] as const)it.each(cases)(`matches $node.kind pixel and metadata semantics with ${channels} channels`,async({node,oracle})=>{
  const {image,stored,storage,memory}=fixture(channels);
  let expected:RgbaImage;
  try {expected=oracle(image);} catch(error) {
    await expect(transformStoredImage(stored,storage,node,new AbortController().signal)).rejects.toThrow((error as Error).message);
    expect(storage.allocate).not.toHaveBeenCalled();return;
  }
  const actual=await transformStoredImage(stored,storage,node,new AbortController().signal);
  expect({...actual,position:undefined}).toEqual({...expected,data:undefined});
  expect(Buffer.compare(memory.subarray(actual.position,actual.position+image.data.length),expected.data)).toBe(0);
  expect(Buffer.compare(memory.subarray(8,8+image.data.length),image.data)).toBe(0);
  if(node.kind==="withMetadata")expect(storage.allocate).not.toHaveBeenCalled();
  else {
    expect(storage.read.mock.calls.map(([,length])=>length)).toEqual([4096,image.data.length-4096]);
    expect(storage.write.mock.calls.every(([,bytes])=>bytes.length<=4096)).toBe(true);
  }
});

it.each(["before","read","write"])("stops pixel storage work on %s cancellation",async phase=>{
  const {stored,storage}=fixture(),controller=new AbortController(),reason={phase};
  if(phase==="before")controller.abort(reason);
  if(phase==="read")storage.read.mockImplementationOnce(async(_position,length)=>{controller.abort(reason);return new Uint8Array(length);});
  if(phase==="write")storage.write.mockImplementationOnce(async()=>{controller.abort(reason);});
  await expect(transformStoredImage(stored,storage,{kind:"negate",alpha:true},controller.signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(phase==="before"?0:1);
  expect(storage.write).toHaveBeenCalledTimes(phase==="write"?1:0);
});
it("propagates storage write failure and performs no subsequent reads",async()=>{
  const {stored,storage}=fixture(),reason=new Error("write failure");storage.write.mockRejectedValueOnce(reason);
  await expect(transformStoredImage(stored,storage,{kind:"grayscale"},new AbortController().signal)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(1);expect(storage.write).toHaveBeenCalledTimes(1);
});
it("rejects short chunks before writing",async()=>{
  const {stored,storage}=fixture();storage.read.mockResolvedValueOnce(new Uint8Array(4095));
  await expect(transformStoredImage(stored,storage,{kind:"grayscale"},new AbortController().signal)).rejects.toThrow("Truncated image backing storage");
  expect(storage.write).not.toHaveBeenCalled();
});
it("rejects extracting absent alpha before allocating storage",async()=>{
  const {stored,storage}=fixture(3);
  await expect(transformStoredImage(stored,storage,{kind:"extractChannel",channel:3},new AbortController().signal)).rejects.toThrow("Cannot extract channel");
  expect(storage.allocate).not.toHaveBeenCalled();
});

const chains:Record<string,(image:ReturnType<typeof sharp>)=>ReturnType<typeof sharp>>={
  gammaRecomb:image=>image.gamma(1.9,2.4).recomb(matrix).linear(1.2,3),
  gammaModulateRecomb:image=>image.modulate({brightness:1.2,hue:35}).gamma(2.2,1.8).recomb(matrix).negate({alpha:true}).grayscale(),
  alpha:image=>image.removeAlpha().ensureAlpha(0.4).extractChannel(3),
  flatten:image=>image.grayscale().flatten({background:"blue"}).unflatten().threshold(140,{grayscale:false}),
  channels:image=>image.bandbool("eor").tint("red").toColorspace("b-w"),
  rgb16:image=>image.toColorspace("rgb16"),
  grey16:image=>image.toColorspace("grey16"),
  metadata:image=>image.withMetadata({density:144,orientation:6}).negate()
};
it.each(Object.entries(chains))("matches public PNG pixels and output metadata for %s",async(_name,chain)=>{
  const {image}=fixture(),fs=new MemoryFileSystem();
  const input=await sharp(image.data,{raw:{width:image.width,height:image.height,channels:4}}).png().toBuffer();await fs.writeFile("/in.png",input);
  const guarded=new Proxy(fs,{get(target,key){if(key==="readFile" || key==="writeFile")return()=>{throw new Error("whole-file I/O forbidden");};const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
  const expected=await chain(sharp(input)).png().toBuffer({resolveWithObject:true});
  const actual=await chain(sharp("/in.png",{filesystem:guarded})).png().toFile("/out.png");
  const output=await fs.readFile("/out.png");
  expect(Buffer.compare(await sharp(output).raw().toBuffer(),await sharp(expected.data).raw().toBuffer())).toBe(0);
  expect({...actual,size:0}).toEqual({...expected.info,size:0});
  expect({...await sharp(output).metadata(),size:0}).toEqual({...await sharp(expected.data).metadata(),size:0});
  expect(actual.size).toBe(output.length);
  expect((await fs.readdir("/")).map(entry=>entry.name)).toEqual(["in.png","out.png"]);
});
