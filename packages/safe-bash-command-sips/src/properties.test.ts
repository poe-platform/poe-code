import {expect,it} from "vitest";
import {readProperties,readPropertiesFromSource,writeProperties} from "./properties.js";
import type {ImageByteSource} from "@poe-code/image-ast/portable";

for(const format of ["png","jpeg"] as const)it(`reads ${format} properties through bounded ranges`,async()=>{
 const original=new Uint8Array(format==="png"?45:6);if(format==="png")new DataView(original.buffer).setUint32(8,13);else original.set([255,216,255,217]);
 const properties=new Map<string,string|null>([["description","x".repeat(64000)],["dpiWidth",null]]),bytes=writeProperties(original,format,properties);let maximum=0,total=0;
 const source:ImageByteSource={size:bytes.length,async read(position,length){maximum=Math.max(maximum,length);total+=length;return bytes.slice(position,position+length);}};
 expect(await readPropertiesFromSource(source,format,new AbortController().signal)).toEqual(properties);
 expect(readProperties(bytes,format)).toEqual(properties);expect(maximum).toBeLessThanOrEqual(16384);expect(total).toBeLessThan(bytes.length);
});

it("skips large unrelated PNG payloads without reading them",async()=>{
 const offset=8+12+10_000_000,properties=new Map([["description","remote"]]);
 const small=writeProperties(new Uint8Array(33),"png",properties).subarray(33),header=new Uint8Array(8);new DataView(header.buffer).setUint32(0,10_000_000);header.set(new TextEncoder().encode("IDAT"),4);
 let total=0;const source:ImageByteSource={size:offset+small.length,async read(position,length){total+=length;if(position===8)return header.slice(0,length);if(position===12)return header.slice(4,4+length);if(position>=offset)return small.slice(position-offset,position-offset+length);throw new Error("payload read");}};
 expect(await readPropertiesFromSource(source,"png",new AbortController().signal)).toEqual(properties);expect(total).toBeLessThan(100);
});

it("observes cancellation and malformed range reads",async()=>{
 const controller=new AbortController(),reason=new Error("cancel"),source:ImageByteSource={size:100,async read(){controller.abort(reason);return new Uint8Array(4);}};
 await expect(readPropertiesFromSource(source,"png",controller.signal)).rejects.toBe(reason);
 await expect(readPropertiesFromSource({size:100,async read(){return new Uint8Array();}},"png",new AbortController().signal)).rejects.toThrow("Truncated");
});

it("rejects an oversized namespaced payload before reading its body",async()=>{
 const key=new TextEncoder().encode("safe-bash-sips\0\0\0\0\0"),header=new Uint8Array(8);new DataView(header.buffer).setUint32(0,key.length+65501);header.set(new TextEncoder().encode("iTXt"),4);
 const source:ImageByteSource={size:8+12+key.length+65501,async read(position,length){if(position===8)return header.slice(0,length);if(position===12)return header.slice(4);if(position===16&&length===key.length)return key;throw new Error("payload was read");}};
 await expect(readPropertiesFromSource(source,"png",new AbortController().signal)).rejects.toThrow("sips metadata byte limit exceeded");
});

it("rejects a truncated container before requesting missing bytes",async()=>{
 const header=new Uint8Array(4);new DataView(header.buffer).setUint32(0,100);
 await expect(readPropertiesFromSource({size:20,async read(position,length){expect([position,length]).toEqual([8,4]);return header;}},"png",new AbortController().signal)).rejects.toThrow("Invalid PNG metadata chunk");
});
