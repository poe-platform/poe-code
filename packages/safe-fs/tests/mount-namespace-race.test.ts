import { expect, it } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../src/fs/readonly/index.js";

for (const operation of ["readFile", "writeFile"] as const) {
  it(`confines ${operation} while a guest renames a symlink over its admitted path`, async () => {
    const backing = createMemoryFileSystem();
    const bytes = (text: string) => new TextEncoder().encode(text);
    await backing.mkdir("/out");
    await backing.mkdir("/private");
    await backing.writeFile("/private/secret", bytes("protected"));
    await backing.writeFile("/out/target", bytes("allowed"));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const root = new Proxy(backing, { get(target, key) {
      const member: unknown = Reflect.get(target, key, target);
      if (key === operation) return async (path: string, ...args: unknown[]) => {
        if (path === "/out/target") { entered.resolve(); await release.promise; }
        return Reflect.apply(member as (...args: unknown[]) => unknown, target, [path, ...args]);
      };
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const fs = createMountFileSystem({ root, mounts: {
      "/private": operation === "writeFile" ? createReadOnlyFileSystem(backing) : createMemoryFileSystem(),
    } });
    await fs.symlink("/private/secret", "/out/escape");
    await expect(operation === "writeFile" ? fs.writeFile("/out/escape", bytes("denied")) : fs.readFile("/out/escape")).rejects.toMatchObject({ code: "EACCES" });
    const pending = operation === "writeFile"
      ? fs.writeFile("/out/target", bytes("injected")) : fs.readFile("/out/target");
    await entered.promise;
    const rename = fs.rename("/out/escape", "/out/target");
    // Let the attempted rename run without awaiting a serialized mutation.
    await new Promise<void>(resolve => setImmediate(resolve));
    release.resolve();
    const result = await pending;
    await rename;
    if (operation === "readFile") expect(new TextDecoder().decode(result!)).toBe("allowed");
    expect(new TextDecoder().decode(await backing.readFile("/private/secret"))).toBe("protected");
    await expect(fs.readFile("/out/target")).rejects.toMatchObject({ code: "EACCES" });
  });
}

it("allows a mount stream to supply another write while namespace mutations wait", async () => {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/source", new TextEncoder().encode("content"));
  const fs = createMountFileSystem({ root: backing });
  await fs.writeStream("/destination", fs.readStream("/source"));
  expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("content");
});

it("mount read streams do not hold namespace locks while the consumer is paused", async () => {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/archive", new Uint8Array(200_000));
  await backing.mkdir("/out");
  await backing.writeFile("/other", new Uint8Array([1]));
  const fs = createMountFileSystem({ root: backing });
  const stream = fs.readStream("/archive", { chunkSize: 65_536 })[Symbol.asyncIterator]();
  await stream.next();
  await fs.rmdir("/out");
  await fs.rename("/other", "/renamed");
  let length = 65_536;
  for (let item = await stream.next(); !item.done; item = await stream.next()) length += item.value.length;
  expect(length).toBe(200_000);
  expect(await backing.stat("/renamed")).toMatchObject({ type: "file" });
  await expect(backing.stat("/out")).rejects.toMatchObject({ code: "ENOENT" });
});

it("mount read streams refuse a guest rename that reroutes the path between pulls", async () => {
  const backing = createMemoryFileSystem();
  await backing.mkdir("/out");
  await backing.writeFile("/out/target", new Uint8Array(200_000));
  const fs = createMountFileSystem({ root: backing, mounts: { "/private": createMemoryFileSystem() } });
  await fs.writeFile("/private/secret", new TextEncoder().encode("protected"));
  await fs.symlink("/private/secret", "/out/escape");
  const stream = fs.readStream("/out/target", { chunkSize: 65_536 })[Symbol.asyncIterator]();
  await stream.next();
  await fs.rename("/out/escape", "/out/target");
  await expect(stream.next()).rejects.toMatchObject({ code: "EACCES" });
});

it("cancels a queued namespace mutation without leaking the lock", async () => {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/source", new Uint8Array([1]));
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const root = new Proxy(backing, { get(target, key) {
    const member: unknown = Reflect.get(target, key, target);
    if (key === "readFile") return async (...args: unknown[]) => {
      entered.resolve(); await release.promise;
      return Reflect.apply(member as (...args: unknown[]) => unknown, target, args);
    };
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const fs = createMountFileSystem({ root });
  const read = fs.readFile("/source");
  await entered.promise;
  const controller = new AbortController();
  const reason = new Error("cancel queued rename");
  const pending = fs.rename("/source", "/destination", { signal: controller.signal });
  controller.abort(reason);
  await expect(pending).rejects.toBe(reason);
  release.resolve();
  await read;
  await fs.rename("/source", "/destination");
  expect(await fs.readFile("/destination")).toEqual(new Uint8Array([1]));
});
