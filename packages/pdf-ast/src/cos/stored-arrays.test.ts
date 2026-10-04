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
