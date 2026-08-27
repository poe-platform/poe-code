import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../../../src/contracts/errors.js";
import type { FileSystem } from "../../../../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../../../../src/fs/readonly/index.js";
import { MockS3Client, S3FileSystem, createS3Transport } from "../../../../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../../../../src/fs/webdav/index.js";
import { MockDav } from "../../../webdav/mock.js";
import { bytes, comparison, opaque, wrapped } from "./support.js";

const sourceBytes = bytes("source survives\u0000\ufffd");
const targetBytes = bytes("independent target survives");
const observe = (name: string, data: unknown): void => console.log(`IMPLEMENTATION_OBSERVATION ${Buffer.from(JSON.stringify({ name, data })).toString("base64")}`);

function replace(object: object, name: string, value: unknown): () => void {
  const previous = Object.getOwnPropertyDescriptor(object, name);
  Object.defineProperty(object, name, { value, configurable: true, writable: true });
  return () => { if (previous) Object.defineProperty(object, name, previous); else Reflect.deleteProperty(object, name); };
}

for (const backend of ["memory", "s3"] as const) {
  for (const streaming of [false, true]) {
    for (const timing of ["subclass-before", "prototype-before", "own-after", "prototype-after"] as const) {
      test(`${backend} ${timing} ${streaming ? "streamed" : "buffered"}: faithful writer preserves qualified copy and alias rejection`, async () => {
        const root = new MemoryFileSystem();
        const store = new MockS3Client({ buckets: ["bucket"] });
        const source: FileSystem = backend === "memory" ? new MemoryFileSystem() : new S3FileSystem({
          bucket: "bucket", prefix: "left", transport: createS3Transport(store, store.capabilities),
        });
        await source.writeFile("/source", sourceBytes);
        await source.writeFile("/keep", bytes("namespace sentinel"));
        const readSource = source.readFile.bind(source);
        const initializeMemory = MemoryFileSystem.prototype.writeFile;
        const sourceNames = await source.readdir("/");
        const effects: string[] = [];
        class MemoryView extends MemoryFileSystem {}
        class S3View extends S3FileSystem {}
        const prototype: object = backend === "memory" ? MemoryFileSystem.prototype : S3FileSystem.prototype;
        const subclass: object = backend === "memory" ? MemoryView.prototype : S3View.prototype;
        const method = !streaming ? "writeFile" : backend === "s3" && timing === "prototype-after" ? "call"
          : backend === "s3" && timing !== "own-after" ? "streamWrite" : "writeStream";
        let original = Reflect.get(prototype, method) as (...args: unknown[]) => unknown;
        const replacement = function(this: object, ...args: unknown[]): unknown {
          assert.equal(typeof original, "function");
          if (method !== "call" || args[0] === "putObject") effects.push("forwarded-write");
          return Reflect.apply(original, this, args);
        };
        let restore = (): void => {};
        let target: FileSystem;
        try {
          if (timing === "subclass-before" || timing === "prototype-before") {
            restore = replace(timing === "subclass-before" ? subclass : prototype, method, replacement);
          }
          const MemoryConstructor = timing === "subclass-before" ? MemoryView : MemoryFileSystem;
          const S3Constructor = timing === "subclass-before" ? S3View : S3FileSystem;
          target = backend === "memory" ? new MemoryConstructor() : new S3Constructor({
            bucket: "bucket", prefix: "right", transport: createS3Transport(store, {
              ...store.capabilities, streamingRead: streaming, streamingWrite: streaming,
            }),
          });
          if (backend === "memory") {
            await initializeMemory.call(target as MemoryFileSystem, "/target", targetBytes);
          } else await store.putObject({ Bucket: "bucket", Key: "right/target", Body: targetBytes });
          if (backend === "memory" && !streaming) Object.defineProperty(target, "capabilities", {
            value: { ...target.capabilities, streamingWrite: false }, configurable: true,
          });
          if (timing === "own-after") original = Reflect.get(target, method) as typeof original;
          if (timing === "own-after" || timing === "prototype-after") restore = replace(timing === "own-after" ? target : prototype, method, replacement);
          const mount = createMountFileSystem({ root, mounts: {
            "/source-view": source, "/target-view": target, "/target-alias": createReadOnlyFileSystem(target),
          } });
          const answer = await comparison(mount, "/source-view/source", mount, "/target-view/target");
          const failure = await mount.copyFile("/source-view/source", "/target-view/target").then(() => undefined, error => error as FsError);
          const sourceAfter = await readSource("/source");
          const targetAfter = await target.readFile("/target");
          observe(`${backend}-${timing}-${streaming ? "stream" : "buffer"}`, {
            answer, error: failure?.code, effects, source: Buffer.from(sourceAfter).toString("base64"), target: Buffer.from(targetAfter).toString("base64"),
          });
          assert.equal(answer, "distinct");
          assert.equal(failure, undefined);
          assert.deepEqual(effects, ["forwarded-write"]);
          assert.deepEqual(sourceAfter, sourceBytes);
          assert.deepEqual(targetAfter, sourceBytes);
          assert.equal(await comparison(mount, "/target-alias/target", mount, "/target-view/target"), "same");
          await assert.rejects(mount.copyFile("/target-alias/target", "/target-view/target"), { code: "EINVAL" });
          assert.deepEqual(effects, ["forwarded-write"]);
          assert.deepEqual(await target.readFile("/target"), sourceBytes);
          assert.deepEqual(await source.readdir("/"), sourceNames);
          assert.deepEqual((await target.readdir("/")).map(entry => entry.name), ["target"]);
        } finally { restore(); }
      });
    }
  }
}

