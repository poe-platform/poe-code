import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { OggIndex } from "./ogg-index.js";

function page(data: Uint8Array, lacing: number[], serial: number, sequence: number, flags: number, granule = 0n) {
  const bytes = new Uint8Array(27 + lacing.length + data.length), view = new DataView(bytes.buffer);
  bytes.set([79,103,103,83,0,flags]); view.setBigUint64(6, granule, true); view.setUint32(14, serial, true); view.setUint32(18, sequence, true);
  bytes[26] = lacing.length; bytes.set(lacing,27); bytes.set(data,27+lacing.length);
  let crc = 0;
  for (const byte of bytes) { crc ^= byte << 24; for (let bit = 0; bit < 8; bit++) crc = crc << 1 ^ (crc & 0x80000000 ? 0x04c11db7 : 0); }
  view.setUint32(22,crc>>>0,true); return bytes;
}
function join(parts: Uint8Array[]) { const bytes = new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let offset=0; for(const part of parts){bytes.set(part,offset);offset+=part.length;} return bytes; }
function packets(serial: number, values: Uint8Array[]) {
  const pages: Uint8Array[] = []; let sequence = 0;
  for (const [index, value] of values.entries()) {
    for (let at = 0; at <= value.length;) {
      const length = Math.min(65025, value.length-at), final = length < 65025;
      const laces = Array.from({length: Math.floor(length/255)},()=>255);
      if (final) laces.push(length%255);
      pages.push(page(value.subarray(at,at+length),laces,serial,sequence++,
        (index===0&&at===0?2:0)|(at?1:0)|(index===values.length-1&&final?4:0), final ? BigInt(index*48000) : 0xffffffffffffffffn));
      at+=length; if(final)break;
    }
  }
  return pages;
}
function setup(bytes: Uint8Array) {
  const fs = new MemoryFileSystem(), controller = new AbortController(), borrowed = new Uint8Array(16384); let reads = 0;
  const index = new OggIndex({size: bytes.length,async read(offset,length){expect(length).toBeLessThanOrEqual(16384);reads++;borrowed.set(bytes.subarray(offset,offset+length));return borrowed.subarray(0,length);}}, {fs, cwd:"/",env:{},signal:controller.signal});
  return {index,fs,controller,reads:()=>reads};
}
async function materialize(source: {size:number;read(offset:number,length:number):Promise<Uint8Array>}) {
  const chunks=[]; for(let at=0;at<source.size;){const bytes=await source.read(at,Math.min(16384,source.size-at));expect(bytes.length).toBeGreaterThan(0);chunks.push(bytes);at+=bytes.length;} return join(chunks);
}

