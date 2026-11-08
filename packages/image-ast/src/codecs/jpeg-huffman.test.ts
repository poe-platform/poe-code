import {build} from "esbuild";
import {runInNewContext} from "node:vm";
import {fileURLToPath} from "node:url";
import {expect,it} from "vitest";
import {decodeJpegImage} from "./jpeg.js";
interface HuffmanVector {name:string; length:number; counts:number[]; symbols:number[]; entropy:number[]; ending:number[]; progressive:boolean; error?:string; pixels?:number[]}
// Frozen before the bounded Huffman representation change.
const huffmanVectors: HuffmanVector[] = [
  {"name":"empty-no-bits-marker-baseline","length":139,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[],"ending":[255,217],"progressive":false,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"empty-no-bits-eof-baseline","length":137,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[],"ending":[],"progressive":false,"error":"Truncated JPEG entropy data"},
  {"name":"empty-no-bits-escape-baseline","length":138,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[],"ending":[255],"progressive":false,"error":"Truncated JPEG entropy escape"},
  {"name":"empty-eight-bits-marker-baseline","length":140,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255,217],"progressive":false,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"empty-eight-bits-eof-baseline","length":138,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[],"progressive":false,"error":"Truncated JPEG entropy data"},
  {"name":"empty-eight-bits-escape-baseline","length":139,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255],"progressive":false,"error":"Truncated JPEG entropy escape"},
  {"name":"empty-sixteen-bits-marker-baseline","length":141,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[255,217],"progressive":false,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"empty-sixteen-bits-eof-baseline","length":139,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[],"progressive":false,"error":"Truncated JPEG entropy data"},
  {"name":"empty-sixteen-bits-escape-baseline","length":140,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[255],"progressive":false,"error":"Truncated JPEG entropy escape"},
  {"name":"empty-twenty-four-bits-marker-baseline","length":142,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0,0],"ending":[255,217],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"empty-twenty-four-bits-eof-baseline","length":140,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0,0],"ending":[],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"empty-twenty-four-bits-escape-baseline","length":141,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0,0],"ending":[255],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"sparse-assigned-marker-baseline","length":141,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[0],"ending":[255,217],"progressive":false,"pixels":[128,128,128,255]},
  {"name":"sparse-assigned-eof-baseline","length":139,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[0],"ending":[],"progressive":false,"pixels":[128,128,128,255]},
  {"name":"sparse-assigned-escape-baseline","length":140,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[0],"ending":[255],"progressive":false,"pixels":[128,128,128,255]},
  {"name":"sparse-unassigned-eight-bits-marker-baseline","length":141,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128],"ending":[255,217],"progressive":false,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"sparse-unassigned-eight-bits-eof-baseline","length":139,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128],"ending":[],"progressive":false,"error":"Truncated JPEG entropy data"},
  {"name":"sparse-unassigned-eight-bits-escape-baseline","length":140,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128],"ending":[255],"progressive":false,"error":"Truncated JPEG entropy escape"},
  {"name":"sparse-unassigned-sixteen-bits-marker-baseline","length":142,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0],"ending":[255,217],"progressive":false,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"sparse-unassigned-sixteen-bits-eof-baseline","length":140,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0],"ending":[],"progressive":false,"error":"Truncated JPEG entropy data"},
  {"name":"sparse-unassigned-sixteen-bits-escape-baseline","length":141,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0],"ending":[255],"progressive":false,"error":"Truncated JPEG entropy escape"},
  {"name":"sparse-unassigned-twenty-four-bits-marker-baseline","length":143,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0,0],"ending":[255,217],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"sparse-unassigned-twenty-four-bits-eof-baseline","length":141,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0,0],"ending":[],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"sparse-unassigned-twenty-four-bits-escape-baseline","length":142,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0,0],"ending":[255],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-marker-baseline","length":140,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255,217],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-eof-baseline","length":138,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-escape-baseline","length":139,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-eight-bit-marker-baseline","length":140,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255,217],"progressive":false,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"missing-leaf-eight-bit-eof-baseline","length":138,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[],"progressive":false,"error":"Truncated JPEG entropy data"},
  {"name":"missing-leaf-eight-bit-escape-baseline","length":139,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255],"progressive":false,"error":"Truncated JPEG entropy escape"},
  {"name":"missing-leaf-eight-bit-more-marker-baseline","length":141,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[255,217],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-eight-bit-more-eof-baseline","length":139,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-eight-bit-more-escape-baseline","length":140,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[255],"progressive":false,"error":"Invalid JPEG Huffman code"},
  {"name":"oversubscribed-marker-baseline","length":143,"counts":[3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0,0,15],"entropy":[128],"ending":[255,217],"progressive":false,"pixels":[128,128,128,255]},
  {"name":"oversubscribed-eof-baseline","length":141,"counts":[3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0,0,15],"entropy":[128],"ending":[],"progressive":false,"pixels":[128,128,128,255]},
  {"name":"oversubscribed-escape-baseline","length":142,"counts":[3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0,0,15],"entropy":[128],"ending":[255],"progressive":false,"pixels":[128,128,128,255]},
  {"name":"one-long-marker-baseline","length":143,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],"symbols":[0],"entropy":[0,0,0],"ending":[255,217],"progressive":false,"pixels":[128,128,128,255]},
  {"name":"one-long-eof-baseline","length":141,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],"symbols":[0],"entropy":[0,0,0],"ending":[],"progressive":false,"pixels":[128,128,128,255]},
  {"name":"one-long-escape-baseline","length":142,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],"symbols":[0],"entropy":[0,0,0],"ending":[255],"progressive":false,"pixels":[128,128,128,255]},
  {"name":"empty-no-bits-marker-progressive","length":139,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[],"ending":[255,217],"progressive":true,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"empty-no-bits-eof-progressive","length":137,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[],"ending":[],"progressive":true,"error":"Truncated JPEG entropy data"},
  {"name":"empty-no-bits-escape-progressive","length":138,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[],"ending":[255],"progressive":true,"error":"Truncated JPEG entropy escape"},
  {"name":"empty-eight-bits-marker-progressive","length":140,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255,217],"progressive":true,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"empty-eight-bits-eof-progressive","length":138,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[],"progressive":true,"error":"Truncated JPEG entropy data"},
  {"name":"empty-eight-bits-escape-progressive","length":139,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255],"progressive":true,"error":"Truncated JPEG entropy escape"},
  {"name":"empty-sixteen-bits-marker-progressive","length":141,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[255,217],"progressive":true,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"empty-sixteen-bits-eof-progressive","length":139,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[],"progressive":true,"error":"Truncated JPEG entropy data"},
  {"name":"empty-sixteen-bits-escape-progressive","length":140,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[255],"progressive":true,"error":"Truncated JPEG entropy escape"},
  {"name":"empty-twenty-four-bits-marker-progressive","length":142,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0,0],"ending":[255,217],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"empty-twenty-four-bits-eof-progressive","length":140,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0,0],"ending":[],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"empty-twenty-four-bits-escape-progressive","length":141,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0,0],"ending":[255],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"sparse-assigned-marker-progressive","length":141,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[0],"ending":[255,217],"progressive":true,"pixels":[128,128,128,255]},
  {"name":"sparse-assigned-eof-progressive","length":139,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[0],"ending":[],"progressive":true,"pixels":[128,128,128,255]},
  {"name":"sparse-assigned-escape-progressive","length":140,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[0],"ending":[255],"progressive":true,"pixels":[128,128,128,255]},
  {"name":"sparse-unassigned-eight-bits-marker-progressive","length":141,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128],"ending":[255,217],"progressive":true,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"sparse-unassigned-eight-bits-eof-progressive","length":139,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128],"ending":[],"progressive":true,"error":"Truncated JPEG entropy data"},
  {"name":"sparse-unassigned-eight-bits-escape-progressive","length":140,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128],"ending":[255],"progressive":true,"error":"Truncated JPEG entropy escape"},
  {"name":"sparse-unassigned-sixteen-bits-marker-progressive","length":142,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0],"ending":[255,217],"progressive":true,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"sparse-unassigned-sixteen-bits-eof-progressive","length":140,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0],"ending":[],"progressive":true,"error":"Truncated JPEG entropy data"},
  {"name":"sparse-unassigned-sixteen-bits-escape-progressive","length":141,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0],"ending":[255],"progressive":true,"error":"Truncated JPEG entropy escape"},
  {"name":"sparse-unassigned-twenty-four-bits-marker-progressive","length":143,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0,0],"ending":[255,217],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"sparse-unassigned-twenty-four-bits-eof-progressive","length":141,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0,0],"ending":[],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"sparse-unassigned-twenty-four-bits-escape-progressive","length":142,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0],"entropy":[128,0,0],"ending":[255],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-marker-progressive","length":140,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255,217],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-eof-progressive","length":138,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-escape-progressive","length":139,"counts":[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-eight-bit-marker-progressive","length":140,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255,217],"progressive":true,"error":"Unexpected JPEG marker in entropy data"},
  {"name":"missing-leaf-eight-bit-eof-progressive","length":138,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[],"progressive":true,"error":"Truncated JPEG entropy data"},
  {"name":"missing-leaf-eight-bit-escape-progressive","length":139,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0],"ending":[255],"progressive":true,"error":"Truncated JPEG entropy escape"},
  {"name":"missing-leaf-eight-bit-more-marker-progressive","length":141,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[255,217],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-eight-bit-more-eof-progressive","length":139,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"missing-leaf-eight-bit-more-escape-progressive","length":140,"counts":[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],"symbols":[],"entropy":[0,0],"ending":[255],"progressive":true,"error":"Invalid JPEG Huffman code"},
  {"name":"oversubscribed-marker-progressive","length":143,"counts":[3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0,0,15],"entropy":[128],"ending":[255,217],"progressive":true,"pixels":[128,128,128,255]},
  {"name":"oversubscribed-eof-progressive","length":141,"counts":[3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0,0,15],"entropy":[128],"ending":[],"progressive":true,"pixels":[128,128,128,255]},
  {"name":"oversubscribed-escape-progressive","length":142,"counts":[3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"symbols":[0,0,15],"entropy":[128],"ending":[255],"progressive":true,"pixels":[128,128,128,255]},
  {"name":"one-long-marker-progressive","length":143,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],"symbols":[0],"entropy":[0,0,0],"ending":[255,217],"progressive":true,"pixels":[128,128,128,255]},
  {"name":"one-long-eof-progressive","length":141,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],"symbols":[0],"entropy":[0,0,0],"ending":[],"progressive":true,"pixels":[128,128,128,255]},
  {"name":"one-long-escape-progressive","length":142,"counts":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],"symbols":[0],"entropy":[0,0,0],"ending":[255],"progressive":true,"pixels":[128,128,128,255]}
];
const segment=(marker:number,data:number[])=>[255,marker,(data.length+2)>>>8,(data.length+2)&255,...data];
it.each(huffmanVectors)("preserves Huffman admission: $name",v=>{
 const input=Uint8Array.from([255,216,...segment(219,[0,...Array<number>(64).fill(1)]),...segment(v.progressive?194:192,[8,0,1,0,1,1,1,17,0]),...segment(196,[0,...v.counts,...v.symbols]),...segment(196,[16,1,...Array<number>(15).fill(0),0]),...segment(218,[1,1,0,0,v.progressive?0:63,0]),...v.entropy,...v.ending]);
 if(v.error)expect(()=>decodeJpegImage(input)).toThrow(v.error);else expect([...decodeJpegImage(input).data]).toEqual(v.pixels);
});
it("keeps sparse Huffman metadata bounded in a self-contained Worker",async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL("./jpeg.ts",import.meta.url))],bundle:true,platform:"browser",format:"iife",globalName:"jpeg",write:false});
 const probe={peak:0};
 const runtime=runInNewContext(`const push=Array.prototype.push;Array.prototype.push=function(...args){const n=push.apply(this,args);probe.peak=Math.max(probe.peak,n);return n;};${bundle.outputFiles[0]!.text};jpeg`,{probe,Uint8Array,TextEncoder,TextDecoder}) as typeof import("./jpeg.js");
 for(const counts of [[],Array<number>(16).fill(0),[1,...Array<number>(15).fill(0),0],[...Array<number>(15).fill(0),1,0]]){
  probe.peak=0;
  const input=Uint8Array.from([255,216,...segment(196,[0,...counts]),...segment(192,[8,0,1,0,1,1,1,17,0]),255,217]);
  expect([...runtime.decodeJpegImage(input).data]).toEqual([0,0,0,255]);
  expect(probe.peak).toBeLessThanOrEqual(4096);
 }
});
