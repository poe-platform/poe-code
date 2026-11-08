import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import native from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { relative } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { FsError } from "../../../src/contracts/index.js";
import type { ErrnoCode, FileSystem } from "../../../src/contracts/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";

const sentinel = new Uint8Array([...new TextEncoder().encode("independent native preservation\n"), 0, 255, 10]);
const previous = new Uint8Array([0, 254, 1, 10, 79, 76, 68]);
const observations: Record<string, unknown>[] = [];
const mutationMethods = new Set(["copyFile", "writeFile", "appendFile", "truncate", "rename", "unlink", "rm", "link", "symlink", "mkdir", "rmdir", "chmod", "utimes"]);
const observedMethods = [...mutationMethods, "open", "stat", "lstat", "realpath", "readlink"];

type Event = {
  method: string;
  phase: "call" | "return" | "throw";
  path: string;
  destination?: string;
  bigint?: boolean;
  flags?: string | number;
  destructive: boolean;
  code?: string;
  dev?: string;
  ino?: string;
};

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function errorRecord(error: unknown): unknown {
  return error instanceof FsError
    ? { name: error.name, code: error.code, syscall: error.syscall, path: error.path, dest: error.dest }
    : error instanceof Error ? { name: error.name, message: error.message, code: codeOf(error) } : error ?? null;
}

async function traceNative(root: string, action: () => Promise<void>) {
  const events: Event[] = [];
  const originals = new Map<string, unknown>();
  const virtual = (path: unknown) => typeof path === "string" ? `/${relative(root, path)}` : String(path);
  for (const method of observedMethods) {
    const original: unknown = Reflect.get(native, method);
    if (typeof original !== "function") throw new Error(`missing native method ${method}`);
    originals.set(method, original);
    Reflect.set(native, method, async (...parameters: unknown[]) => {
      const flags = method === "copyFile" ? parameters[2] : method === "open" ? parameters[1] : undefined;
      const options = parameters[1];
      const event: Event = {
        method, phase: "call", path: virtual(parameters[0]), destructive: mutationMethods.has(method)
          || method === "open" && (typeof flags === "string" ? /[wa+]/.test(flags) : typeof flags === "number" && (flags & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC)) !== 0),
        ...(method === "copyFile" || method === "rename" || method === "link" ? { destination: virtual(parameters[1]) } : {}),
        ...(method === "stat" || method === "lstat" ? { bigint: typeof options === "object" && options !== null && "bigint" in options && options.bigint === true } : {}),
        ...(typeof flags === "string" || typeof flags === "number" ? { flags } : {}),
      };
      events.push(event);
      try {
        const result: unknown = await Reflect.apply(original, native, parameters);
        events.push({ ...event, phase: "return", ...(typeof result === "object" && result !== null && "dev" in result && "ino" in result ? { dev: String(result.dev), ino: String(result.ino) } : {}) });
        return result;
      } catch (error) {
        const code = codeOf(error);
        events.push({ ...event, phase: "throw", ...(code === undefined ? {} : { code }) });
        throw error;
      }
    });
  }
  syncBuiltinESMExports();
  let failure: unknown;
  try { await action(); }
  catch (error) { failure = error; }
  finally {
    for (const [method, original] of originals) Reflect.set(native, method, original);
    syncBuiltinESMExports();
  }
  return { events, failure };
}

async function snapshot(filesystem: FileSystem): Promise<Record<string, Record<string, unknown>>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const path of ["/", ...(await filesystem.readdir("/")).map((entry) => `/${entry.name}`).sort()]) {
    const stat = await filesystem.lstat(path);
    const entry: Record<string, unknown> = {
      type: stat.type, size: stat.size, mode: stat.mode, dev: stat.dev, ino: stat.ino, nlink: stat.nlink,
      mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, birthtimeMs: stat.birthtimeMs,
    };
    if (stat.type === "file") {
      const bytes = await filesystem.readFile(path, { maxBytes: 1024 * 1024 });
      entry.base64 = Buffer.from(bytes).toString("base64");
      entry.sha256 = createHash("sha256").update(bytes).digest("hex");
    }
    if (stat.type === "symlink") entry.target = await filesystem.readlink!(path);
    result[path] = entry;
  }
  return result;
}

type Row = {
  name: string;
  alias?: "same-path" | "hardlink" | "symlink";
  exclusive?: boolean;
  missingSource?: boolean;
  missingDestination?: boolean;
  dangling?: boolean;
  code?: ErrnoCode;
};

const rows: readonly Row[] = [
  { name: "direct native same-path alias rejects before any native write", alias: "same-path", code: "EINVAL" },
  { name: "direct native hardlink alias rejects before any native write", alias: "hardlink", code: "EINVAL" },
  { name: "direct native symlink alias rejects before any native write", alias: "symlink", code: "EINVAL" },
  { name: "exclusive same-path alias gives EEXIST before EINVAL", alias: "same-path", exclusive: true, code: "EEXIST" },
  { name: "exclusive hardlink alias gives EEXIST before EINVAL", alias: "hardlink", exclusive: true, code: "EEXIST" },
  { name: "exclusive symlink alias gives EEXIST before EINVAL", alias: "symlink", exclusive: true, code: "EEXIST" },
  { name: "missing source gives ENOENT before existing exclusive destination", missingSource: true, exclusive: true, code: "ENOENT" },
  { name: "exclusive dangling destination gives EEXIST without following link", dangling: true, exclusive: true, code: "EEXIST" },
  { name: "unrelated exclusive existing destination rejects without native copy", exclusive: true, code: "EEXIST" },
  { name: "distinct overwrite reaches native copy only after identity preflight" },
  { name: "default new destination copies complete binary payload", missingDestination: true },
  { name: "exclusive new destination copies complete binary payload", missingDestination: true, exclusive: true },
];