it("indexes large continued header/comment packets and skips sample packet spans", async()=>{
  const head=new Uint8Array(140000).fill(7),comments=new Uint8Array(190000).map((_,i)=>i%251),audio=new Uint8Array(300000).fill(11);
  const bytes=join(packets(42,[head,comments,audio])),{index,fs}=setup(bytes);
  try {
    await index.scan();const streams=[];for await(const stream of index.streams())streams.push(stream);
    expect(streams).toHaveLength(1);const stream=streams[0]!;
    expect(stream.serial).toBe(42);expect(stream.size).toBe(bytes.length);expect(stream.granule).toBe(96000n);expect(stream.packets).toBe(3);
    expect(await materialize(stream.head!)).toEqual(head);expect(await materialize(stream.comments!)).toEqual(comments);
    expect(await stream.comments!.read(65020,20)).toEqual(comments.slice(65020,65040));
    expect(await stream.comments!.read(12,5)).toEqual(comments.slice(12,17));
  }finally{await index.close();}
  expect(await fs.readdir("/")).toEqual([]);
});
it("preserves first completed packet order, interleaved streams, empty packets and final known granules",async()=>{
  const a=packets(99,[new Uint8Array(80000).fill(3),new Uint8Array()]);
  const b=packets(2,[Uint8Array.of(4),Uint8Array.of(5)]);
  const bytes=join([a[0]!,b[0]!,a[1]!,b[1]!,a[2]!]),{index}=setup(bytes);
  try{await index.scan();const streams=[];for await(const stream of index.streams())streams.push(stream);
    expect(streams.map(s=>s.serial)).toEqual([2,99]);expect(streams.map(s=>s.granule)).toEqual([48000n,48000n]);
    expect((await materialize(streams[1]!.head!)).length).toBe(80000);expect(streams[1]!.comments!.size).toBe(0);
    expect(await materialize(streams[0]!.comments!)).toEqual(Uint8Array.of(5));
  }finally{await index.close();}
});
it("spills stream state beyond its bounded index cache",async()=>{
  const bytes=join(Array.from({length:300},(_,i)=>packets(300-i,[Uint8Array.of(i%251)] )).flat()),{index,fs}=setup(bytes);
  try {await index.scan();let count=0;for await(const stream of index.streams()){
    expect(stream.serial).toBe(300-count);expect(await materialize(stream.head!)).toEqual(Uint8Array.of(count%251));expect(stream.comments).toBeUndefined();count++;
  }expect(count).toBe(300);}finally{await index.close();}expect(await fs.readdir("/")).toEqual([]);
});
for(const [name,bytes,message] of [
  ["empty",new Uint8Array(),"Incomplete Ogg stream"],
  ["missing BOS",page(Uint8Array.of(1),[1],1,0,4),"Missing Ogg beginning-of-stream"],
  ["missing EOS",page(Uint8Array.of(1),[1],1,0,2),"Incomplete Ogg stream"],
  ["sequence",join([page(Uint8Array.of(1),[1],1,0,2),page(Uint8Array.of(2),[1],1,2,4)]),"Invalid Ogg sequence/continuation"],
  ["continuation",join([page(new Uint8Array(255),[255],1,0,2),page(Uint8Array.of(2),[1],1,1,4)]),"Invalid Ogg sequence/continuation"],
  ["ended",join([page(Uint8Array.of(1),[1],1,0,6),page(Uint8Array.of(2),[1],1,1,4)]),"Invalid Ogg sequence/continuation"],
  ["incomplete packet",page(new Uint8Array(255),[255],1,0,6),"Incomplete final Ogg packet"]
] as const)it(`rejects ${name} logical structure`,async()=>{
  const {index,fs}=setup(bytes);try{await expect(index.scan()).rejects.toThrow(message);}finally{await index.close();}expect(await fs.readdir("/")).toEqual([]);
});
it("does not retain borrowed source buffers and checks replay cancellation",async()=>{
  const bytes=join(packets(1,[new Uint8Array(100000).fill(12)])),{index,controller}=setup(bytes);
  try{await index.scan();const iterator=index.streams(),stream=(await iterator.next()).value!;await iterator.return();
    controller.abort(new Error("cancelled replay"));await expect(stream.head!.read(0,10)).rejects.toThrow("cancelled replay");
  }finally{await index.close();}
});

it("retires cached packet views when the index closes",async()=>{
  const {index,reads}=setup(join(packets(1,[Uint8Array.of(1,2,3)])));
  await index.scan();const iterator=index.streams(),stream=(await iterator.next()).value!;await iterator.return();
  await stream.head!.read(0,1);await index.close();const count=reads();
  await expect(stream.head!.read(1,1)).rejects.toThrow("Ogg index is closed");expect(reads()).toBe(count);
});

it("handles zero laces terminating an exact-page packet and ignores unknown final granules",async()=>{
  const bytes=join([page(new Uint8Array(65025).fill(6),new Array(255).fill(255),1,0,2,0xffffffffffffffffn),page(new Uint8Array(),[0],1,1,1,123n),page(Uint8Array.of(7),[1],1,2,4,0xffffffffffffffffn)]);
  const {index}=setup(bytes);try{await index.scan();for await(const stream of index.streams()){
    expect(stream.packets).toBe(2);expect(stream.granule).toBe(123n);expect(await materialize(stream.head!)).toEqual(new Uint8Array(65025).fill(6));expect(await materialize(stream.comments!)).toEqual(Uint8Array.of(7));
  }}finally{await index.close();}
});
