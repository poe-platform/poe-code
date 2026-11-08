import { describe, expect, it, vi } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import type { FileResizeOperation, FileResizeOptions } from "../src/contracts/filesystem.js";

function fixture() {
 const fs = new MemoryFileSystem();
 Object.defineProperty(fs, "capabilities", {value:{...fs.capabilities,retainedResize:false,atomicResize:true}});
 return Object.assign(fs,{resizeFile:vi.fn(async (_path:string,_operation:FileResizeOperation,_options:FileResizeOptions={})=>{})});
}
const operation = {size:2n,modifier:"relative",ioBlocks:false} as const;
describe("atomic resize adapter boundaries", () => {
 it("device view forwards the operation and signals without target-size reads", async () => {
  const backend=fixture(), fs=createDeviceFileSystem(backend);
  const options={create:true,mode:0o600,signal:new AbortController().signal};
  expect((await fs.capabilitiesFor("/target",options)).atomicResize).toBe(true);
  await fs.resizeFile!("/target",operation,options);
  expect(backend.resizeFile).toHaveBeenCalledExactlyOnceWith("/target",operation,options);
 });
 it("mounts route atomic operations without rewriting their size intent", async () => {
  const backend=fixture(), fs=createMountFileSystem({root:new MemoryFileSystem(),mounts:{"/data":backend}});
  const options={create:true};
  await fs.resizeFile("/data/target",operation,options);
  expect(backend.resizeFile).toHaveBeenCalledExactlyOnceWith("/target",operation,options);
 });
 it("device capabilities revoke an absent resize method", async () => {
  const backend=fixture(); Reflect.deleteProperty(backend,"resizeFile");
  expect((await createDeviceFileSystem(backend).capabilitiesFor("/target")).atomicResize).toBe(false);
 });
 it("readonly and quota wrappers do not expose an unguarded atomic mutation", () => {
  const backend=fixture();
  const readonly=createReadOnlyFileSystem(backend);
  const quota=withFileSystemQuota(backend,{maxBytes:1024});
  expect(readonly.capabilities.atomicResize).toBe(false);
  expect(quota.capabilities.atomicResize).toBe(false);
  expect(quota.resizeFile).toBeUndefined();
 });
 it("scoped atomic resize charges once and cannot run after cancellation", async () => {
  const backend=fixture(), controller=new AbortController(), charge=vi.fn();
  const fs=scopeFileSystem(backend,charge,controller.signal);
  await fs.resizeFile!("/target",operation);
  expect(charge).toHaveBeenCalledTimes(1);
  controller.abort(new Error("closed"));
  await expect(fs.resizeFile!("/target",operation)).rejects.toThrow("closed");
  expect(backend.resizeFile).toHaveBeenCalledTimes(1);
 });
});
