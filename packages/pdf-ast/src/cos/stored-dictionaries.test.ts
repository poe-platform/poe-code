import { expect, it } from "vitest";
import { cosDict, cosName, cosString, dictGet, type PdfCosDict } from "../ast.js";
import { readPdfDictionaryEntries, readPdfDictionaryValue } from "../content/stored-dictionary.js";
import { appendStoredRecord } from "../content/stored-record.js";
import { parseCosRangeValue } from "./range-parser.js";
import { PdfError } from "../errors.js";
import { decryptPdfObjectStrings, encryptPdfBuffer, decodePermissionsMask } from "./security.js";

function backing() {
  const bytes = new Uint8Array(2_000_000), borrowed = new Uint8Array(4096);
  let end = 0;
  return {
    allocate(length: number) { const position = end; end += length; return position; },
    async read(position: number, length: number) { borrowed.set(bytes.subarray(position, position + length)); return borrowed.subarray(0, length); },
    async write(position: number, chunk: Uint8Array) { expect(chunk.length).toBeLessThanOrEqual(4096); bytes.set(chunk, position); }
  };
}
function source(text: string) {
  const bytes = new TextEncoder().encode(text);
  return {size: bytes.length, chunkBytes: 64, async read(position: number, length: number) { return bytes.subarray(position, position + length); }};
}

it("retains ordered dictionary entries, duplicates and nested array descriptors", async () => {
  const storage = backing();
  const input = source("<< /Font << " + "/Unused 731 ".repeat(512) + "/Used << /Widths [1 2] >> /Unused 732 >> /Other << /Key 9 >> >>");
  const {value} = await parseCosRangeValue(input, 0, {dictionaryStorage: storage, storedDictionaryKeys: ["Font"], arrayStorage: storage, storedArrayKeys: ["Widths"]});
  if (value?.kind !== "dict") throw Error("dictionary expected");
  const fonts = dictGet(value, "Font");
  if (fonts?.kind !== "dict") throw Error("font dictionary expected");
  expect(fonts.entries).toHaveLength(0);
  expect(fonts.storedEntries?.length).toBe(514);
  let count = 0;
  for await (const entry of readPdfDictionaryEntries(fonts)) {
    if (count < 512) expect(entry).toMatchObject({key: {decoded: "Unused"}, value: {kind: "number", value: 731}});
    count++;
  }
  expect(count).toBe(514);
  expect(await readPdfDictionaryValue(fonts, "Unused")).toMatchObject({kind: "number", value: 732});
  expect(await readPdfDictionaryValue(fonts, "Used")).toMatchObject({kind: "dict", entries: [{key: {decoded: "Widths"}, value: {items: [], storedItems: {length: 2}}}]});
  expect(await readPdfDictionaryValue(fonts, "Missing")).toBeUndefined();
  expect(dictGet(value, "Other")).toMatchObject({entries: [{key: {decoded: "Key"}, value: {value: 9}}]});
  expect(() => dictGet(fonts, "Unused")).toThrow("asynchronous");
});

it("retains indirect/root dictionaries and deeply suspended selected dictionaries", async () => {
  const storage = backing();
  const {value} = await parseCosRangeValue(source("<< /A 1 /A 2 >>"), 0, {dictionaryStorage: storage, storeRootDictionary: true});
  expect(value).toMatchObject({kind: "dict", entries: [], storedEntries: {length: 2}});
  expect(await readPdfDictionaryValue(value as PdfCosDict, "A")).toMatchObject({value: 2});
  const deep = await parseCosRangeValue(source("<< /Font ".repeat(64) + "<< /A 3 >>" + " >>".repeat(64)), 0,
    {dictionaryStorage: storage, storedDictionaryKeys: ["Font"], containerStorage: storage});
  let current = deep.value;
  for (let i = 0; i < 64; i++) {
    if (current?.kind !== "dict") throw Error("dictionary expected");
    current = await readPdfDictionaryValue(current, "Font");
  }
  expect(current?.kind === "dict" && await readPdfDictionaryValue(current, "A")).toMatchObject({value: 3});
});

