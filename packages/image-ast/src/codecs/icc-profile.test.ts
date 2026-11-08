import {expect, it} from "vitest";
import {encodeJpegImage, readJpegMetadata} from "./jpeg.js";
import {readJpegMetadataFromSource} from "./jpeg-input-storage.js";
import {applyJpegMetadata, type JpegMetadataState} from "./jpeg-metadata.js";

it("preserves multipart JPEG profiles in buffered and retained metadata", async () => {
  const icc = Uint8Array.from({length: 150000}, (_, i) => i % 251);
  const bytes = encodeJpegImage({width:1,height:1,data:Uint8Array.of(255,0,0,255),format:"jpeg",space:"srgb",channels:3,depth:"uchar",density:72,hasAlpha:false,icc});
  expect(readJpegMetadata(bytes).icc).toEqual(icc);
  const source = {size:bytes.length,async read(position:number,length:number) {return bytes.slice(position,position+length);}};
  expect((await readJpegMetadataFromSource(source,new AbortController().signal)).icc).toEqual(icc);
});

it("assembles out-of-order JPEG ICC segments and rejects incomplete profiles", () => {
  const state: JpegMetadataState = {width:1,height:1,channels:3,isProgressive:false,density:72,orientation:undefined};
  const segment = (index:number) => Uint8Array.from([...new TextEncoder().encode("ICC_PROFILE\0"),index,2,index]);
  applyJpegMetadata(state,0xe2,segment(2));
  expect(() => applyJpegMetadata(state,0xda,new Uint8Array())).toThrow("Incomplete JPEG ICC sequence");
  applyJpegMetadata(state,0xe2,segment(1));
  expect(state.icc).toEqual(Uint8Array.of(1,2));
  expect(() => applyJpegMetadata(state,0xe2,segment(1))).toThrow("Invalid JPEG ICC sequence");
});
