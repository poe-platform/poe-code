import {expect,it} from "vitest";
import type {PdfPixelStorage} from "../ast.js";
import {CosByteLexer} from "../cos/lexer.js";
import {parseCharacterCMap,parseToUnicodeCMap} from "./cmap.js";
import {parseStoredCMap} from "./stored-cmap.js";

function backing(){
 const scratch=new Uint8Array(512);let bytes=new Uint8Array(1024),end=0,maxRead=0,maxWrite=0;
 const storage:PdfPixelStorage={
  allocate(length){const at=end;end+=length;if(end>bytes.length){const next=new Uint8Array(Math.max(end,bytes.length*2));next.set(bytes);bytes=next;}return at;},
  async read(at,length){if(at<0||at+length>end)throw Error('bad read');maxRead=Math.max(maxRead,length);scratch.set(bytes.subarray(at,at+length));return scratch.subarray(0,length);},
  async write(at,value){if(at<0||at+value.length>end)throw Error('bad write');maxWrite=Math.max(maxWrite,value.length);bytes.set(value,at);},
 };
 return {storage,stats:()=>({maxRead,maxWrite,end})};
}

async function parse(source:string,unicode=false){const bytes=new TextEncoder().encode(source),lexer=new CosByteLexer(bytes),store=backing();return {map:await parseStoredCMap(()=>Promise.resolve(lexer.nextToken()),store.storage,{unicode}),store,bytes};}

it('preserves point/range overrides, arrays, numeric and byte-string increments',async()=>{
 const source=`begincodespacerange <0000> <ffff> endcodespacerange
 beginbfrange <0000> <03ff> <00fe> <0400> <0600> <ff> <0700> <0705> <> <0800> <0804> [<0041> 66 <0043>] endbfrange
 begincidrange <0900> <0904> 9007199254740992 <0910> <0914> -9007199254740994 endcidrange
 beginbfchar <0001> <1234> <0801> <005a> endbfchar`;
 const {map,bytes}=await parse(source),native=parseCharacterCMap(bytes);
 for(let code=0;code<0x920;code++)expect(await map.lookup(code),String(code)).toEqual(native.lookup(code));
 for(const bytes of [new Uint8Array([0,1]),new Uint8Array([1]),new Uint8Array([0xff,0xff])])expect(await map.readCharCode(bytes,0)).toEqual((()=>{const result={charcode:0,length:0};native.readCharCode({charCodeAt:(i:number)=>bytes[i]??NaN},0,result);return result;})());
});
it('keeps large ranges in fixed-size backing records and validates final Unicode overrides',async()=>{
 const {map,store}=await parse('beginbfrange <00000000> <000fffff> <0000> endbfrange');
 expect(await map.lookup(0xfffff)).toBe(String.fromCharCode(4095,255));
 expect(store.stats().end).toBeLessThan(10000);expect(store.stats().maxRead).toBeLessThanOrEqual(512);expect(store.stats().maxWrite).toBeLessThanOrEqual(512);
 const source='beginbfchar <01> 99999999 <01> <0041> endbfchar';
 const result=await parse(source,true);expect(await result.map.lookup(1)).toBe(parseToUnicodeCMap(result.bytes).map.get(1));
 await expect(parse('beginbfchar <01> 99999999 endbfchar',true)).rejects.toThrow();
});
it('streams destination arrays and preserves rejected-range recovery',async()=>{
 const source='beginbfrange <00> <ffffffff> <0000> <01> <03> [<0041> 66 <0043>] endbfrange';
 const {map,bytes}=await parse(source,true),native=parseToUnicodeCMap(bytes);
 for(let code=0;code<5;code++)expect(await map.lookup(code)).toEqual(native.map.get(code));
});
it('propagates backing failures and cancellation',async()=>{
 const error=new Error('backing failed'),store=backing(),lexer=new CosByteLexer(new TextEncoder().encode('beginbfchar <01> <0041> endbfchar'));
 store.storage.write=async()=>{throw error;};await expect(parseStoredCMap(()=>Promise.resolve(lexer.nextToken()),store.storage)).rejects.toBe(error);
 const controller=new AbortController();controller.abort(error);await expect(parseStoredCMap(()=>Promise.resolve(undefined),backing().storage,{signal:controller.signal})).rejects.toBe(error);
});

it('streams thousands of array destinations with fixed parser admission',async()=>{
 const source='beginbfrange <0000> <07ff> ['+'<0041> '.repeat(2048)+'] endbfrange';
 const bytes=new TextEncoder().encode(source),lexer=new CosByteLexer(bytes),store=backing(),admissions:number[]=[];
 const map=await parseStoredCMap(()=>Promise.resolve(lexer.nextToken()),store.storage,{unicode:true,maxWorkingBytes:8192,onAllocation:bytes=>admissions.push(bytes)});
 expect(await map.lookup(0)).toBe('A');expect(await map.lookup(2047)).toBe('A');expect(await map.lookup(2048)).toBeUndefined();expect(admissions).toEqual([8192]);expect(store.stats().maxRead).toBeLessThanOrEqual(512);
});
it('admits parser scratch before touching caller storage',async()=>{
 let allocated=false;const storage=backing().storage;storage.allocate=()=>{allocated=true;return 0;};
 await expect(parseStoredCMap(()=>Promise.resolve(undefined),storage,{maxWorkingBytes:1})).rejects.toMatchObject({code:'E_LIMIT'});expect(allocated).toBe(false);
});
