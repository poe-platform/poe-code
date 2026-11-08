import { expect, it } from "vitest";
import { parseCosRangeValue } from "./range-parser.js";
import { readStoredItems } from "../content/stored-record.js";
import { dictGet, type PdfCosNode } from "../ast.js";

it("retains selected source arrays and nested arrays in caller backing", async () => {
  const input = new TextEncoder().encode("<< /Widths [" + "500 ".repeat(8192) + "] /W [7 [12 13] 20 30 90] /Other [1 2] >>");
  const bytes = new Uint8Array(4_000_000);
  let end = 0, largest = 0;
  const storage = {
    allocate(length: number) { const at = end; end += length; return at; },
    async read(at: number, length: number) { return bytes.subarray(at, at + length); },
    async write(at: number, chunk: Uint8Array) { largest = Math.max(largest, chunk.length); bytes.set(chunk, at); }
  };
  const source = { size: input.length, chunkBytes: 64, async read(at: number, n: number) { return input.subarray(at, at + n); } };
  const { value } = await parseCosRangeValue(source, 0, { arrayStorage: storage, storedArrayKeys: ["Widths", "W"] });
  if (value?.kind !== "dict") throw Error("dictionary expected");
  const widths = dictGet(value, "Widths"), w = dictGet(value, "W"), other = dictGet(value, "Other");
  if (widths?.kind !== "array" || w?.kind !== "array" || other?.kind !== "array") throw Error("arrays expected");
  expect(widths.items).toHaveLength(0);
  expect(widths.storedItems?.length).toBe(8192);
  let count = 0;
  for await (const item of readStoredItems<PdfCosNode>(widths.storedItems!)) { expect(item).toMatchObject({kind:"number",value:500}); count++; }
  expect(count).toBe(8192);
  const items = [];
  for await (const item of readStoredItems<PdfCosNode>(w.storedItems!)) items.push(item);
  expect(items[1]).toMatchObject({kind:"array",items:[],storedItems:{length:2,storage}});
  expect(other.items).toHaveLength(2);
  expect(largest).toBeLessThanOrEqual(4096);
});

it("decrypts backed array members without losing signature contents", async () => {
  const {cosArray, cosDict, cosName, cosNumber, cosString} = await import("../ast.js");
  const {encryptPdfBuffer,decryptPdfObjectStrings,decodePermissionsMask} = await import("./security.js");
  const {appendStoredRecord} = await import("../content/stored-record.js");
  const state = {filter:"Standard",version:2,revision:3,keyLengthBits:128,encryptMetadata:true,permissions:decodePermissionsMask(-4),fileKey:new Uint8Array(16).fill(7)};
  const data = new Uint8Array(32768); let end = 0;
  const storage = {allocate(n:number){const at=end;end+=n;return at;},async read(at:number,n:number){return data.subarray(at,at+n);},async write(at:number,bytes:Uint8Array){data.set(bytes,at);}};
  const ciphertext = encryptPdfBuffer(state, 4, 0, new TextEncoder().encode("retained"));
  const signature = cosDict({Type:cosName("Sig"),Contents:cosString("untouched")});
  const position = await appendStoredRecord(storage,cosArray([cosString(ciphertext),signature,cosNumber(99)]),-1);
  const value = await decryptPdfObjectStrings(state,4,0,{kind:"array",items:[],storedItems:{storage,position,length:1}});
  if(value.kind !== "array") throw Error("array expected");
  expect(value.items).toHaveLength(0);
  const items = [];
  for await(const node of readStoredItems<PdfCosNode>(value.storedItems!)) items.push(node);
  expect(items).toMatchObject([{kind:"array",items:[{kind:"string",bytes:new TextEncoder().encode("retained")}, {kind:"dict",entries:[{key:{decoded:"Type"},value:{decoded:"Sig"}},{key:{decoded:"Contents"},value:{bytes:new TextEncoder().encode("untouched")}}]}, {kind:"number",value:99}]}]);
});

