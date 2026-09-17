import {expect,it,vi,beforeEach} from "vitest";
import {fs,vol} from "memfs";
vi.mock("node:fs/promises",async () => (await import("memfs")).fs.promises);
import {createRootedSourceResolver} from "./source-files.js";

beforeEach(()=>{vi.restoreAllMocks();vol.reset();});
it("loads only explicitly rooted relative source files",async()=>{
  vol.fromJSON({"/grant/dep.js":"export const x=1", "/outside/secret.js":"secret"});
  const resolve=await createRootedSourceResolver("/grant");
  expect(await resolve("./dep.js","/grant/entry.js",{})).toEqual({id:"/grant/dep.js",source:"export const x=1"});
  for(const specifier of ["../outside/secret.js","node:fs","https://example.com/x.js","acorn","/outside/secret.js"])
    expect(await resolve(specifier,"/grant/entry.js",{})).toBeUndefined();
});
it("canonicalizes aliases and denies escaping symbolic links",async()=>{
  vol.fromJSON({"/grant/dep.js":"export default 1", "/outside/secret.js":"secret"});
  vol.symlinkSync("/grant/dep.js","/grant/alias.js");
  vol.symlinkSync("/outside/secret.js","/grant/escape.js");
  const resolve=await createRootedSourceResolver("/grant");
  expect(await resolve("./alias.js","/grant/entry.js",{})).toEqual(await resolve("./dep.js","/grant/entry.js",{}));
  expect(await resolve("./escape.js","/grant/entry.js",{})).toBeUndefined();
});
it("does not search for extensions, package files, or directory indexes",async()=>{
  vol.fromJSON({"/grant/dep.js":"export default 1", "/grant/pkg/index.js":"export default 2"});
  const resolve=await createRootedSourceResolver("/grant");
  expect(await resolve("./dep","/grant/entry.js",{})).toBeUndefined();
  expect(await resolve("./pkg","/grant/entry.js",{})).toBeUndefined();
});

it("accepts referrers through the explicitly granted root's own canonical alias",async()=>{
  vol.fromJSON({"/grant/dep.js":"export const x=1"});
  vol.symlinkSync("/grant","/alias");
  const resolve=await createRootedSourceResolver("/alias");
  expect(await resolve("./dep.js","/alias/entry.js",{})).toEqual({id:"/grant/dep.js",source:"export const x=1"});
  expect(await resolve("../outside/secret.js","/alias/entry.js",{})).toBeUndefined();
});

it("denies ancestor replacement between validation and opening the source",async()=>{
  vol.fromJSON({"/grant/sub/dep.js":"export const secret=false", "/outside/dep.js":"export const secret=true"});
  const resolve=await createRootedSourceResolver("/grant");
  const stat=fs.promises.stat.bind(fs.promises);
  vi.spyOn(fs.promises,"stat").mockImplementation(async (...args)=>{
    const result=await stat(...args);
    if(args[0]==="/grant/sub/dep.js"){
      vol.renameSync("/grant/sub","/grant/prior");
      vol.symlinkSync("/outside","/grant/sub");
    }
    return result;
  });
  expect(await resolve("./sub/dep.js","/grant/entry.js",{})).toBeUndefined();
});

it("reads through the validated handle after the source pathname is replaced",async()=>{
  vol.fromJSON({"/grant/dep.js":"export const value=1"});
  const resolve=await createRootedSourceResolver("/grant");
  const open=fs.promises.open.bind(fs.promises);
  const close=vi.fn();
  vi.spyOn(fs.promises,"open").mockImplementation(async (...args)=>{
    const handle=await open(...args);
    const read=handle.readFile.bind(handle);
    const release=handle.close.bind(handle);
    vi.spyOn(handle,"readFile").mockImplementation(async (...options)=>{
      vol.renameSync("/grant/dep.js","/grant/prior.js");
      vol.writeFileSync("/grant/dep.js","export const value=2");
      return read(...options);
    });
    vi.spyOn(handle,"close").mockImplementation(async ()=>{close();await release();});
    return handle;
  });
  expect(await resolve("./dep.js","/grant/entry.js",{})).toEqual({id:"/grant/dep.js",source:"export const value=1"});
  expect(close).toHaveBeenCalledOnce();
});

it("closes the source handle when reading fails",async()=>{
  vol.fromJSON({"/grant/dep.js":"export const value=1"});
  const resolve=await createRootedSourceResolver("/grant");
  const failure=new Error("source read failed");
  const open=fs.promises.open.bind(fs.promises);
  const close=vi.fn();
  vi.spyOn(fs.promises,"open").mockImplementation(async (...args)=>{
    const handle=await open(...args);
    const release=handle.close.bind(handle);
    vi.spyOn(handle,"readFile").mockRejectedValue(failure);
    vi.spyOn(handle,"close").mockImplementation(async ()=>{close();await release();});
    return handle;
  });
  await expect(resolve("./dep.js","/grant/entry.js",{})).rejects.toBe(failure);
  expect(close).toHaveBeenCalledOnce();
});

it.each(["file","directory"])("closes and denies a %s substituted before open",async replacement=>{
  vol.fromJSON({"/grant/dep.js":"export const value=1"});
  const resolve=await createRootedSourceResolver("/grant");
  const open=fs.promises.open.bind(fs.promises);
  const close=vi.fn();
  const read=vi.fn();
  vi.spyOn(fs.promises,"open").mockImplementation(async (...args)=>{
    vol.renameSync("/grant/dep.js","/grant/prior.js");
    if(replacement==="file") vol.writeFileSync("/grant/dep.js","export const value=2");
    else vol.mkdirSync("/grant/dep.js");
    const handle=await open(...args);
    const release=handle.close.bind(handle);
    vi.spyOn(handle,"readFile").mockImplementation(read);
    vi.spyOn(handle,"close").mockImplementation(async ()=>{close();await release();});
    return handle;
  });
  expect(await resolve("./dep.js","/grant/entry.js",{})).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it("closes the handle and preserves cancellation after opening",async()=>{
  vol.fromJSON({"/grant/dep.js":"export const value=1"});
  const resolve=await createRootedSourceResolver("/grant");
  const controller=new AbortController();
  const reason=new Error("cancel source read");
  const open=fs.promises.open.bind(fs.promises);
  const close=vi.fn();
  const read=vi.fn();
  vi.spyOn(fs.promises,"open").mockImplementation(async (...args)=>{
    const handle=await open(...args);
    const release=handle.close.bind(handle);
    vi.spyOn(handle,"readFile").mockImplementation(read);
    vi.spyOn(handle,"close").mockImplementation(async ()=>{close();await release();});
    controller.abort(reason);
    return handle;
  });
  await expect(resolve("./dep.js","/grant/entry.js",{signal:controller.signal})).rejects.toBe(reason);
  expect(read).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
