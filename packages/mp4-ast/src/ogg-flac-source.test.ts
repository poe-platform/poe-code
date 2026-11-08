import assert from "node:assert/strict";
import { it } from "node:test";
import * as media from "./index.js";

function crc(bytes: Uint8Array) { let value = 0; for (let i = 0; i < bytes.length; i++) { value ^= (i >= 22 && i < 26 ? 0 : bytes[i]!) << 24; for (let bit = 0; bit < 8; bit++) value = value << 1 ^ (value & 0x80000000 ? 0x04c11db7 : 0); } return value >>> 0; }
function fixture() {
  const header = new Uint8Array(51); header.set([127,70,76,65,67,1,0,0,1,102,76,97,67,128,0,0,34]);
  new DataView(header.buffer).setBigUint64(27,48000n << 44n | 1n << 41n | 23n << 36n | 96000n);
  const packets = [header, new Uint8Array(200000)], pages: Uint8Array[] = [];
  for (const packet of packets) for (let at = 0; at <= packet.length;) {
    const length = Math.min(65025,packet.length-at), last=length<65025, laces=Array.from({length:Math.floor(length/255)},()=>255); if(last) laces.push(length%255);
    const page=new Uint8Array(27+laces.length+length);page.set([79,103,103,83,9,at?129:128]);page[26]=laces.length;page.set(laces,27);page.set(packet.subarray(at,at+length),27+laces.length);new DataView(page.buffer).setUint32(22,crc(page),true);pages.push(page);at+=length;if(last)break;
  }
  const bytes=new Uint8Array(pages.reduce((n,p)=>n+p.length,0));let at=0;for(const page of pages){bytes.set(page,at);at+=page.length;}return bytes;
}
const probe = media.probeOggFlacSource;
it("probes Ogg FLAC with bounded borrowed short reads and legacy mapping semantics",async()=>{
  assert.equal(typeof probe,"function"); const bytes=fixture(),options={filename:"recording.oga",showFrames:true,showPackets:true};let read=0;
  const result=await probe({size:bytes.length,async read(offset,length){assert.ok(length<=16384);const take=Math.min(length,37);read+=take;return bytes.subarray(offset,offset+take);}},options);
  assert.deepEqual(result,media.oggAst().probe(bytes,options));assert.equal(read,bytes.length);
});
it("validates late CRC and continuation failures without publishing metadata",async()=>{
  assert.equal(typeof probe,"function");const bytes=fixture();bytes[bytes.length-1]!^=1;
  await assert.rejects(probe({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}}),/CRC/);
});
it("propagates read failures and post-read cancellation",async()=>{
  assert.equal(typeof probe,"function");const bytes=fixture(),controller=new AbortController();
  await assert.rejects(probe({size:bytes.length,async read(){throw new Error("read failed");}}),/read failed/);
  await assert.rejects(probe({size:bytes.length,async read(offset,length){controller.abort(new Error("cancelled"));return bytes.slice(offset,offset+length);}}, {signal:controller.signal}),/cancelled/);
});
it("rejects invalid ranges and truncated sources",async()=>{
  assert.equal(typeof probe,"function");
  await assert.rejects(probe({size:-1,async read(){throw new Error("unexpected");}}),/size/);
  await assert.rejects(probe({size:40,async read(){return new Uint8Array();}}),/Truncated/);
});

it("preserves unsupported mapping and continuation diagnostics",async()=>{
  for(const mutation of ['mapping','continuation','length']){
    const bytes=fixture().slice(0,mutation==='length'?78:79);
    if(mutation==='mapping')bytes[33]=2;
    if(mutation==='continuation')bytes[5]!|=1;
    if(mutation==='length')bytes[27]=50;
    new DataView(bytes.buffer).setUint32(22,crc(bytes),true);
    await assert.rejects(probe({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}}),mutation==='continuation'?/continuation/:/mapping/);
  }
});
it("returns undefined for non-FLAC or empty input without retaining packets",async()=>{
  const bytes=fixture().slice(0,79);bytes[28]=0;new DataView(bytes.buffer).setUint32(22,crc(bytes),true);
  assert.equal(await probe({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}}),undefined);
  assert.equal(await probe({size:0,async read(){throw new Error('unexpected');}}),undefined);
});
it("rejects oversized reads and checkpoint failure",async()=>{
  const bytes=fixture();
  await assert.rejects(probe({size:bytes.length,async read(){return bytes;}}),/more bytes/);
  await assert.rejects(probe({size:bytes.length,async read(offset,length){return bytes.slice(offset,offset+length);}},{checkpoint(){throw new Error('checkpoint failure');}}),/checkpoint failure/);
});