it("propagates backing failures and cancellation while appending", async () => {
  const input = new TextEncoder().encode("[1 2 3]");
  const source = {size:input.length,chunkBytes:64,async read(at:number,n:number){return input.subarray(at,at+n);}};
  const failure = new Error("remote write failed");
  const storage = {allocate(){return 0;},async read(){return new Uint8Array();},async write(){throw failure;}};
  await expect(parseCosRangeValue(source,0,{arrayStorage:storage,storeRootArray:true})).rejects.toBe(failure);
  const controller = new AbortController();
  await expect(parseCosRangeValue(source,0,{arrayStorage:{...storage,async write(){controller.abort(failure);}},storeRootArray:true,signal:controller.signal})).rejects.toBe(failure);
});

it("does not discard repaired objects when backing reports a syntax-shaped error", async () => {
  const {scanCosRangeObjects} = await import("./range-repair.js");
  const {PdfError} = await import("../errors.js");
  const input = new TextEncoder().encode("1 0 obj [1 2] endobj");
  const source = {size:input.length,chunkBytes:64,async read(at:number,n:number){return input.subarray(at,at+n);}};
  const failure = new PdfError("E_PARSE","remote backing failure");
  const storage = {allocate(){return 0;},async read(){return new Uint8Array();},async write(){throw failure;}};
  const scan = scanCosRangeObjects(source as import("../source.js").PdfFileSource,{arrayStorage:storage,storeRootArray:true});
  await expect(scan.next()).rejects.toBe(failure);
});


it("backs graphics-state dash paths without changing unrelated D arrays", async () => {
  const input = new TextEncoder().encode("<< /Resources << /ExtGState << /Dashes << /D [[" + "2 3 ".repeat(2048) + "] 0] >> >> >> /BS << /D [9 8] >> /D [7 6] /Other << /Dashes << /D [5 4] >> >> >>");
  const data = new Uint8Array(4_000_000); let end = 0;
  const storage = { allocate(n: number) { const at = end; end += n; return at; },
    async read(at: number, n: number) { return data.subarray(at, at + n); },
    async write(at: number, bytes: Uint8Array) { expect(bytes.length).toBeLessThanOrEqual(4096); data.set(bytes, at); } };
  const source = { size: input.length, chunkBytes: 64, async read(at: number, n: number) { return input.subarray(at, at + n); } };
  const { value } = await parseCosRangeValue(source, 0, { containerStorage: storage, arrayStorage: storage, storedArrayPaths: [["ExtGState", "*", "D"]] });
  function get(node: PdfCosNode | undefined, key: string) { if (node?.kind !== "dict") throw Error("Expected dictionary"); return dictGet(node, key); }
  const dash = get(get(get(get(value, "Resources"), "ExtGState"), "Dashes"), "D");
  if (dash?.kind !== "array") throw Error("Expected dash array");
  expect(dash.items).toHaveLength(0); expect(dash.storedItems?.length).toBe(2);
  const pair = []; for await (const node of readStoredItems<PdfCosNode>(dash.storedItems!)) pair.push(node);
  expect(pair[0]).toMatchObject({ kind: "array", items: [], storedItems: { length: 4096 } });
  expect(get(get(value, "BS"), "D")).toMatchObject({ kind: "array", items: [{ value: 9 }, { value: 8 }] });
  expect(get(value, "D")).toMatchObject({ kind: "array", items: [{ value: 7 }, { value: 6 }] });
  expect(get(get(get(value, "Other"), "Dashes"), "D")).toMatchObject({ kind: "array", items: [{ value: 5 }, { value: 4 }] });
});


