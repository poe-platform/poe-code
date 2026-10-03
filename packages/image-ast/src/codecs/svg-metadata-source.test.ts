import {expect,test} from "vitest";
import {readImageMetadataFromSource} from "./metadata-source.js";
import {readSvgMetadata} from "./svg-pdf.js";
import type {ImageByteSource} from "./png-storage.js";

for(const attributes of [
 'WIDTH="13" HEIGHT="7"',
 'width="13" width="99" height="7"',
 'viewBox="0, 0, 13, 7"',
 'width=" ' + "\u00a0".repeat(2048) + '12px" height="7"',
 'width="12cm" height="8pt"',
 'width="  +.5cm  " height="1e2cm"',
 'width="-5%" height="0" viewBox="-2 -3 20 12"',
 'width="'+"0".repeat(10000)+'12pt" height="8px"',
 'width="0.'+"0".repeat(10000)+'12e10002" height="8"',
 'width="1e'+"9".repeat(10000)+'" height="8"',
 'viewBox="0 0 '+"0".repeat(10000)+'12 8"',
 'viewBox="0 0 0x10 8"',
 'viewBox="0 0 12 8,"',
 'width="\u00a012px\u00a0" height="8"',
])test(`retains SVG metadata parity for ${attributes.slice(0,50)}`,async()=>{
 const bytes=new TextEncoder().encode('<svg '+attributes+'><rect width="1"/></svg>'),loan=new Uint8Array(4096);
 const source:ImageByteSource={size:bytes.length,async read(position,length){expect(length).toBeLessThanOrEqual(4096);loan.fill(0);loan.set(bytes.subarray(position,position+length));return loan.subarray(0,length);}};
 expect(await readImageMetadataFromSource(source,new AbortController().signal,{density:90})).toEqual(readSvgMetadata(bytes,{density:90}));
});

test("skips an arbitrarily large unrelated SVG attribute without reading the document body",async()=>{
 const first=new TextEncoder().encode('<svg data-padding="'),last=new TextEncoder().encode('" width="13" height="7">'),padding=1024*1024,headerLength=first.length+padding+last.length;
 let furthest=0,reads=0;const loan=new Uint8Array(4096);
 const source:ImageByteSource={size:headerLength+500_000_000,async read(position,length){expect(length).toBeLessThanOrEqual(4096);furthest=Math.max(furthest,position+length);reads++;loan.fill(120);for(const [start,bytes]of [[0,first],[first.length+padding,last]] as const){const begin=Math.max(position,start),end=Math.min(position+length,start+bytes.length);if(begin<end)loan.set(bytes.subarray(begin-start,end-start),begin-position);}return loan.subarray(0,length);}};
 expect(await readImageMetadataFromSource(source,new AbortController().signal)).toMatchObject({format:"svg",width:13,height:7,size:source.size});
 expect(furthest).toBeLessThanOrEqual(Math.ceil(headerLength/4096)*4096);
 expect(reads).toBeLessThanOrEqual(Math.ceil(headerLength/4096)+16);
});

test("preserves whitespace following malformed UTF-8 in an SVG header",async()=>{
 const first=new TextEncoder().encode('<svg'),last=new TextEncoder().encode(' width="13" height="7">'),bytes=new Uint8Array(first.length+2+last.length);bytes.set(first);bytes.set([0xe2,0x82],first.length);bytes.set(last,first.length+2);
 const source:ImageByteSource={size:bytes.length,async read(position,length){return bytes.subarray(position,position+length);}};
 expect(await readImageMetadataFromSource(source,new AbortController().signal)).toEqual(readSvgMetadata(bytes));
});
