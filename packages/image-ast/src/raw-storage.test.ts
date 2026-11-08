import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {encodeRawFromStorage} from "./codecs/raw-storage.js";
import {encodeImage} from "./codecs/index.js";

for(const channels of [1,2,3,4] as const)for(const depth of ["char","uchar","short","ushort","int","uint","float","double"] as const)
it(`encodes borrowed raw chunks ${channels}/${depth} above 32-bit backing offsets`,async()=>{
 const width=1025,height=3,data=Uint8Array.from({length:width*height*4},(_,i)=>i%256),data16=Uint16Array.from({length:521*4},(_,i)=>(i*511+17)%65536);
 const high=new Uint8Array(data16.buffer),position=2**32+17,highPosition=position+data.length+19;
 const metadata={width,height,channels,space:"rgb16" as const,format:"raw" as const,depth:"ushort" as const,density:72,hasAlpha:channels===2||channels===4};
 const expected=encodeImage({...metadata,data,data16},{format:"raw",rawDepth:depth}).data,borrowed=new Uint8Array(4096);let reads=0;
 const storage={allocate(){throw new Error("encoder allocation");},async write(){throw new Error("encoder write");},async read(at:number,length:number){reads++;expect(length).toBeLessThanOrEqual(4096);borrowed.fill(0);borrowed.set(at>=highPosition?high.subarray(at-highPosition,at-highPosition+length):data.subarray(at-position,at-position+length));return borrowed.subarray(0,length);}};
 const stream=encodeRawFromStorage({...metadata,position,storedData16:{position:highPosition,length:data16.length}},storage,new AbortController().signal,{rawDepth:depth});
 expect(reads).toBe(0);const chunks:Uint8Array[]=[];
 for await(const chunk of stream){const copy=new Uint8Array(chunk),before=reads;await Promise.resolve();expect(reads).toBe(before);expect(chunk).toEqual(copy);chunks.push(chunk);}
 const actual=new Uint8Array(chunks.reduce((n,chunk)=>n+chunk.length,0));let at=0;for(const chunk of chunks){actual.set(chunk,at);at+=chunk.length;}
 expect(createHash("sha256").update(expected).digest("hex")).toMatchSnapshot();
 expect(chunks.length).toBeGreaterThan(1);expect(actual).toEqual(expected);
});

for(const fault of ["read","short","cancel"] as const)it(`stops raw encoding on ${fault}`,async()=>{
 const controller=new AbortController(),reason=new Error("raw read failed");let reads=0;
 const storage={allocate(){throw new Error("encoder allocation");},async write(){throw new Error("encoder write");},async read(_at:number,length:number){reads++;if(reads===2){if(fault==="read")throw reason;if(fault==="short")return new Uint8Array(length-1);controller.abort(reason);}return new Uint8Array(length);}};
 const stream=encodeRawFromStorage({width:1025,height:1,position:8,format:"raw",channels:4,space:"srgb",depth:"uchar",density:72,hasAlpha:true},storage,controller.signal);
 expect((await stream.next()).done).toBe(false);
 if(fault==="short")await expect(stream.next()).rejects.toThrow("Truncated raw pixel storage");else await expect(stream.next()).rejects.toBe(reason);
 expect((await stream.next()).done).toBe(true);expect(reads).toBe(2);
});

for(const invalid of [{width:Infinity},{height:-1},{position:-1},{width:2**52},{storedData16:{position:-1,length:4}},{storedData16:{position:8,length:Infinity}}])it(`rejects invalid raw backing ${JSON.stringify(invalid)}`,async()=>{
 let reads=0;const storage={allocate(){throw new Error("encoder allocation");},async write(){throw new Error("encoder write");},async read(){reads++;return new Uint8Array(4);}};
 const stream=encodeRawFromStorage({width:1,height:1,position:8,format:"raw",channels:4,space:"rgb16",depth:"uchar",density:72,hasAlpha:true,...invalid},storage,new AbortController().signal);
 await expect(stream.next()).rejects.toThrow("Invalid raw backing allocation");expect(reads).toBe(0);
});

it("captures raw metadata and encoding options before asynchronous backing reads",async()=>{
 const image={width:1025,height:1,position:8,format:"raw" as const,channels:4 as const,space:"rgb16" as const,depth:"uchar" as const,density:72,hasAlpha:true,storedData16:{position:10000,length:4100}},options={rawDepth:"ushort"};
 const data=new Uint8Array(4100).fill(7),data16=new Uint16Array(4100).fill(513),high=new Uint8Array(data16.buffer);
 const expected=encodeImage({...image,data,data16},{...options,format:"raw"}).data;
 const storage={allocate(){throw new Error("encoder allocation");},async write(){throw new Error("encoder write");},async read(at:number,length:number){image.width=1;image.position=999999;image.storedData16.position=999999;image.storedData16.length=0;options.rawDepth="uchar";return at>=10000?high.subarray(at-10000,at-10000+length):data.subarray(at-8,at-8+length);}};
 const chunks:Uint8Array[]=[];for await(const chunk of encodeRawFromStorage(image,storage,new AbortController().signal,options))chunks.push(chunk);
 const result=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}expect(result).toEqual(expected);
});