for (const backend of ["memory", "s3"] as const) {
  test(`${backend} faithful content acquisition retains authority without reading during comparison`, async () => {
    const store = new MockS3Client({ buckets: ["bucket"] });
    const source: FileSystem = backend === "memory" ? new MemoryFileSystem() : new S3FileSystem({
      bucket: "bucket", transport: createS3Transport(store, store.capabilities),
    });
    const target = new MemoryFileSystem();
    await source.writeFile("/source", sourceBytes);
    await target.writeFile("/target", targetBytes);
    let acquisitions = 0;
    const read = source.readStream!.bind(source);
    const restore = replace(source, "readStream", async function* (...args: Parameters<typeof read>) {
      acquisitions++;
      yield* read(...args);
    });
    try {
      const mount = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/left": source, "/right": target } });
      assert.equal(await comparison(mount, "/left/source", mount, "/right/target"), "distinct");
      assert.equal(acquisitions, 0);
      await mount.copyFile("/left/source", "/right/target");
      assert.equal(acquisitions, 1);
      assert.deepEqual(await source.readFile("/source"), sourceBytes);
      assert.deepEqual(await target.readFile("/target"), sourceBytes);
    } finally { restore(); }
  });
}

for (const backend of ["memory", "s3"] as const) {
  test(`${backend} honest path remapper omits changed authority and refuses an unproven existing-target overwrite`, async () => {
    const store = new MockS3Client({ buckets: ["bucket"] });
    const backing: FileSystem = backend === "memory" ? new MemoryFileSystem()
      : new S3FileSystem({ bucket: "bucket", transport: store });
    await backing.writeFile("/source", sourceBytes);
    await backing.writeFile("/keep", targetBytes);
    const effects: string[] = [];
    const mapped = (path: string): string => path === "/target" ? "/source" : path;
    const remapper = opaque(wrapped(backing, {
      stat: (path, options) => backing.stat(mapped(path), options),
      lstat: (path, options) => backing.lstat(mapped(path), options),
      realpath: async (path, options) => { await backing.realpath(mapped(path), options); return path; },
      readFile: (path, options) => { effects.push("read"); return backing.readFile(mapped(path), options); },
      readStream: (path, options) => { effects.push("readStream"); return backing.readStream!(mapped(path), options); },
      writeFile: (path, data, options) => { effects.push("write"); return backing.writeFile(mapped(path), data, options); },
      writeStream: (path, data, options) => { effects.push("writeStream"); return backing.writeStream!(mapped(path), data, options); },
    }));
    const mount = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/original": backing, "/mapped": remapper } });
    assert.equal(await comparison(mount, "/original/source", mount, "/mapped/target"), "unknown");
    await assert.rejects(mount.copyFile("/original/source", "/mapped/target"), { code: "ENOTSUP" });
    await assert.rejects(mount.copyFile("/mapped/target", "/original/source"), { code: "ENOTSUP" });
    assert.deepEqual(effects, []);
    assert.deepEqual(await backing.readFile("/source"), sourceBytes);
    assert.deepEqual(await backing.readFile("/keep"), targetBytes);
    assert.deepEqual((await backing.readdir("/")).map(entry => entry.name), ["keep", "source"]);
  });
}

