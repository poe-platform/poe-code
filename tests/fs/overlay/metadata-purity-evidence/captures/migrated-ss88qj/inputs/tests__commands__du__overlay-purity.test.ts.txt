import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import type { FileSystem } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createOverlayFileSystem } from "../../../src/fs/overlay/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { shellRun, trace, wrapped } from "./helpers.js";

const mutators = new Set(["writeFile", "appendFile", "writeStream", "mkdir", "rm", "rmdir",
  "rename", "copyFile", "symlink", "link", "chmod", "utimes", "truncate"]);

function observed(filesystem: FileSystem, layer: string, effects: string[]): FileSystem {
  return new Proxy(filesystem, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (mutators.has(String(property))) effects.push(`${layer}.${String(property)}`);
        return Reflect.apply(value, target, args);
      };
    },
  });
}

for (const view of ["direct", "readonly", "mount", "nested"] as const) {
  test(`strict DU ${view}: original pending-garbage fixture has zero backend mutations`, async context => {
    const upper = createMemoryFileSystem(); let denyCleanup = true; const mutations: string[] = [];
    const observedUpper = wrapped(upper, { async rm(path, options) {
      mutations.push(path);
      if (denyCleanup) throw new FsError("EACCES");
      return upper.rm(path, options);
    } });
    const effects: string[] = [];
    const overlay = createOverlayFileSystem({ upper: observed(observedUpper, "upper", effects),
      lower: observed(createMemoryFileSystem(), "lower", effects) });
    context.after(async () => { denyCleanup = false; await overlay.cleanup(); });
    await overlay.mkdir("/tree");
    const before = await upper.readdir("/");
    assert.ok(before.some(entry => entry.name.startsWith(".virtual-bash-overlay-")));
    mutations.length = 0; denyCleanup = false;
    effects.length = 0;
    let filesystem: FileSystem = overlay;
    if (view === "readonly") filesystem = createReadOnlyFileSystem(overlay);
    if (view === "mount") filesystem = createMountFileSystem({ root: overlay });
    if (view === "nested") filesystem = createOverlayFileSystem({ upper: createMemoryFileSystem(), lower: createReadOnlyFileSystem(overlay) });
    const checked = trace(filesystem); const result = await shellRun(checked.fs, ["-bs", "tree"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "0\ttree\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(checked.calls.map(call => call.method), ["lstat", "readdir"]);
    assert.deepEqual(mutations, [], "strict actual no backend mutations, not a positive-effect detector");
    assert.deepEqual(effects, [], "no other upper or lower mutation is allowed either");
    assert.deepEqual(await upper.readdir("/"), before);
  });
}