for (const row of rows) {
  test(row.name, async (context) => {
    const root = await native.mkdtemp(fileURLToPath(new URL(".native-fixture-", import.meta.url)));
    context.after(() => native.rm(root, { recursive: true, force: true }));
    const filesystem = await createRealFileSystem({ root });
    await filesystem.writeFile("/source", sentinel);
    const source = row.missingSource ? "/missing-source" : "/source";
    const destination = row.alias === "same-path" ? "/source" : "/target";
    if (row.alias === "hardlink") await filesystem.link("/source", destination);
    else if (row.alias === "symlink" || row.dangling) await filesystem.symlink(row.dangling ? "/absent" : "/source", destination);
    else if (row.alias !== "same-path" && !row.missingDestination) await filesystem.writeFile(destination, previous);
    const before = await snapshot(filesystem);
    const result = await traceNative(root, () => filesystem.copyFile(source, destination, { exclusive: row.exclusive ?? false }));
    const afterState = await snapshot(filesystem);
    observations.push({ name: row.name, source, destination, exclusive: row.exclusive ?? false, before, after: afterState, failure: errorRecord(result.failure), events: result.events });
    assert.deepEqual(afterState["/source"], before["/source"], "source bytes, identity and non-atime metadata are preserved");
    assert.deepEqual(await filesystem.readFile("/source"), sentinel);
    if (row.code) {
      assert.deepEqual(afterState, before, "all bytes, links, namespace and non-atime metadata survive rejection");
      assert.ok(result.failure instanceof FsError, `expected ${row.code}, received ${JSON.stringify(errorRecord(result.failure))}`);
      assert.equal(result.failure.code, row.code);
      assert.equal(result.failure.syscall, "copyFile");
      assert.equal(result.failure.path, source);
      assert.equal(result.failure.dest, destination);
      assert.deepEqual(result.events.filter((event) => event.phase === "call" && event.destructive), [], "preflight rejection must precede every potentially destructive native call, even if native would return the same error");
      if (row.alias) assert.deepEqual(await filesystem.readFile(destination), sentinel);
    } else {
      assert.equal(result.failure, undefined);
      assert.deepEqual(await filesystem.readFile(destination), sentinel);
      assert.deepEqual(Object.keys(afterState).sort(), ["/", "/source", "/target"]);
      const destructiveCalls = result.events.filter((event) => event.phase === "call" && event.destructive);
      assert.deepEqual(destructiveCalls, [{ method: "copyFile", phase: "call", path: "/source", destination: "/target", flags: row.missingDestination ? constants.COPYFILE_EXCL : 0, destructive: true }]);
      const copyIndex = result.events.indexOf(destructiveCalls[0]!);
      const sourceStatIndex = result.events.findIndex((event) => event.method === "stat" && event.phase === "return" && event.path === "/source" && event.bigint);
      const targetStatIndex = result.events.findIndex((event) => event.method === "lstat" && event.phase === (row.missingDestination ? "throw" : "return") && event.path === "/target" && event.bigint);
      assert.ok(sourceStatIndex >= 0 && targetStatIndex > sourceStatIndex && copyIndex > targetStatIndex, "completed source/target identity observations precede the native copy boundary");
      assert.equal(result.events[copyIndex + 1]?.method, "copyFile");
      assert.equal(result.events[copyIndex + 1]?.phase, "return");
    }
    if (row.alias && !row.exclusive) {
      const sourceIdentity = result.events.find((event) => event.method === "stat" && event.phase === "return" && event.path === "/source" && event.bigint);
      const targetIdentity = result.events.find((event) => event.method === "lstat" && event.phase === "return" && event.bigint);
      assert.ok(sourceIdentity && targetIdentity);
      assert.equal(targetIdentity.dev, sourceIdentity.dev);
      assert.equal(targetIdentity.ino, sourceIdentity.ino);
      assert.equal(targetIdentity.path, row.alias === "hardlink" ? "/target" : "/source");
    }
    if (row.dangling) assert.equal(result.events.some((event) => event.method === "readlink" && event.phase === "call" && event.path === "/target"), false);
    if (row.missingSource) assert.equal(result.events.some((event) => event.path === "/target"), false, "source resolution error wins before inspecting destination");
  });
}

after(async () => {
  if (process.env.NATIVE_IDENTITY_REVIEW_EVIDENCE) await native.writeFile(process.env.NATIVE_IDENTITY_REVIEW_EVIDENCE, `${JSON.stringify(observations, null, 2)}\n`);
});