for (const backend of ["memory", "s3"] as const) {
  for (const policy of ["inherited", "explicit-distinct", "explicit-denial"] as const) {
    test(`${backend} harmless subclass ${policy}: preserve real qualified workflows and explicit authority`, async () => {
      let calls = 0;
      const denied = new FsError("EACCES", { message: "explicit authority denied" });
      const authority = async (): Promise<"distinct"> => { calls++; if (policy === "explicit-denial") throw denied; return "distinct"; };
      class MemoryView extends MemoryFileSystem { readonly label = "harmless metadata"; }
      class S3View extends S3FileSystem { readonly label = "harmless metadata"; }
      if (policy !== "inherited") Object.defineProperty(backend === "memory" ? MemoryView.prototype : S3View.prototype, "compareEntry", { value: authority });
      const store = new MockS3Client({ buckets: ["bucket"] });
      const remote = new S3View({ bucket: "bucket", transport: createS3Transport(store, store.capabilities) });
      const memory = new MemoryView();
      const left = backend === "memory" ? memory : remote;
      const right = backend === "memory" ? remote : memory;
      await left.writeFile("/source", sourceBytes);
      await right.writeFile("/target", targetBytes);
      const mount = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/left": createReadOnlyFileSystem(left), "/right": right } });
      if (policy === "explicit-denial") {
        await assert.rejects(comparison(mount, "/left/source", mount, "/right/target"), { code: "EACCES" });
        assert.equal(calls, 1);
        calls = 0;
        await assert.rejects(mount.copyFile("/left/source", "/right/target"), { code: "EACCES" });
        assert.equal(calls, 1);
        assert.deepEqual(await right.readFile("/target"), targetBytes);
      } else {
        assert.equal(await comparison(mount, "/left/source", mount, "/right/target"), "distinct");
        assert.equal(calls, policy === "inherited" ? 0 : 1);
        calls = 0;
        await mount.copyFile("/left/source", "/right/target");
        assert.equal(calls, policy === "inherited" ? 0 : 1);
        assert.deepEqual(await right.readFile("/target"), sourceBytes);
      }
      assert.deepEqual(await left.readFile("/source"), sourceBytes);
      assert.deepEqual((await left.readdir("/")).map(entry => entry.name), ["source"]);
      assert.deepEqual((await right.readdir("/")).map(entry => entry.name), ["target"]);
    });
  }
}

for (const backend of ["memory", "s3", "webdav"] as const) {
  test(`${backend} post-construction explicit comparison error is not hidden by cached authority`, async () => {
    const store = new MockS3Client({ buckets: ["bucket"] });
    const remote = new S3FileSystem({ bucket: "bucket", transport: createS3Transport(store, store.capabilities) });
    const memory = new MemoryFileSystem();
    const dav = new MockDav();
    const source: FileSystem = backend === "memory" ? memory : backend === "s3" ? remote
      : new WebDavFileSystem({ baseUrl: "https://dav.test/dav/", fetch: dav.createFetch() });
    const target = backend === "memory" ? remote : memory;
    await source.writeFile("/source", sourceBytes);
    await target.writeFile("/target", targetBytes);
    let queries = 0;
    const restore = replace(source, "compareEntry", async (): Promise<never> => { queries++; throw new FsError("EACCES", { message: "explicit late comparison failure" }); });
    try {
      const mount = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/left": source, "/right": target } });
      let answer: unknown;
      let compareError: string | undefined;
      try { answer = await comparison(mount, "/left/source", mount, "/right/target"); }
      catch (error) { compareError = (error as FsError).code; }
      const compareQueries = queries;
      queries = 0;
      const failure = await mount.copyFile("/left/source", "/right/target").then(() => undefined, error => error as FsError);
      const targetAfter = await target.readFile("/target");
      observe(`${backend}-explicit-late-error`, { answer, compareError, compareQueries, copyError: failure?.code, copyQueries: queries, target: Buffer.from(targetAfter).toString("base64") });
      assert.equal(compareError, "EACCES");
      assert.equal(compareQueries, 1);
      assert.equal(failure?.code, "EACCES");
      assert.equal(queries, 1);
      assert.deepEqual(await source.readFile("/source"), sourceBytes);
      assert.deepEqual(targetAfter, targetBytes);
    } finally { restore(); }
  });
}
