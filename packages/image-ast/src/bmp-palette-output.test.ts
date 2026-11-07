import {expect, it} from "vitest";
import {encodeBmpImage, decodeBmpImage} from "./codecs/netpbm.js";
import type {RgbaImage} from "./ast.js";

it("falls back to truecolor when a transformed palette exceeds 256 colors", () => {
 const data=Uint8Array.from(Array.from({length:257},(_,i)=>[i&255,i>>>8,0,255]).flat());
 const image:RgbaImage={width:257,height:1,data,format:"png",space:"srgb",channels:3,depth:"uchar",density:72,hasAlpha:false,isPalette:true};
 const output=encodeBmpImage(image);
 expect(new DataView(output.buffer).getUint16(28,true)).toBe(24);
 expect(decodeBmpImage(output).data).toEqual(data);
});

it("packs odd-width indexed rows bottom-up with independent row padding", () => {
 const data=Uint8Array.from([0,255,0,255,0,255].flatMap(v=>[v,v,v,255]));
 const image:RgbaImage={width:3,height:2,data,format:"png",space:"b-w",channels:1,depth:"uchar",density:72,hasAlpha:false};
 const output=encodeBmpImage(image),view=new DataView(output.buffer);
 expect(view.getUint16(28,true)).toBe(1);
 expect(Array.from(output.subarray(view.getUint32(10,true)))).toEqual([0xa0,0,0,0,0x40,0,0,0]);
 expect(decodeBmpImage(output).data).toEqual(data);
});