it("decrypts backed dictionary values while preserving signature contents and duplicate order", async () => {
  const storage = backing();
  const state = {filter: "Standard", version: 2, revision: 3, keyLengthBits: 128, encryptMetadata: true, permissions: decodePermissionsMask(-4), fileKey: new Uint8Array(16).fill(7)};
  const encrypted = cosString(encryptPdfBuffer(state, 4, 0, new TextEncoder().encode("retained")));
  const values = [{key: cosName("Contents"), value: cosString("untouched")}, {key: cosName("Type"), value: cosName("Sig")},
    {key: cosName("Title"), value: encrypted}, {key: cosName("Child"), value: cosDict({Title: encrypted})}];
  let position = -1, tail = -1;
  for (const value of values) { tail = await appendStoredRecord(storage, value, tail); if (position === -1) position = tail; }
  const output = await decryptPdfObjectStrings(state, 4, 0, {kind: "dict", entries: [], storedEntries: {storage, position, length: values.length}});
  if (output.kind !== "dict") throw Error("dictionary expected");
  expect(output.entries).toHaveLength(0);
  expect(await readPdfDictionaryValue(output, "Contents")).toMatchObject({bytes: new TextEncoder().encode("untouched")});
  expect(await readPdfDictionaryValue(output, "Title")).toMatchObject({bytes: new TextEncoder().encode("retained")});
  expect(await readPdfDictionaryValue(output, "Child")).toMatchObject({entries: [{value: {bytes: new TextEncoder().encode("retained")}}]});
});

it("preserves dictionary backing failures and cancellation through repair", async () => {
  const {scanCosRangeObjects} = await import("./range-repair.js");
  const failure = new PdfError("E_PARSE", "dictionary backing unavailable");
  const storage = {...backing(), async write() { throw failure; }};
  const scan = scanCosRangeObjects(source("1 0 obj << /Font << /F 1 >> >> endobj") as import("../source.js").PdfFileSource,
    {dictionaryStorage: storage, storedDictionaryKeys: ["Font"]});
  await expect(scan.next()).rejects.toBe(failure);
  const controller = new AbortController();
  await expect(parseCosRangeValue(source("<< /A 1 >>"), 0, {dictionaryStorage: {...backing(), async write() { controller.abort(failure); }}, storeRootDictionary: true, signal: controller.signal})).rejects.toBe(failure);
  const good = backing();
  const {value} = await parseCosRangeValue(source("<< /A 1 >>"), 0, {dictionaryStorage: good, storeRootDictionary: true});
  await expect(readPdfDictionaryValue(value as PdfCosDict, "A", controller.signal)).rejects.toBe(failure);
  const dict = value as PdfCosDict;
  const broken = {...dict, storedEntries: {...dict.storedEntries!, storage: {...good, async read() { throw failure; }}}};
  await expect(readPdfDictionaryValue(broken, "A")).rejects.toBe(failure);
});

