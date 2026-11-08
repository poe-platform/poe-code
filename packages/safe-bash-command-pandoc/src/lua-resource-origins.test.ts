import {expect,it,vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert,convertToOutput} from "./engine.js";
import {createLuaFilterCapability} from "./lua-filters.js";
import {ExecutionContext} from "./execution.js";
import type {ConversionOptions, ResourceFileSystem} from "./types.js";
const encode=(text:string)=>new TextEncoder().encode(text);
const segment=(marker:number,data:number[])=>[255,marker,(data.length+2)>>>8,(data.length+2)&255,...data];
const picture=new Uint8Array([255,216,...segment(219,[0,...Array<number>(64).fill(1)]),...segment(192,[8,0,1,0,1,1,1,0x11,0]),...segment(196,[0,1,...Array<number>(15).fill(0),0,16,1,...Array<number>(15).fill(0),0]),...segment(218,[1,1,0,0,63,0]),0x3f,255,217]);
const image=(url:string)=>({t:"Image",c:[["",[],[]],[],[url,""]]});
function resources(){
  const readStream=vi.fn(async function*(path:string){if(!["/doc/a.jpg","/doc/b.jpg","/cwd/a.jpg","/cwd/b.jpg"].includes(path))throw new Error("Unexpected path");yield picture;});
  const fs:ResourceFileSystem={readStream,async mkdir(){},async writeFile(){},async lstat(path){return {type:path.endsWith(".jpg")?"file":"directory"};}};
  return {fs,readStream};
}
for(const to of ["rtf","odt"])it.each([
  "function Image(el) return el end",
  "local n=0; function Image(el) n=n+1; if n==2 then el.src='a.jpg' end; return el end",
  "function Para(el) return pandoc.Para({el.content[2],el.content[1]}) end",
  "function Image(el) el.title='changed'; return el end"
])("retains Lua image origins without collecting the document ("+to+"): %s",async source=>{
  const input={base:"/doc",source:"source.json",bytes:encode(JSON.stringify({"pandoc-api-version":[1,23,1,2],meta:{},blocks:[{t:"Para",c:[image("a.jpg"),image("b.jpg")]}]}))};
  const options={from:"json",to,lossy:true,filters:[{kind:"lua" as const,path:"/filter.lua"}]};
  const make=()=>createLuaFilterCapability({readStream:async function*(){yield encode(source);}});
  const expectedHost=resources(),expected=await convert([input],options,{filters:make(),resourceFiles:expectedHost.fs,resourceCwd:"/cwd"}).catch(error=>error);
  const host=resources(),fs=new MemoryFileSystem(),filters=make();
  vi.spyOn(filters,"apply").mockRejectedValue(new Error("Resident Lua forbidden"));
  const output:Uint8Array[]=[];
  const actual=await convertToOutput([input],options,{filters,resourceFiles:host.fs,resourceCwd:"/cwd",workingFiles:{fs,directory:"/",cacheBytes:16384},output:{async write(bytes){output.push(bytes.slice());},async close(){},async abort(){}}}).catch(error=>error);
  if(expected instanceof Error)expect(actual).toMatchObject({code:(expected as Error & {code:string}).code,message:expected.message});
  else {expect(actual).not.toBeInstanceOf(Error);const bytes=Uint8Array.from(output.flatMap(chunk=>[...chunk]));expect(expected).toMatchObject(to==="rtf"?{text:new TextDecoder().decode(bytes)}:{bytes});}
  expect(host.readStream.mock.calls.map(call=>call[0])).toEqual(expectedHost.readStream.mock.calls.map(call=>call[0]));
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["source","cancel","sink"])("retires Lua origin backing on %s failure",async mode=>{
  const fs=new MemoryFileSystem(),host=resources(),controller=new AbortController();
  const original=host.readStream.getMockImplementation()!;
  host.readStream.mockImplementation(async function*(path){for await(const chunk of original(path)){if(mode==="cancel")controller.abort();yield chunk;if(mode==="source")throw new Error("Resource failed");}});
  const filters=createLuaFilterCapability({readStream:async function*(){yield encode("function Image(el) return el end");}}),close=vi.fn(async()=>{});
  const input={base:"/doc",bytes:encode(JSON.stringify({"pandoc-api-version":[1,23,1,2],meta:{},blocks:[{t:"Para",c:[image("a.jpg")]}]}))};
  await expect(convertToOutput([input],{from:"json",to:"rtf",metadata:{title:{t:"MetaString",c:"typed"}},filters:[{kind:"lua",path:"/filter.lua"}]},{filters,signal:controller.signal,resourceFiles:host.fs,workingFiles:{fs,directory:"/",cacheBytes:16384},output:{async write(){if(mode==="sink")throw new Error("Sink failed");},close,async abort(){}}})).rejects.toMatchObject({code:mode==="cancel"?"E_CANCELLED":"E_IO"});
  expect(close).not.toHaveBeenCalled();expect(await fs.readdir("/")).toEqual([]);
});

it("deduplicates self-contained pictures across inherited and newly created origins",async()=>{
  const url="data:image/jpeg;base64,"+btoa(String.fromCharCode(...picture));
  const input={base:"/doc",bytes:encode(JSON.stringify({"pandoc-api-version":[1,23,1,2],meta:{},blocks:[{t:"Para",c:[image(url),image("b.jpg")]}]}))};
  const make=()=>createLuaFilterCapability({readStream:async function*(){yield encode("local n=0; function Image(el) n=n+1; if n==2 then el.src='"+url+"' end; return el end");}});
  const options={from:"json",to:"odt",filters:[{kind:"lua" as const,path:"/filter.lua"}]};
  const expected=await convert([input],options,{filters:make(),resourceFiles:resources().fs});
  if(expected.kind!=="binary")throw new Error("Expected ODT bytes");
  const fs=new MemoryFileSystem(),output:Uint8Array[]=[],filters=make();vi.spyOn(filters,"apply").mockRejectedValue(new Error("Resident Lua forbidden"));
  await convertToOutput([input],options,{filters,resourceFiles:resources().fs,workingFiles:{fs,directory:"/",cacheBytes:16384},output:{async write(bytes){output.push(bytes.slice());},async close(){},async abort(){}}});
  const bytes=Uint8Array.from(output.flatMap(chunk=>[...chunk]));
  expect(bytes.length).toBe(expected.bytes.length);expect(bytes).toEqual(expected.bytes);expect(await fs.readdir("/")).toEqual([]);
});

for (const to of ["rtf", "odt"]) it.each([{lua: false, shared: false}, {lua: true, shared: false}, {lua: false, shared: true}])("retains typed metadata image authority for "+to+": %j", async ({lua, shared}) => {
  const inline = (url: string) => ({t: "MetaInlines", c: [image(url)]});
  const meta = {nested: {t: "MetaMap", c: {keep: inline("b.jpg"), replace: inline("a.jpg")}}, list: {t: "MetaList", c: [inline("b.jpg")]}};
  const metadata = {nested: {t: "MetaMap", c: {replace: inline("a.jpg"), added: inline("b.jpg")}}, list: {t: "MetaList", c: [inline("b.jpg")]}} as NonNullable<ConversionOptions["metadata"]>;
  const input = {base: "/doc", source: "source.json", bytes: encode(JSON.stringify({"pandoc-api-version": [1,23,1,2], meta, blocks: [{t: "Para", c: [image("a.jpg"), image("b.jpg")]}]}))};
  const options: ConversionOptions = {from: "json", to, lossy: true, metadata, ...(shared ? {resourcePath: ["/doc"]} : {}), ...(lua ? {filters: [{kind: "lua", path: "/filter.lua"}]} : {})};
  const make = () => createLuaFilterCapability({readStream: async function* () {yield encode("function Image(el) return el end");}});
  const expectedHost = resources(), expected = await convert([input], options, {resourceFiles: expectedHost.fs, resourceCwd: "/cwd", filters: make()}).catch(error => error);
  const host = resources(), fs = new MemoryFileSystem(), filters = make(), output: Uint8Array[] = [];
  vi.spyOn(filters, "apply").mockRejectedValue(new Error("Resident Lua forbidden"));
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    const run = convertToOutput([input], options, {resourceFiles: host.fs, resourceCwd: "/cwd", filters, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {output.push(bytes.slice());}, async close() {}, async abort() {}}});
    if (expected instanceof Error) await expect(run).rejects.toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message});
    else await run;
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  const bytes = Uint8Array.from(output.flatMap(chunk => [...chunk]));
  if (!(expected instanceof Error)) expect(expected).toMatchObject(to === "rtf" ? {text: new TextDecoder().decode(bytes)} : {bytes});
  expect(host.readStream.mock.calls.map(call => call[0])).toEqual(expectedHost.readStream.mock.calls.map(call => call[0]));
  expect(host.readStream.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(shared ? ["/doc/a.jpg", "/doc/b.jpg"] : ["/doc/a.jpg", "/doc/b.jpg", "/cwd/a.jpg", "/cwd/b.jpg"]));
  expect(await fs.readdir("/")).toEqual([]);
});
