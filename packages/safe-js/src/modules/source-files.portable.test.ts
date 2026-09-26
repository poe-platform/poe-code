import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createRootedSourceResolver } from "./source-files.js";

it("loads source modules through an explicitly granted portable filesystem", async () => {
  const adapter = new MemoryFileSystem();
  await adapter.mkdir("/source");
  await adapter.writeFile("/source/value.ajs", new TextEncoder().encode("export const value = 42;"));
  await adapter.writeFile("/outside.ajs", new TextEncoder().encode("export const secret = 1;"));
  await adapter.symlink("/outside.ajs", "/source/escape.ajs");
  const resolver = await createRootedSourceResolver("/source", adapter);
  expect(await resolver.entryId("entry.ajs")).toBe("/source/entry.ajs");
  expect(await resolver("./value.ajs", "/source/entry.ajs", {})).toEqual({ id: "/source/value.ajs", source: "export const value = 42;" });
  expect(await resolver("./escape.ajs", "/source/entry.ajs", {})).toBeUndefined();
  expect(await resolver("../outside.ajs", "/source/entry.ajs", {})).toBeUndefined();
});

it("denies a replaced portable source and closes its retained handle", async () => {
  const adapter = new MemoryFileSystem();
  await adapter.mkdir("/source");
  await adapter.writeFile("/source/value.ajs", new TextEncoder().encode("export const value = 1;"));
  const open = adapter.openReadFile.bind(adapter);
  const close = vi.fn();
  const granted = new Proxy(adapter, {
    get(target, key) {
      if (key === "openReadFile") return async (filename: string) => {
        await adapter.rename(filename, "/source/prior.ajs");
        await adapter.writeFile(filename, new TextEncoder().encode("export const value = 2;"));
        const handle = await open(filename);
        const release = handle.close.bind(handle);
        handle.close = async () => {close(); await release();};
        return handle;
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const resolver = await createRootedSourceResolver("/source", granted);
  expect(await resolver("./value.ajs", "/source/entry.ajs", {})).toBeUndefined();
  expect(close).toHaveBeenCalledOnce();
});
