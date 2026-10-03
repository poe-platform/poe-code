import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, toByteSource, type CommandContext, type FileSystem } from "safe-bash-contracts";
import { settings } from "safe-bash-io-engine/commands/archive/internal";
import { publishZip, ZipScope } from "./zip/safety.js";

for (const missing of ["handle", "identity", "capability", "stream"]) {
  test(`ZIP checks fallback bytes when missing ${missing}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/a", new Uint8Array([1, 2, 3]));
    let retained = 0;
    const view = new Proxy(fs, { get(target, property) {
      if (property === "openReadFile") return missing === "handle" || missing === "stream" ? undefined
        : () => { retained++; throw new Error("unexpected retained read"); };
      if (property === "capabilitiesFor") return async () => ({ ...fs.capabilities, retainedRead: missing !== "capability" });
      if (property === "readStream" && missing === "stream") return undefined;
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const expected = { ...await fs.stat("/a") };
    if (missing === "identity") delete (expected as { identityScope?: unknown }).identityScope;
    const scope = new ZipScope(context(view), settings({}));
    try {
      if (missing === "stream") await assert.rejects(collectBytes(scope.input("/a", false, expected), {}), { code: "ENOTSUP" });
      else assert.deepEqual(await collectBytes(scope.input("/a", false, expected), {}), new Uint8Array([1, 2, 3]));
      assert.equal(retained, 0);
    } finally { await scope.close(); }
  });
}

for (const mutation of ["growth", "shrink", "mtime", "canonical"]) {
  test(`ZIP rejects fallback source ${mutation}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/a", new Uint8Array([1, 2, 3]));
    let consumed = false;
    const view = new Proxy(fs, { get(target, property) {
      if (property === "openReadFile") return undefined;
      if (property === "realpath") return async (path: string) => consumed && mutation === "canonical" ? "/other" : fs.realpath(path);
      if (property === "readStream") return () => (async function* () {
        yield new Uint8Array(mutation === "growth" ? 4 : mutation === "shrink" ? 2 : 3);
        consumed = true;
        if (mutation === "mtime") await fs.utimes!("/a", 0, 1000);
      })();
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const scope = new ZipScope(context(view), settings({}));
    try { await assert.rejects(collectBytes(scope.input("/a", false, await fs.stat("/a")), {}), /source changed/); }
    finally { await scope.close(); }
  });
}

test("ZIP rejects whole-file-only input without collecting a fallback", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", new Uint8Array(4));
  const view = new Proxy(fs, { get(target, property) {
    if (property === "openReadFile" || property === "readStream") return undefined;
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scope = new ZipScope(context(view), settings({ limits: { maxBufferedFileBytes: 3 } }));
  try { await assert.rejects(collectBytes(scope.input("/a", false, await fs.stat("/a")), {}), { code: "ENOTSUP" }); }
  finally { await scope.close(); }
});

function context(fs: FileSystem): CommandContext {
  return { command: "zip", args: [], cwd: "/", env: {}, fs, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal };
}

for (const failure of ["source", "race", "limit"]) test(`ZIP exclusive publication preserves destination on ${failure}`, async () => {
  const fs = createMemoryFileSystem();
  const view = new Proxy(fs, { get(target, property) {
    if (property === "capabilitiesFor") return async () => ({ ...fs.capabilities, atomicFileStaging: false, trustedOwnedStaging: false, atomicFilePublication: false });
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scope = new ZipScope(context(view), settings({ limits: { maxBufferedFileBytes: 3 } }));
  const source = (async function* () {
    yield new Uint8Array(failure === "limit" ? 4 : 2);
    if (failure === "source") throw new Error("source changed");
    if (failure === "race") await fs.writeFile("/out.zip", new Uint8Array([42]));
  })();
  try {
    await assert.rejects(publishZip(scope, { output: "/out.zip", parent: "/", parentName: "/", parentStat: await fs.stat("/"), existing: undefined, source }));
    if (failure === "race") assert.deepEqual(await fs.readFile("/out.zip"), new Uint8Array([42]));
    else await assert.rejects(fs.stat("/out.zip"), { code: "ENOENT" });
  } finally { await scope.close(); }
});