it("selectively backs source strings while preserving ordinary string consumers", async () => {
  const input = new TextEncoder().encode("<< /ActualText (" + "abc".repeat(8192) + ") /Title (ordinary) /Nested << /ActualText <4142> >> >>");
  const data = new Uint8Array(65536); let end = 0;
  const storage = { allocate(n: number) { const at = end; end += n; return at; },
    async read(at: number, n: number) { return data.subarray(at, at + n); },
    async write(at: number, bytes: Uint8Array) { expect(bytes.length).toBeLessThanOrEqual(4096); data.set(bytes, at); } };
  const source = { size: input.length, chunkBytes: 64, async read(at: number, n: number) { return input.subarray(at, at + n); } };
  const { value } = await parseCosRangeValue(source, 0, { stringStorage: storage, storedStringKeys: ["ActualText"] });
  if (value?.kind !== "dict") throw Error("Expected dictionary");
  const replacement = dictGet(value, "ActualText"), title = dictGet(value, "Title"), nested = dictGet(value, "Nested");
  expect(replacement).toMatchObject({ kind: "string", bytes: new Uint8Array(), storedBytes: { storage, byteLength: 24576 } });
  expect(title).toMatchObject({ kind: "string", bytes: new TextEncoder().encode("ordinary") });
  expect(nested?.kind === "dict" && dictGet(nested, "ActualText")).toMatchObject({ kind: "string", bytes: new Uint8Array(), storedBytes: { byteLength: 2 } });
  const { decodeStoredPdfString } = await import("../ast.js");
  let text = "";
  if (replacement?.kind !== "string" || !replacement.storedBytes) throw Error("Expected stored replacement");
  for await (const chunk of decodeStoredPdfString(replacement.storedBytes)) text += chunk;
  expect(text).toBe("abc".repeat(8192));
  const direct = await parseCosRangeValue(source, input.indexOf(40), { stringStorage: storage, storeRootString: true });
  expect(direct.value).toMatchObject({ kind: "string", bytes: new Uint8Array(), storedBytes: { byteLength: 24576 } });
  const buffered = await parseCosRangeValue(source, 0);
  expect(buffered.value?.kind === "dict" && dictGet(buffered.value, "ActualText")).toMatchObject({ kind: "string", bytes: new TextEncoder().encode(text) });
});


it("preserves source string backing failures through recovery and cancellation", async () => {
  const { scanCosRangeObjects } = await import("./range-repair.js");
  const { PdfError } = await import("../errors.js");
  const input = new TextEncoder().encode("1 0 obj << /ActualText (replacement) >> endobj");
  const source = { size: input.length, chunkBytes: 64, async read(at: number, n: number) { return input.subarray(at, at + n); } };
  const failure = new PdfError("E_PARSE", "external string write failed");
  const storage = { allocate() { return 0; }, async read() { return new Uint8Array(); }, async write() { throw failure; } };
  const scan = scanCosRangeObjects(source as import("../source.js").PdfFileSource, { stringStorage: storage, storedStringKeys: ["ActualText"] });
  await expect(scan.next()).rejects.toBe(failure);
  const controller = new AbortController();
  await expect(parseCosRangeValue(source, input.indexOf(40), { stringStorage: { ...storage, async write() { controller.abort(failure); } }, storeRootString: true, signal: controller.signal })).rejects.toBe(failure);
});

it("keeps deep source array parser frames in caller backing", async () => {
  const depth=512,input=new TextEncoder().encode("[".repeat(depth)+"7"+"]".repeat(depth));
  const bytes=new Uint8Array(4_000_000);let end=0;
  const storage={allocate(n:number){const at=end;end+=n;return at;},async read(at:number,n:number){return bytes.subarray(at,at+n);},async write(at:number,data:Uint8Array){bytes.set(data,at);}};
  const source={size:input.length,chunkBytes:64,async read(at:number,n:number){return input.subarray(at,at+n);}};
  const push=Array.prototype.push;let peak=0;
  Array.prototype.push=function<T>(this:T[],...values:T[]){const result=push.apply(this,values);peak=Math.max(peak,this.length);return result;};
  let value:PdfCosNode|undefined;
  try{({value}=await parseCosRangeValue(source,0,{arrayStorage:storage,storeRootArray:true,maxRecursionDepth:Infinity,containerStorage:storage}));expect(peak).toBeLessThanOrEqual(64);}
  finally{Array.prototype.push=push;}
  for(let i=0;i<depth;i++){
    if(value?.kind!=="array"||!value.storedItems)throw Error("Expected backed nested array");
    expect(value.items).toEqual([]);expect(value.storedItems.length).toBe(1);
    const step=await readStoredItems<PdfCosNode>(value.storedItems).next();
    value=step.done?undefined:step.value;
  }
  expect(value).toMatchObject({kind:"number",value:7});
});