it("merges appearance resources with stable insertion order, last destination values and first source values", async () => {
  const {createMemoryFileSystem} = await import("@poe-code/safe-fs");
  const {mergePdfResourceDictionaries} = await import("../content/stored-dictionary.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const storage = backing();
  const options = {dictionaryStorage: storage, storeRootDictionary: true};
  const destination = (await parseCosRangeValue(source("<< /A 1 /B 2 /A 3 >>"), 0, options)).value as PdfCosDict;
  const appearance = (await parseCosRangeValue(source("<< /A 9 /C 4 /C 5 >>"), 0, options)).value as PdfCosDict;
  const merged = await mergePdfResourceDictionaries(destination, appearance, {fs, directory: "/scratch"});
  const values = [];
  for await (const entry of readPdfDictionaryEntries(merged)) values.push([entry.key.decoded, entry.value.kind === "number" ? entry.value.value : null]);
  expect(values).toEqual([["A", 3], ["B", 2], ["C", 4]]);
  expect(destination.storedEntries?.length).toBe(3);
  expect(await readPdfDictionaryValue(appearance, "C")).toMatchObject({value: 5});
  expect(await fs.readdir("/scratch")).toEqual([]);
  const failure = new PdfError("E_PARSE", "merge backing unavailable");
  const broken = {...destination, storedEntries: {...destination.storedEntries!, storage: {...storage, async write() {throw failure;}}}};
  await expect(mergePdfResourceDictionaries(broken, undefined, {fs, directory: "/scratch"})).rejects.toBe(failure);
  expect(await fs.readdir("/scratch")).toEqual([]);
});


it.each([false, true])("keeps resource names opaque to dictionary selectors (indirect map=%s)", async root => {
  const storage = backing();
  const map = "<< /Font << /Subtype /Type3 /Resources << /Font << /Font << /Subtype /Type1 >> >> >> >> >>";
  const {value} = await parseCosRangeValue(source(root ? map : `<< /Font ${map} >>`), 0,
    {dictionaryStorage: storage, storedDictionaryKeys: ["Font"], storeRootDictionary: root});
  if (value?.kind !== "dict") throw Error("dictionary expected");
  const fonts = root ? value : dictGet(value, "Font");
  if (fonts?.kind !== "dict") throw Error("font map expected");
  expect(fonts.storedEntries?.length).toBe(1);
  const font = await readPdfDictionaryValue(fonts, "Font");
  if (font?.kind !== "dict") throw Error("font expected");
  expect(font.storedEntries).toBeUndefined();
  expect(dictGet(font, "Subtype")).toMatchObject({decoded: "Type3"});
  const resources = dictGet(font, "Resources");
  if (resources?.kind !== "dict") throw Error("resources expected");
  const nested = dictGet(resources, "Font");
  if (nested?.kind !== "dict") throw Error("nested font map expected");
  expect(nested.storedEntries?.length).toBe(1);
  const child = await readPdfDictionaryValue(nested, "Font");
  expect(child).toMatchObject({entries: [{key: {decoded: "Subtype"}, value: {decoded: "Type1"}}]});
  expect(child?.kind === "dict" && child.storedEntries).toBeUndefined();
});


it.each([false,true])("backs resource-map paths without backing same-named definitions (indirect=%s)", async indirect => {
  const storage = backing();
  const body = "<< /ExtGState << /ExtGState << /ca 0.5 >> >> /Pattern << /P << /Shading << /ShadingType 2 >> /ExtGState << /ca 1 >> >> >> >>";
  const {value} = await parseCosRangeValue(source(indirect ? body : `<< /Resources ${body} >>`),0,
    {dictionaryStorage:storage,storedDictionaryPaths:[["Resources","*"]],...(indirect?{arrayPathPrefix:["Resources"]}:{})});
  const resources = indirect ? value : value?.kind === "dict" ? dictGet(value,"Resources") : undefined;
  if(resources?.kind !== "dict")throw Error("resources expected");
  const states=dictGet(resources,"ExtGState"),patterns=dictGet(resources,"Pattern");
  expect(states).toMatchObject({entries:[],storedEntries:{length:1}});
  expect(patterns).toMatchObject({entries:[],storedEntries:{length:1}});
  const state=await readPdfDictionaryValue(states as PdfCosDict,"ExtGState");
  expect(state?.kind === "dict" && dictGet(state,"ca")).toMatchObject({value:0.5});
  const pattern=await readPdfDictionaryValue(patterns as PdfCosDict,"P");
  expect(pattern?.kind === "dict" && dictGet(pattern,"Shading")).toMatchObject({entries:[{key:{decoded:"ShadingType"}}]});
  expect(pattern?.kind === "dict" && dictGet(pattern,"ExtGState")).toMatchObject({entries:[{key:{decoded:"ca"}}]});
});

it("looks up only the last matching record without materializing unused or shadowed values", async () => {
  const storage = backing();
  const large = {kind: "array" as const, items: Array.from({length: 4096}, () => ({kind: "number" as const, value: 739}))};
  let position = -1, previous = -1;
  for (const [name, value] of [["Unused", large], ["Selected", large], ["Selected", {kind: "number", value: 42}]] as const) {
    const next = await appendStoredRecord(storage, {key: cosName(name), value}, previous);
    if (position === -1) position = next;
    previous = next;
  }
  const dict: PdfCosDict = {kind: "dict", entries: [], storedEntries: {storage,position,length:3}};
  const push = Array.prototype.push;
  Array.prototype.push = function (...values) {
    if (this.length >= 64 && values.some(value => value?.kind === "number" && value.value === 739)) throw new Error("materialized unused resource value");
    return push.apply(this, values);
  };
  try {
    expect(await readPdfDictionaryValue(dict, "Selected")).toEqual({kind: "number", value: 42});
    expect(await readPdfDictionaryValue(dict, "Missing")).toBeUndefined();
  } finally { Array.prototype.push = push; }
});

it("defers unused source resource values before building their arrays and dictionaries", async () => {
  const storage = backing();
  const text = "<< /Font << /Unused << /Large [" + "743 ".repeat(256) + "] " + "/UnusedLeaf 744 ".repeat(256) + "/Text (" + "payload ".repeat(1024) + ") >> /F << /Subtype /Type1 /Widths [10 20] /Extra [1 << /K (ok) >>] >> >> >>";
  const push = Array.prototype.push;
  Array.prototype.push = function (...values) {
    if (this.length >= 64 && values.some(value => value?.kind === "number" && value.value === 743 || value?.key?.decoded === "UnusedLeaf")) throw new Error("resident unused source value");
    return push.apply(this, values);
  };
  try {
    const {value} = await parseCosRangeValue(source(text),0,{dictionaryStorage:storage,arrayStorage:storage,stringStorage:storage,containerStorage:storage,storedDictionaryKeys:["Font"],storedArrayKeys:["Widths"],deferDictionaryValues:true});
    if (value?.kind !== "dict") throw new Error("dictionary expected");
    const map = dictGet(value,"Font") as PdfCosDict;
    const font = await readPdfDictionaryValue(map,"F");
    if(font?.kind !== "dict") throw new Error("font expected");
    expect(dictGet(font,"Subtype")).toMatchObject({decoded:"Type1"});
    expect(dictGet(font,"Widths")).toMatchObject({items:[],storedItems:{length:2}});
    expect(dictGet(font,"Extra")).toMatchObject({items:[{value:1},{entries:[{key:{decoded:"K"},value:{bytes:new TextEncoder().encode("ok")}}]}]});
    expect(await readPdfDictionaryValue(map,"Missing")).toBeUndefined();
  } finally {Array.prototype.push = push;}
});

it("decrypts deferred resource definitions without expanding unused containers or signature contents", async () => {
  const storage=backing();
  const {PdfDocument}=await import("../document.js");
  const seed=PdfDocument.create();seed.addPage();
  const state=PdfDocument.load(seed.save({encrypt:{userPassword:"pw",revision:3}}),{password:"pw"}).cos.encryption!;
  const cipher=encryptPdfBuffer(state,4,0,new TextEncoder().encode("retained"));
  const hex=Array.from(cipher,byte=>byte.toString(16).padStart(2,"0")).join("");
  const text="<< /Font << /F << /Title <"+hex+"> /Child [<"+hex+">] >> /Unused << /Large ["+"743 ".repeat(256)+"] >> /Signature << /Type /Sig /Contents (untouched) >> >> >>";
  const options={dictionaryStorage:storage,arrayStorage:storage,stringStorage:storage,containerStorage:storage,storedDictionaryKeys:["Font"],deferDictionaryValues:true};
  const parsed=await parseCosRangeValue(source(text),0,options);
  const push=Array.prototype.push;
  Array.prototype.push=function(...values){if(this.length>=64&&values.some(value=>value?.kind==="number"&&value.value===743))throw new Error("decryption expanded unused container");return push.apply(this,values);};
  let output;
  try{output=await decryptPdfObjectStrings(state,4,0,parsed.value!);}finally{Array.prototype.push=push;}
  if(output.kind!=="dict")throw new Error("dictionary expected");
  const map=dictGet(output,"Font") as PdfCosDict;
  const font=await readPdfDictionaryValue(map,"F") as PdfCosDict;
  expect(dictGet(font,"Title")).toMatchObject({bytes:new TextEncoder().encode("retained")});
  expect(dictGet(font,"Child")).toMatchObject({items:[{bytes:new TextEncoder().encode("retained")}]});
  const signature=await readPdfDictionaryValue(map,"Signature") as PdfCosDict;
  expect(dictGet(signature,"Contents")).toMatchObject({bytes:new TextEncoder().encode("untouched")});
});

it("requires consistent caller backing for deferred resource values",async()=>{
  const storage=backing();
  await expect(parseCosRangeValue(source("<<>>"),0,{dictionaryStorage:storage,deferDictionaryValues:true})).rejects.toThrow("shared caller backing");
});

it.each(["failure","cancel","short"])("preserves deferred string read %s",async mode=>{
  const storage=backing(),failure=new Error("deferred read failed"),controller=new AbortController();
  const {value}=await parseCosRangeValue(source("<< /Font << /F (selected) >> >>"),0,{dictionaryStorage:storage,arrayStorage:storage,stringStorage:storage,containerStorage:storage,storedDictionaryKeys:["Font"],deferDictionaryValues:true});
  if(value?.kind!=="dict")throw new Error("dictionary expected");
  const map=dictGet(value,"Font") as PdfCosDict;
  const read=storage.read;
  storage.read=async (position,length)=>{
    if(length!==8)return read(position,length);
    if(mode==="failure")throw failure;
    if(mode==="cancel")controller.abort(failure);
    const bytes=await read(position,length);
    return mode==="short"?bytes.subarray(1):bytes;
  };
  const result=readPdfDictionaryValue(map,"F",controller.signal);
  if(mode==="short")await expect(result).rejects.toThrow("Incomplete deferred resource string");
  else await expect(result).rejects.toBe(failure);
});

it("lets consumers inspect individual fields of a deferred definition",async()=>{
  const storage=backing();
  const {value}=await parseCosRangeValue(source("<< /Font << /F << /Used 9 /Unused ["+"749 ".repeat(256)+"] >> >> >>"),0,{dictionaryStorage:storage,arrayStorage:storage,stringStorage:storage,containerStorage:storage,storedDictionaryKeys:["Font"],deferDictionaryValues:true});
  if(value?.kind!=="dict")throw new Error("dictionary expected");
  const map=dictGet(value,"Font") as PdfCosDict;
  const push=Array.prototype.push;
  Array.prototype.push=function(...values){if(this.length>=64&&values.some(value=>value?.kind==="number"&&value.value===749))throw new Error("unused deferred field expanded");return push.apply(this,values);};
  try{
    const definition=await readPdfDictionaryValue(map,"F",undefined,{preserveDeferred:true});
    expect(definition).toMatchObject({kind:"dict",deferred:true,entries:[],storedEntries:{length:2}});
    expect(await readPdfDictionaryValue(definition as PdfCosDict,"Used")).toMatchObject({value:9});
  }finally{Array.prototype.push=push;}
});