it.each(["push","pop"] as const)("preserves caller parser-frame %s failures through recovery", async operation => {
  const {scanCosRangeObjects}=await import("./range-repair.js");
  const {PdfError}=await import("../errors.js");
  const input=new TextEncoder().encode("1 0 obj "+"[".repeat(40)+"7"+"]".repeat(40)+" endobj");
  const source={size:input.length,chunkBytes:64,async read(at:number,n:number){return input.subarray(at,at+n);}};
  const failure=new PdfError("E_PARSE","frame backing failed"),bytes=new Uint8Array(4096);let end=0;
  const storage={allocate(n:number){const at=end;end+=n;return at;},async read(at:number,n:number){if(operation==="pop")throw failure;return bytes.subarray(at,at+n);},async write(at:number,data:Uint8Array){if(operation==="push")throw failure;bytes.set(data,at);}};
  const scan=scanCosRangeObjects(source as import("../source.js").PdfFileSource,{containerStorage:storage});
  await expect(scan.next()).rejects.toBe(failure);
});

it("cancels deep parser-frame writes without taking backing ownership", async () => {
  const input=new TextEncoder().encode("[".repeat(512)+"1"+"]".repeat(512));
  const source={size:input.length,chunkBytes:64,async read(at:number,n:number){return input.subarray(at,at+n);}};
  const bytes=new Uint8Array(1_000_000);let end=0,writes=0;
  const storage={allocate(n:number){const at=end;end+=n;return at;},async read(at:number,n:number){return bytes.subarray(at,at+n);},async write(at:number,data:Uint8Array){writes++;bytes.set(data,at);}};
  const controller=new AbortController(),failure=new Error("cancel parser frames"),timer=setTimeout(()=>controller.abort(failure),0);
  try{await expect(parseCosRangeValue(source,0,{containerStorage:storage,arrayStorage:storage,storeRootArray:true,maxRecursionDepth:Infinity,signal:controller.signal})).rejects.toBe(failure);expect(writes).toBeGreaterThan(0);}
  finally{clearTimeout(timer);}
  const parsed=await parseCosRangeValue({size:3,chunkBytes:64,async read(){return new TextEncoder().encode("[1]");}},0,{containerStorage:storage});
  expect(parsed.value).toMatchObject({kind:"array",items:[{value:1}]});
});


it("restores partial dictionaries and path selection through backed frames", async () => {
  const input=new TextEncoder().encode("<< /Before 1 /Next ".repeat(40)+"<< /ExtGState << /Dash << /D [[2 3] 0] >> >> >>"+" /After 2 >>".repeat(40));
  const bytes=new Uint8Array(1_000_000);let end=0;
  const storage={allocate(n:number){const at=end;end+=n;return at;},async read(at:number,n:number){return bytes.subarray(at,at+n);},async write(at:number,data:Uint8Array){bytes.set(data,at);}};
  const source={size:input.length,chunkBytes:64,async read(at:number,n:number){return input.subarray(at,at+n);}};
  let {value}=await parseCosRangeValue(source,0,{arrayStorage:storage,containerStorage:storage,maxRecursionDepth:Infinity,storedArrayPaths:[["ExtGState","*","D"]]});
  for(let i=0;i<40;i++){
    if(value?.kind!=="dict")throw Error("Expected dictionary");
    expect(dictGet(value,"Before")).toMatchObject({value:1});expect(dictGet(value,"After")).toMatchObject({value:2});value=dictGet(value,"Next");
  }
  for(const key of ["ExtGState","Dash","D"]){if(value?.kind!=="dict")throw Error("Expected resource dictionary");value=dictGet(value,key);}
  expect(value).toMatchObject({kind:"array",items:[],storedItems:{length:2}});
});
