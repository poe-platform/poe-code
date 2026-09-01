import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import receiptData from "../packages/safe-bash/integration-lint-audit/boundary-leaf-receipts.json";
import rootLinkOwnerData from "../packages/safe-bash/integration-lint-audit/root-claude-link-owner.json";

import { BOUNDARY_RECEIPTS, createLintInputGuard } from "./lint-input-guard.mjs";
import * as guardedInputs from "./lint-input-guard.mjs";
import { verifyLintInventory } from "../packages/safe-bash/scripts/integration-inputs.mjs";
import { readRegularInput } from "../packages/safe-bash/scripts/typecheck-integration-inputs.mjs";
import { createLintSelection, lintRoot, main, parseLintArguments, printLintResult } from "./lint-eslint.mjs";

const root = "/lint-owned";
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const boundaries = { heldSourceFiles: ["src/commands/xan/index.ts"], heldEvidenceDirectories: ["tests/held-capture"] };

function model(extra: Record<string, string> = {}, observation: "all" | "opens" = "all") {
  const packet = structuredClone(receiptData);
  const files: Record<string, string> = { ...extra };
  const inventory: { records: unknown[] } = { records: [] };
  for (const record of packet.records) {
    for (const owner of record.owners) {
      const text = record.path === "CLAUDE.md" ? JSON.stringify(rootLinkOwnerData) : owner.path.endsWith(".json") ? JSON.stringify({ owner: owner.path }) : "export default 1;";
      files[owner.path] = text;
      owner.bytes = Buffer.byteLength(text);
      owner.sha256 = digest(text);
    }
    if (record.inventoryRecord) {
      inventory.records.push({ id: record.inventoryRecord, owners: record.owners.map(({ path, bytes, sha256 }) => ({ path: path.slice("packages/safe-bash/".length), bytes, sha256 })), symlinks: [{ path: record.path.slice("packages/safe-bash/".length), target: record.target }], members: [record.companion] });
    }
  }
  const inventoryText = JSON.stringify(inventory);
  packet.inventory.bytes = Buffer.byteLength(inventoryText);
  packet.inventory.sha256 = digest(inventoryText);
  files[packet.inventory.path] = inventoryText;
  const receiptText = JSON.stringify(packet);
  files[BOUNDARY_RECEIPTS.path] = receiptText;
  const binding = { path: BOUNDARY_RECEIPTS.path, bytes: Buffer.byteLength(receiptText), sha256: digest(receiptText) };
  const volume = Volume.fromJSON(Object.fromEntries(Object.entries(files).map(([path, text]) => [root + "/" + path, text])));
  const symlinkSizes = new Map<string, number>();
  const symlinkSync = volume.symlinkSync.bind(volume);
  volume.symlinkSync = (...args) => {
    const result = symlinkSync(...args);
    symlinkSizes.set(String(args[1]), Buffer.isBuffer(args[0]) ? args[0].length : Buffer.byteLength(String(args[0])));
    return result;
  };
  for (const record of packet.records) {
    volume.mkdirSync(dirname(root + "/" + record.path), { recursive: true });
    if (record.kind === "symlink") volume.symlinkSync(record.target!, root + "/" + record.path);
    else volume.writeFileSync(root + "/" + record.path, "receipt leaf must not be read");
  }
  const memory = createFsFromVolume(volume);
  const operations: { method: string; path: string }[] = [];
  const fileSystem = { ...memory, constants: fs.constants };
  for (const method of ["lstatSync", "realpathSync", "readdirSync", "readlinkSync", "openSync"] as const) {
    const original = memory[method].bind(memory) as (...args: any[]) => any;
    (fileSystem as any)[method] = (...args: any[]) => {
      const path = String(args[0]);
      if (observation === "all" || method === "openSync") operations.push({ method, path });
      const result = original(...args);
      if (method === "lstatSync" && result.isSymbolicLink() && symlinkSizes.has(String(args[0]))) result.size = symlinkSizes.get(String(args[0]));
      return result;
    };
  }
  const config = [
    { ignores: packet.records.filter(record => record.selection === "ignored").map(record => record.path) },
    { files: ["**/*.js", "**/*.mjs", "**/*.cjs"], rules: { "no-undef": "error", "no-unused-vars": "warn" } },
    { files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"], languageOptions: { parser: tseslint.parser }, rules: { "no-undef": "error" } }
  ];
  return { packet, binding, volume, memory, fileSystem, operations, config, guard: createLintInputGuard({ root, boundaries, fileSystem }) };
}

function receiptPayloads(state: ReturnType<typeof model>) {
  const leaves = new Set(state.packet.records.map(record => root + "/" + record.path));
  return state.operations.filter(operation => operation.method === "openSync" && leaves.has(operation.path));
}

async function referenceFiles(state: ReturnType<typeof model>, config: unknown[]) {
  const underRoot = (value: unknown) => typeof value === "string" && (value === root || value.startsWith(root + "/"));
  for (const method of ["stat", "readdir", "readFile", "unlink"] as const) {
    const original = fs.promises[method].bind(fs.promises) as (...args: any[]) => any;
    vi.spyOn(fs.promises, method).mockImplementation(((...args: any[]) => {
      if (underRoot(args[0])) return (state.memory.promises[method] as any)(...args);
      if (String(args[0]).includes("/packages/safe-bash/tests/")) throw new Error("real fixture access forbidden");
      return original(...args);
    }) as any);
  }
  const originalExists = fs.existsSync;
  vi.spyOn(fs, "existsSync").mockImplementation(path => underRoot(path) ? state.memory.existsSync(path as string) : originalExists(path));
  const engine = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: [...config, { files: ["**/*.ts"] }] as any });
  try {
    return await engine.lintFiles(["."]);
  } finally {
    vi.restoreAllMocks();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("fixture operation observation retention", () => {
  it("retains full observations and symlink correction by default", () => {
    const state = model({ "src/member.js": "export {};" });
    const absolute = root + "/src/member.js";
    const link = state.packet.records.find((record) => record.kind === "symlink")!;
    const linkPath = root + "/" + link.path;
    expect(state.fileSystem.lstatSync(absolute)).toEqual(state.memory.lstatSync(absolute));
    expect(state.fileSystem.realpathSync(absolute)).toBe(absolute);
    expect(state.fileSystem.readdirSync(root + "/src")).toContain("member.js");
    expect(state.fileSystem.readlinkSync(linkPath)).toBe(link.target);
    expect(state.fileSystem.lstatSync(linkPath).size).toBe(Buffer.byteLength(link.target!));
    const descriptor = state.fileSystem.openSync(absolute, fs.constants.O_RDONLY);
    state.fileSystem.closeSync(descriptor);
    expect(state.operations).toEqual([
      { method: "lstatSync", path: absolute },
      { method: "realpathSync", path: absolute },
      { method: "readdirSync", path: root + "/src" },
      { method: "readlinkSync", path: linkPath },
      { method: "lstatSync", path: linkPath },
      { method: "openSync", path: absolute }
    ]);
  });

  it.each(["all", "opens"] as const)(
    "retains ordered attempted opens including errors with %s observations",
    (observation) => {
      const state = model({ "src/member.js": "export {};" }, observation);
      const absolute = root + "/src/member.js";
      const missing = root + "/src/missing.js";
      state.fileSystem.lstatSync(absolute);
      const first = state.fileSystem.openSync(absolute, fs.constants.O_RDONLY);
      state.fileSystem.closeSync(first);
      expect(() => state.fileSystem.openSync(missing, fs.constants.O_RDONLY)).toThrow("ENOENT");
      const second = state.fileSystem.openSync(absolute, fs.constants.O_RDONLY);
      state.fileSystem.closeSync(second);
      const opens = [
        { method: "openSync", path: absolute },
        { method: "openSync", path: missing },
        { method: "openSync", path: absolute }
      ];
      expect(state.operations.filter((operation) => operation.method === "openSync")).toEqual(
        opens
      );
      expect(state.operations).toEqual(
        observation === "all" ? [{ method: "lstatSync", path: absolute }, ...opens] : opens
      );
    }
  );

  it.each(["all", "opens"] as const)(
    "evaluates observation spelling before forwarding the original invalid argument with %s observations",
    (observation) => {
      const state = model({}, observation);
      const effects: string[] = [];
      const argument = {
        toString() {
          expect(state.operations).toEqual([]);
          effects.push("string");
          return root;
        }
      };
      expect(() => state.fileSystem.lstatSync(argument as unknown as string)).toThrow(TypeError);
      expect(effects).toEqual(["string"]);
      expect(state.operations).toEqual(
        observation === "all" ? [{ method: "lstatSync", path: root }] : []
      );
    }
  );

  it("preserves actual guard call order, results and counters with open-only observations", async () => {
    const runs = [];
    for (const observation of ["all", "opens"] as const) {
      const state = model({ "src/member.js": "export const value = 1;" }, observation);
      const fileSystem = state.fileSystem as typeof state.fileSystem & Pick<Volume, "fstatSync">;
      const calls: { method: string; arguments: unknown[] }[] = [];
      const descriptors = new Map<number, string>();
      for (const method of [
        "lstatSync",
        "realpathSync",
        "readdirSync",
        "readlinkSync",
        "openSync",
        "fstatSync",
        "readSync",
        "closeSync"
      ] as const) {
        const original = fileSystem[method].bind(fileSystem) as (...args: any[]) => any;
        vi.spyOn(fileSystem, method).mockImplementation(((...args: any[]) => {
          const observed = [...args];
          if (typeof args[0] === "number") {
            expect(descriptors.has(args[0])).toBe(true);
            observed[0] = { openedPath: descriptors.get(args[0]) };
          }
          calls.push({ method, arguments: observed });
          const result = original(...args);
          if (method === "openSync") {
            expect(descriptors.has(result)).toBe(false);
            descriptors.set(result, args[0]);
          }
          if (method === "closeSync") descriptors.delete(args[0]);
          return result;
        }) as any);
      }
      const result = await lintRoot({
        guard: state.guard,
        config: state.config,
        receiptBinding: state.binding
      });
      expect(result).toMatchObject({ complete: true, exitCode: 0 });
      expect(descriptors.size).toBe(0);
      runs.push({ state, calls, result });
    }
    expect(runs[1].calls).toEqual(runs[0].calls);
    expect(runs[1].result.results).toEqual(runs[0].result.results);
    expect(runs[1].result.scope).toEqual(runs[0].result.scope);
    expect(runs[1].result.counters).toEqual(runs[0].result.counters);
    expect(runs[1].state.operations.every((operation) => operation.method === "openSync")).toBe(
      true
    );
    expect(runs[1].state.operations).toEqual(
      runs[0].state.operations.filter((operation) => operation.method === "openSync")
    );
    expect(receiptPayloads(runs[1].state)).toEqual(receiptPayloads(runs[0].state));
  });
});

describe("fixed guarded root lint arguments", () => {
  it("preserves defaults and bounded output forwarding", () => {
    expect(parseLintArguments([])).toEqual({ format: "stylish", maxWarnings: -1 });
    expect(parseLintArguments(["--format=json", "--max-warnings", "0"])).toEqual({ format: "json", maxWarnings: 0 });
    expect(parseLintArguments(["-f", "stylish", "--max-warnings=-1"])).toEqual({ format: "stylish", maxWarnings: -1 });
  });
  it.each([["--fix"], ["--config", "other.mjs"], ["--ext", "json"], ["--quiet"], ["--cache"], ["--stdin"], ["--format", "./evil.mjs"], ["--format", "third-party"], ["src"], ["--max-warnings", "0.5"], ["--max-warnings", "-2"]])("rejects unsupported argv %j before reads", async (...argv) => {
    const fileSystem = new Proxy({}, { get() { throw new Error("filesystem accessed before argv refusal"); } });
    const stderr = { write: vi.fn() };
    expect(await main({ argv, root, fileSystem, stderr, stdout: { write: vi.fn() } })).toBe(2);
    expect(stderr.write).toHaveBeenCalled();
  });
  it("does not initialize current config before Phase 2 wiring", async () => {
    const state = model({ "package.json": JSON.stringify({ scripts: { "lint:eslint": "eslint . --ext ts" } }) });
    const loadConfig = vi.fn();
    const code = await main({ argv: [], root, fileSystem: state.fileSystem, loadConfig, stdout: { write: vi.fn() }, stderr: { write: vi.fn() } });
    expect(code).toBe(2);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(state.operations.filter(operation => operation.method === "openSync").map(operation => operation.path)).toEqual([root + "/package.json"]);
  });
});


describe("outside-checkout ancestor policy", () => {
  function owned(kind: string, operation: (state: any) => void, host: { fileSystem: any; temporaryRoot: string } = { fileSystem: fs, temporaryRoot: os.tmpdir() }) {
    const base = kind === "real" ? host.fileSystem : createFsFromVolume(new Volume());
    const temporary = kind === "real" ? base.mkdtempSync(join(base.realpathSync(host.temporaryRoot), "lint-ancestor-policy-")) : "/lint-policy-owned";
    try {
      const outside = temporary + "/outside";
      const checkout = outside + "/checkout";
      const tree = checkout + "/tree";
      base.mkdirSync(tree, { recursive: true });
      base.writeFileSync(tree + "/member.js", "export {};\n");
      const operations: { method: string; path: string }[] = [];
      const hooks: { listed?: (absolute: string) => void; stat?: (absolute: string, stat: any) => any } = {};
      const fileSystem: any = { ...base, constants: fs.constants };
      for (const method of ["lstatSync", "readdirSync", "realpathSync", "openSync"] as const) {
        fileSystem[method] = (...args: any[]) => {
          operations.push({ method, path: String(args[0]) });
          const value = (base[method] as any)(...args);
          if (method === "readdirSync") hooks.listed?.(String(args[0]));
          return method === "lstatSync" && hooks.stat ? hooks.stat(String(args[0]), value) : value;
        };
      }
      const guard = createLintInputGuard({ root: checkout, boundaries, fileSystem });
      operation({ base, temporary, outside, checkout, tree, operations, hooks, fileSystem, guard });
    } finally {
      if (kind === "real") base.rmSync(temporary, { recursive: true, force: true });
    }
  }

  function afterListing(state: any, directory: string, change: () => void) {
    let changed = false;
    state.hooks.listed = (absolute: string) => {
      if (!changed && absolute === directory) {
        changed = true;
        change();
      }
    };
  }

  it.each([
    ["Linux", "/owned-linux-tmp", "/owned-linux-tmp"],
    ["macOS alias", "/tmp", "/private/tmp"],
  ])("canonicalizes the %s OS temporary root before allocating the owned fixture", (_profile, temporaryRoot, canonicalRoot) => {
    vi.spyOn(os, "tmpdir").mockReturnValue(temporaryRoot);
    const canonicalize = vi.spyOn(fs, "realpathSync").mockReturnValue(canonicalRoot);
    const failure = new Error("owned allocation refused");
    const allocate = vi.spyOn(fs, "mkdtempSync").mockImplementation(() => { throw failure; });
    expect(() => owned("real", () => {})).toThrow(failure);
    expect(canonicalize).toHaveBeenCalledExactlyOnceWith(temporaryRoot);
    expect(allocate).toHaveBeenCalledExactlyOnceWith(`${canonicalRoot}/lint-ancestor-policy-`);
  });

  it("does not allocate a fixture when the OS temporary root cannot be canonicalized", () => {
    vi.spyOn(os, "tmpdir").mockReturnValue("/missing-owned-tmp");
    const failure = new Error("temporary root unavailable");
    vi.spyOn(fs, "realpathSync").mockImplementation(() => { throw failure; });
    const allocate = vi.spyOn(fs, "mkdtempSync").mockImplementation(() => { throw new Error("unexpected allocation"); });
    expect(() => owned("real", () => {})).toThrow(failure);
    expect(allocate).not.toHaveBeenCalled();
  });

  function refusal(operation: () => any) {
    try {
      const result = operation();
      if (Object.hasOwn(result, "failure")) return result.failure;
      return [...result.inspections.values()].find((entry: any) => Object.hasOwn(entry, "error"))?.error;
    } catch (error) {
      return error;
    }
  }

  it("creates and cleans the real-fixture shape without a Darwin temporary namespace", () => {
    const volume = Volume.fromJSON({ "/tmp/retained": "untouched" });
    const memory = createFsFromVolume(volume);
    owned("real", state => {
      expect(state.temporary.startsWith("/tmp/lint-ancestor-policy-")).toBe(true);
      expect(state.guard.read("tree/member.js").toString()).toBe("export {};\n");
      expect(state.guard.snapshot()).toMatchObject({ opens: 1, closes: 1, failed: false });
    }, { fileSystem: memory, temporaryRoot: "/tmp" });
    expect(volume.readdirSync("/tmp")).toEqual(["retained"]);
    expect(volume.existsSync("/private")).toBe(false);
  });

  it("canonicalizes a temporary-directory alias before literal fixture admission", () => {
    const volume = Volume.fromJSON({ "/canonical/tmp/retained": "untouched" });
    volume.symlinkSync("/canonical/tmp", "/tmp");
    const memory = createFsFromVolume(volume);
    owned("real", state => {
      expect(state.temporary.startsWith("/canonical/tmp/lint-ancestor-policy-")).toBe(true);
      expect(state.guard.read("tree/member.js").toString()).toBe("export {};\n");
      expect(state.operations.some((entry: any) => entry.path.startsWith("/tmp/"))).toBe(false);
    }, { fileSystem: memory, temporaryRoot: "/tmp" });
    expect(volume.readlinkSync("/tmp")).toBe("/canonical/tmp");
    expect(volume.readdirSync("/canonical/tmp")).toEqual(["retained"]);
  });

  it("cleans the allocated real-fixture directory when setup fails before admission", () => {
    const volume = Volume.fromJSON({ "/private/tmp/retained": "untouched" });
    const memory = createFsFromVolume(volume);
    const primary = new Error("fixture setup failed");
    const callback = vi.fn();
    vi.spyOn(memory, "mkdirSync").mockImplementationOnce(() => { throw primary; });
    expect(() => owned("real", callback, { fileSystem: memory, temporaryRoot: "/private/tmp" })).toThrow(primary);
    expect(callback).not.toHaveBeenCalled();
    expect(volume.readdirSync("/private/tmp")).toEqual(["retained"]);
  });

  it.each(["memory", "real"])("accepts external sibling namespace churn on %s without accepting internal mutation", kind => owned(kind, state => {
    const before = state.base.lstatSync(state.tree + "/member.js");
    afterListing(state, state.tree, () => state.base.mkdirSync(state.outside + "/new-sibling"));
    const result = state.guard.directory("tree", true);
    expect(result.failure).toBeUndefined();
    expect(result.inspections.get("member.js")).toEqual({ kind: "file" });
    expect(state.guard.read("tree/member.js", "subject").toString()).toBe("export {};\n");
    const after = state.base.lstatSync(state.tree + "/member.js");
    for (const field of ["dev", "ino", "size", "mode", "nlink", "mtimeMs", "ctimeMs"]) expect(after[field]).toBe(before[field]);
    expect(state.guard.snapshot()).toMatchObject({ opens: 1, closes: 1 });
  }));

  it.each(["memory", "real"])("permits external parent churn in a checkout-root directory operation on %s", kind => owned(kind, state => {
    afterListing(state, state.checkout, () => state.base.mkdirSync(state.outside + "/new-sibling"));
    const result = state.guard.directory("", true);
    expect(result.failure).toBeUndefined();
    expect(result.inspections.get("tree")).toEqual({ kind: "directory" });
  }));

  it.each(["memory", "real"])("rejects internal namespace churn before child metadata on %s", kind => owned(kind, state => {
    afterListing(state, state.tree, () => state.base.mkdirSync(state.tree + "/new-sibling"));
    expect(refusal(() => state.guard.directory("tree", true))).toBeInstanceOf(Error);
    expect(state.operations.some((entry: any) => entry.path === state.tree + "/member.js")).toBe(false);
  }));

  it.each(["size", "nlink", "mtimeMs", "ctimeMs"])("relaxes only external %s equality, not root or internal fields", field => {
    for (const location of ["outside", "checkout", "tree"]) owned("memory", state => {
      let changed = false;
      afterListing(state, state.tree, () => { changed = true; });
      state.hooks.stat = (absolute: string, stat: any) => {
        if (changed && absolute === state[location]) stat[field] += 1.25;
        return stat;
      };
      const error = refusal(() => state.guard.directory("tree", true));
      if (location === "outside") expect(error).toBeUndefined();
      else {
        expect(error).toBeInstanceOf(Error);
        expect(state.operations.some((entry: any) => entry.path === state.tree + "/member.js")).toBe(false);
      }
    });
  });

  it.each(["dev", "ino", "mode"])("rejects external and filesystem-root %s changes before child metadata", field => {
    for (const location of ["outside", "/"]) owned("memory", state => {
      let changed = false;
      afterListing(state, state.tree, () => { changed = true; });
      state.hooks.stat = (absolute: string, stat: any) => {
        if (changed && absolute === (location === "/" ? "/" : state.outside)) stat[field] += 1;
        return stat;
      };
      expect(refusal(() => state.guard.directory("tree", true))).toBeInstanceOf(Error);
      expect(state.operations.some((entry: any) => entry.path === state.tree + "/member.js")).toBe(false);
    });
  });

  it.each(["memory", "real"])("rejects ancestor replacement and case-only rename on %s before child metadata", kind => {
    for (const replacement of ["directory", "symlink", "case"]) owned(kind, state => {
      afterListing(state, state.tree, () => {
        const renamed = state.temporary + (replacement === "case" ? "/OUTSIDE" : "/old-outside");
        state.base.renameSync(state.outside, renamed);
        if (replacement === "symlink") state.base.symlinkSync(renamed, state.outside);
        if (replacement === "directory") {
          state.base.mkdirSync(state.tree, { recursive: true });
          state.base.writeFileSync(state.tree + "/member.js", "replacement");
        }
      });
      expect(refusal(() => state.guard.directory("tree", true))).toBeInstanceOf(Error);
      expect(state.operations.some((entry: any) => entry.path === state.tree + "/member.js")).toBe(false);
    });
  });

  it("checks fresh exact ancestor spelling even when metadata and canonical values alias", () => owned("memory", state => {
    let changed = false;
    afterListing(state, state.tree, () => { changed = true; });
    const original = state.fileSystem.readdirSync;
    state.fileSystem.readdirSync = (absolute: string, options: any) => {
      const values = original(absolute, options);
      return changed && absolute === state.temporary ? values.map((name: Buffer) => name.equals(Buffer.from("outside")) ? Buffer.from("OUTSIDE") : name) : values;
    };
    const error = refusal(() => state.guard.directory("tree", true));
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/spelling/);
    expect(state.operations.some((entry: any) => entry.path === state.outside && entry.method === "lstatSync")).toBe(true);
    expect(state.operations.some((entry: any) => entry.path === state.tree + "/member.js")).toBe(false);
  }));

  it("refuses a newly aliased child spelling before its metadata", () => owned("memory", state => {
    let listings = 0;
    const original = state.fileSystem.readdirSync;
    state.fileSystem.readdirSync = (absolute: string, options: any) => {
      const values = original(absolute, options);
      return absolute === state.tree && ++listings > 1 ? [Buffer.from("MEMBER.js")] : values;
    };
    expect(refusal(() => state.guard.directory("tree", true))).toBeInstanceOf(Error);
    expect(state.operations.some((entry: any) => entry.path === state.tree + "/member.js")).toBe(false);
  }));

  it("refuses canonical alias and filesystem-root kind drift before child metadata", () => {
    for (const field of ["canonical", "kind"]) owned("memory", state => {
      let changed = false;
      afterListing(state, state.tree, () => { changed = true; });
      const original = state.fileSystem.realpathSync;
      state.fileSystem.realpathSync = (absolute: string) => changed && absolute === state.outside && field === "canonical" ? state.outside.toUpperCase() : original(absolute);
      state.hooks.stat = (absolute: string, stat: any) => {
        if (changed && absolute === "/" && field === "kind") stat.isDirectory = () => false;
        return stat;
      };
      expect(refusal(() => state.guard.directory("tree", true))).toBeInstanceOf(Error);
      expect(state.operations.some((entry: any) => entry.path === state.tree + "/member.js")).toBe(false);
    });
  });

  it.each([[1.25, 1.5], [1, 1n], [-0, 0], [Infinity, -Infinity], ["1", 1]])("attributes exact scalar operands %s versus %s without wrapping", (expected, observed) => owned("memory", state => {
    state.hooks.stat = (absolute: string, stat: any) => {
      if (absolute === state.tree + "/member.js") stat.mtimeMs = expected;
      return stat;
    };
    const original = state.fileSystem.fstatSync;
    state.fileSystem.fstatSync = (descriptor: number) => ({ ...original(descriptor), isFile: () => true, isSymbolicLink: () => false, mtimeMs: observed });
    let error: any;
    try { state.guard.read("tree/member.js"); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(error.actual).toBe(observed);
    expect(error.expected).toBe(expected);
    expect(error.message).toContain('"path":');
    expect(error.message).toContain(state.tree + "/member.js");
    expect(error.message).toContain('"phase":"descriptor-before"');
    expect(error.message).toContain('"field":"mtimeMs"');
    expect(error.message).toContain('"expected":');
    expect(error.message).toContain('"observed":');
    expect(error.message.length).toBeLessThan(2048);
    expect(state.guard.snapshot()).toMatchObject({ opens: 1, closes: 1 });
  }));

  it.each([undefined, null, false, 0, "", new Error("close")])("retains attributed primary then exact close reason %s", closeReason => owned("memory", state => {
    const original = state.fileSystem.fstatSync;
    state.fileSystem.fstatSync = (descriptor: number) => {
      const stat = original(descriptor);
      stat.mtimeMs += 0.25;
      return stat;
    };
    const close = state.fileSystem.closeSync;
    const closeSync = vi.fn((descriptor: number) => { close(descriptor); throw closeReason; });
    state.fileSystem.closeSync = closeSync;
    let error: any;
    try { state.guard.read("tree/member.js"); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toHaveLength(2);
    expect(error.errors[0].message).toContain('"phase":"descriptor-before"');
    expect(error.errors[1]).toBe(closeReason);
    expect(closeSync).toHaveBeenCalledTimes(1);
  }));

  it("retains real fractional timestamps through fresh descriptor admission", () => owned("real", state => {
    state.base.utimesSync(state.tree + "/member.js", 946684800.123456, 946684800.654321);
    const before = state.base.lstatSync(state.tree + "/member.js");
    expect(Number.isInteger(before.mtimeMs)).toBe(false);
    expect(state.guard.read("tree/member.js").toString()).toBe("export {};\n");
    const after = state.base.lstatSync(state.tree + "/member.js");
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(state.guard.snapshot()).toMatchObject({ opens: 1, closes: 1 });
  }));

  it("bounds and escapes attributed paths and operands without losing the assertion operands", () => owned("memory", state => {
    const relative = "tree/" + Array.from({ length: 20 }, () => "quoted\"segment").join("/") + "/member.js";
    state.base.mkdirSync(dirname(state.checkout + "/" + relative), { recursive: true });
    state.base.writeFileSync(state.checkout + "/" + relative, "owned");
    const expected = "quoted\"\n".repeat(100);
    state.hooks.stat = (absolute: string, stat: any) => {
      if (absolute === state.checkout + "/" + relative) stat.mtimeMs = expected;
      return stat;
    };
    let error: any;
    try { state.guard.read(relative); } catch (caught) { error = caught; }
    expect(error.actual).toBeTypeOf("number");
    expect(error.expected).toBe(expected);
    expect(error.message.length).toBeLessThan(4096);
    expect(error.message).not.toContain("\n");
    const attribution = JSON.parse(error.message.slice(error.message.indexOf("{")));
    expect(attribution.path).toBe((state.checkout + "/" + relative).slice(0, 256));
    expect(attribution.pathTruncated).toBe(true);
    expect(attribution.expected).toEqual({ type: "string", value: expected.slice(0, 96), truncated: true });
    expect(attribution.observed.type).toBe("number");
    expect(state.guard.snapshot()).toMatchObject({ opens: 1, closes: 1 });
  }));

  it("does not annotate or wrap frozen external read failures", () => owned("memory", state => {
    const reason = Object.freeze(new Error("external frozen error"));
    const before = Object.getOwnPropertyDescriptors(reason);
    state.fileSystem.fstatSync = () => { throw reason; };
    let error: any;
    try { state.guard.read("tree/member.js"); } catch (caught) { error = caught; }
    expect(error).toBe(reason);
    expect(Object.getOwnPropertyDescriptors(reason)).toEqual(before);
    expect(state.guard.snapshot()).toMatchObject({ opens: 1, closes: 1 });
  }));

  it("uses the explicit eight-million default and maximum with separate guard counters and exact refusal", () => {
    expect(guardedInputs.LIMITS.metadataOperations).toBe(8000000);
    const state = model({ "src/member.js": "export {};" });
    const bootstrap = createLintInputGuard({ root, fileSystem: state.fileSystem, bootstrap: true, limits: { metadataOperations: 8000000 } });
    expect(() => createLintInputGuard({ root, boundaries, fileSystem: state.fileSystem, limits: { metadataOperations: 8000001 } })).toThrow(/invalid input limit: metadataOperations/);
    state.guard.read("src/member.js");
    expect(bootstrap.snapshot().metadataOperations).toBe(0);
    const required = state.guard.snapshot().metadataOperations;
    for (const maximum of [required - 1, required, required + 1]) {
      const guard = createLintInputGuard({ root, boundaries, fileSystem: state.fileSystem, limits: { metadataOperations: maximum } });
      if (maximum < required) expect(() => guard.read("src/member.js")).toThrow(/metadata operation cap/);
      else expect(guard.read("src/member.js").toString()).toBe("export {};");
      expect(guard.snapshot().metadataOperations).toBe(Math.min(required, maximum));
    }
    expect(state.guard.snapshot().metadataOperations).toBe(required);
  });
});

describe("guarded literal content", () => {
  it.each(["", "export {};", "αβ😀"])("reads ordinary bytes and closes exactly once: %j", text => {
    const state = model({ "src/ordinary.ts": text });
    expect(state.guard.read("src/ordinary.ts", "subject").toString()).toBe(text);
    expect(state.guard.snapshot()).toMatchObject({ opens: 1, closes: 1, subjectBytes: Buffer.byteLength(text), failed: false });
  });
  it.each(["packages/safe-bash/src/commands/xan/held.ts", "packages/safe-bash/src/commands/XAN/held.ts", "PACKAGES/safe-bash/tests/held-capture/file.js", "packages/safe-bash/tests/HELD-CAPTURE/file.js", "../escape.js", "src/back\\slash.js"])("refuses %s before filesystem access", path => {
    const state = model();
    expect(() => state.guard.read(path, "subject")).toThrow();
    expect(state.operations).toEqual([]);
  });
  it("rejects root, ancestor and leaf links without opening targets", () => {
    for (const variant of ["root", "ancestor", "leaf"]) {
      const volume = Volume.fromJSON({ "/target/file.js": "forbidden()" });
      if (variant === "root") volume.symlinkSync("/target", root);
      else {
        volume.mkdirSync(root + "/src", { recursive: true });
        volume.symlinkSync("/target" + (variant === "leaf" ? "/file.js" : ""), root + "/src/link");
      }
      const memory = createFsFromVolume(volume);
      const openSync = vi.fn(memory.openSync.bind(memory));
      const guard = createLintInputGuard({ root, boundaries, fileSystem: { ...memory, constants: fs.constants, openSync } });
      expect(() => guard.read(variant === "root" ? "file.js" : variant === "ancestor" ? "src/link/file.js" : "src/link", "subject")).toThrow();
      expect(openSync).not.toHaveBeenCalled();
    }
  });
  it("refuses hardlink aliases", () => {
    const state = model({ "src/source.js": "export {};" });
    state.volume.linkSync(root + "/src/source.js", root + "/src/alias.js");
    expect(() => state.guard.read("src/alias.js", "subject")).toThrow(/link/);
    expect(state.operations.some(operation => operation.method === "openSync")).toBe(false);
  });
  it("poisons after close failure and never retries content", () => {
    const state = model({ "src/file.js": "export {};" });
    const closeSync = vi.fn(() => { throw new Error("close failed"); });
    const guard = createLintInputGuard({ root, boundaries, fileSystem: { ...state.fileSystem, closeSync } });
    expect(() => guard.read("src/file.js", "subject")).toThrow("close failed");
    expect(() => guard.read("src/file.js", "subject")).toThrow(/failed/);
    expect(closeSync).toHaveBeenCalledTimes(1);
    expect(guard.snapshot()).toMatchObject({ opens: 1, closes: 0, failed: true });
  });
  it("enforces a cap without opening an oversized subject", () => {
    const state = model({ "src/file.js": "12345" });
    const guard = createLintInputGuard({ root, boundaries, fileSystem: state.fileSystem, limits: { fileBytes: 4 } });
    expect(() => guard.read("src/file.js", "subject")).toThrow(/cap/);
    expect(guard.snapshot().opens).toBe(0);
  });
});

describe("selection and immutable metadata leaves", () => {
  it("retains additive TS selection without inferring MTS or TSX from its parser", async () => {
    const state = model({ "src/extra.ts": "const value: number = 1; missing();", "src/unconfigured.mts": "missingMts();", "src/unconfigured.tsx": "missingTsx();", "src/ordinary.js": "missingJs();" });
    const config = [state.config[0], { languageOptions: { parser: tseslint.parser }, rules: { "no-undef": "error" } }];
    const reference = await referenceFiles(state, config);
    const result = await lintRoot({ guard: state.guard, config, receiptBinding: state.binding });
    expect(result.complete).toBe(true);
    expect(result.results).toEqual(reference);
    expect(result.results.some((entry: any) => entry.filePath === root + "/src/extra.ts")).toBe(true);
    expect(result.results.some((entry: any) => entry.filePath.endsWith(".mts") || entry.filePath.endsWith(".tsx"))).toBe(false);
  });
  it("matches installed ESLint dot selection including negations and overrides", async () => {
    const state = model({
      "src/file.js": "unknownJs();", "src/file.ts": "const value: number = 1; unknownTs();", "src/file.mts": "unknownMts();", "src/file.cts": "unknownCts();", "src/file.tsx": "unknownTsx();", "src/file.cjs": "unknownCjs();", ".hidden/file.mjs": "unknownHidden();", "unconfigured/child.js": "unknownChild();", "unconfigured/note.data": "not javascript", "generated/drop.js": "drop();", "generated/keep.js": "keep();", "generated/sub/keep.mts": "keepNested();", "ignored/tree/file.js": "neverRead();"
    });
    const config = [...state.config, { ignores: ["generated/*", "!generated/keep.js", "!generated/sub/", "ignored/**"] }, { files: ["generated/keep.js"], rules: { "no-undef": "off" } }];
    const reference = await referenceFiles(state, config);
    const result = await lintRoot({ guard: state.guard, config, receiptBinding: state.binding });
    expect(result.complete).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.results).toEqual(reference);
    expect(result.receipts).toHaveLength(25);
    expect(receiptPayloads(state)).toEqual([]);
    expect(result.results.some((entry: any) => entry.filePath === root + "/unconfigured/child.js")).toBe(true);
  });
  it.each([{ basePath: "src", ignores: ["x"] }, { ignores: [() => true] }, { files: [() => true] }, () => ({ rules: {} })])("rejects unsupported projection before discovery", config => {
    expect(() => createLintSelection(root, [config])).toThrow(/unsupported/);
  });
  it("retains selected unclassified siblings after a denied subtree", async () => {
    const state = model({ "src/valid.js": "missing();" });
    state.volume.mkdirSync(root + "/new-boundary");
    state.volume.symlinkSync("/unreadable", root + "/new-boundary/link");
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(result.complete).toBe(false);
    expect(result.results.some((entry: any) => entry.filePath === root + "/src/valid.js" && entry.errorCount === 1)).toBe(true);
    expect(result.gaps).toEqual([expect.objectContaining({ path: "new-boundary/link", descendantsUnknown: true })]);
    expect(state.operations.some(operation => operation.path === "/unreadable")).toBe(false);
  });
  it("unknown selected JS links cannot use noncode metadata dispositions", async () => {
    const state = model({ "new/target.data": "neverRead();" });
    state.volume.symlinkSync("target.data", root + "/new/input.js");
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(result.gaps.some((gap: any) => gap.path === "new/input.js")).toBe(true);
    expect(state.operations.some(operation => operation.method === "openSync" && operation.path === root + "/new/target.data")).toBe(false);
  });
  it("checks expected leaf kind before directory enumeration", async () => {
    const state = model();
    const record = state.packet.records.find(entry => entry.kind === "symlink")!;
    const absolute = root + "/" + record.path;
    state.volume.unlinkSync(absolute);
    state.volume.mkdirSync(absolute);
    state.volume.writeFileSync(absolute + "/unread.js", "neverRead();");
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(state.operations.some(operation => operation.method === "readdirSync" && operation.path === absolute)).toBe(false);
    expect(state.operations.some(operation => operation.path.startsWith(absolute + "/"))).toBe(false);
  });
  it("owner drift fails before receipt leaf metadata", async () => {
    const state = model();
    state.volume.writeFileSync(root + "/" + state.packet.records[0].owners[0].path, "changed");
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    const leaves = new Set(state.packet.records.map(record => root + "/" + record.path));
    expect(result.exitCode).toBe(2);
    expect(state.operations.some(operation => leaves.has(operation.path))).toBe(false);
  });
  it("does not turn new configuration selection into a receipt waiver", async () => {
    const state = model();
    const result = await lintRoot({ guard: state.guard, config: [...state.config, { files: ["**/*.data"] }], receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(receiptPayloads(state)).toEqual([]);
  });
  it("refuses target-text drift without target operations", async () => {
    const state = model();
    const record = state.packet.records.find(entry => entry.kind === "symlink")!;
    state.volume.unlinkSync(root + "/" + record.path);
    state.volume.symlinkSync("/unread-target", root + "/" + record.path);
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(state.operations.some(operation => operation.path === "/unread-target")).toBe(false);
  });
  it("special leaf allowance never enters payload admission", () => {
    const state = model();
    const records = state.guard.loadReceipts(state.binding);
    expect(records).toHaveLength(25);
    expect(() => state.guard.read(records[0].path, "subject")).toThrow(/literal/);
    expect(receiptPayloads(state)).toEqual([]);
  });
  it("reports clean, warning-limit and incomplete exits distinctly", async () => {
    const clean = model();
    expect((await lintRoot({ guard: clean.guard, config: clean.config, receiptBinding: clean.binding })).exitCode).toBe(0);
    const warning = model({ "src/warning.js": "const unused = 1;" });
    expect((await lintRoot({ guard: warning.guard, config: warning.config, receiptBinding: warning.binding, maxWarnings: 0 })).exitCode).toBe(1);
    const incomplete = model();
    const limited = createLintInputGuard({ root, boundaries, fileSystem: incomplete.fileSystem, limits: { metadataOperations: 2 } });
    const result = await lintRoot({ guard: limited, config: incomplete.config, receiptBinding: incomplete.binding });
    expect(result.exitCode).toBe(2);
    expect(result.complete).toBe(false);
  });
  it("uses only explicit installed built-in formatter resources", async () => {
    const state = model();
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const formatter = vi.spyOn(result.eslint, "loadFormatter");
    await printLintResult(result, { format: "json", maxWarnings: -1 }, stdout, stderr);
    expect(formatter).toHaveBeenCalledWith(expect.stringContaining("/eslint/lib/cli-engine/formatters/json.js"));
    expect(JSON.parse(stdout.write.mock.calls[0][0])).toHaveLength(result.results.length);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('"complete":true'));
  });
});

describe("guard refusal and policy regression controls", () => {
  it("accepts separated negative warning defaults", () => {
    expect(parseLintArguments(["--max-warnings", "-1"])).toEqual({ format: "stylish", maxWarnings: -1 });
  });
  it("retains nonglobal ignore overrides and newly configured regular extensions", async () => {
    const state = model({ "src/kept.js": "missing();", "src/quiet.js": "missing();", "src/extra.custom": "missing();" });
    const config = [...state.config, { ignores: ["src/kept.js"], rules: { "no-undef": "off" } }, { files: ["**/*.custom"], rules: { "no-undef": "error" } }];
    const reference = await referenceFiles(state, config);
    vi.spyOn(ESLint.prototype, "isPathIgnored").mockImplementation(() => { throw new Error("directory shortcut forbidden"); });
    vi.spyOn(ESLint.prototype, "lintFiles").mockImplementation(() => { throw new Error("production fallback forbidden"); });
    const result = await lintRoot({ guard: state.guard, config, receiptBinding: state.binding });
    expect(result.complete).toBe(true);
    expect(result.results).toEqual(reference);
    expect(result.results.find((entry: any) => entry.filePath.endsWith("/kept.js"))?.errorCount).toBe(1);
    expect(result.results.find((entry: any) => entry.filePath.endsWith("/quiet.js"))?.errorCount).toBe(0);
    expect(result.results.find((entry: any) => entry.filePath.endsWith("/extra.custom"))?.errorCount).toBe(1);
  });
  it("global negation order remains observable", async () => {
    for (const ignores of [["src/drop.js", "!src/drop.js"], ["!src/drop.js", "src/drop.js"]]) {
      const state = model({ "src/drop.js": "missing();" });
      const config = [...state.config, { ignores }];
      const reference = await referenceFiles(state, config);
      const result = await lintRoot({ guard: state.guard, config, receiptBinding: state.binding });
      expect(result.complete).toBe(true);
      expect(result.results).toEqual(reference);
      expect(result.results.some((entry: any) => entry.filePath.endsWith("/drop.js"))).toBe(ignores[1].startsWith("!"));
    }
  });
  it.each(["dev", "ino", "size", "mode", "nlink", "mtimeMs", "ctimeMs"])("closes on post-read descriptor %s drift", field => {
    const state = model({ "src/file.js": "export {};" });
    let calls = 0;
    const fstatSync = (descriptor: number) => {
      const stat = state.memory.fstatSync(descriptor);
      if (++calls !== 2) return stat;
      return Object.defineProperty(Object.create(stat), field, { value: Number((stat as any)[field]) + 1 });
    };
    const closeSync = vi.fn(state.memory.closeSync.bind(state.memory));
    const guard = createLintInputGuard({ root, boundaries, fileSystem: { ...state.fileSystem, fstatSync, closeSync } });
    expect(() => guard.read("src/file.js", "subject")).toThrow();
    expect(closeSync).toHaveBeenCalledTimes(1);
    expect(guard.snapshot()).toMatchObject({ opens: 1, closes: 1, failed: true });
  });
  it("handles split UTF-8 reads without decoding partial chunks", () => {
    const text = "α😀z";
    const state = model({ "src/file.js": text });
    const readSync = (descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null) => state.memory.readSync(descriptor, buffer, offset, Math.min(length, 1), position);
    const guard = createLintInputGuard({ root, boundaries, fileSystem: { ...state.fileSystem, readSync } });
    expect(guard.read("src/file.js", "subject")).toEqual(Buffer.from(text));
    expect(guard.snapshot().readCalls).toBe(Buffer.byteLength(text));
  });
  it.each([0, -1, 1000])("rejects invalid descriptor read count %d and closes", count => {
    const state = model({ "src/file.js": "export {};" });
    const closeSync = vi.fn(state.memory.closeSync.bind(state.memory));
    const guard = createLintInputGuard({ root, boundaries, fileSystem: { ...state.fileSystem, readSync: () => count, closeSync } });
    expect(() => guard.read("src/file.js", "subject")).toThrow(/descriptor read/);
    expect(closeSync).toHaveBeenCalledTimes(1);
  });
  it("does not hand partial output to lint after a descriptor error", async () => {
    const state = model({ "src/file.js": "missing();" });
    const lintText = vi.spyOn(ESLint.prototype, "lintText");
    const original = state.memory.readSync.bind(state.memory);
    const fileSystem = { ...state.fileSystem, readSync(descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null) {
      const bytes = original(descriptor, buffer, offset, length, position);
      if (buffer.toString().startsWith("missing")) throw new Error("descriptor fault");
      return bytes;
    } };
    const guard = createLintInputGuard({ root, boundaries, fileSystem });
    const result = await lintRoot({ guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(result.failure?.message).toBe("descriptor fault");
    expect(lintText).not.toHaveBeenCalled();
    expect(guard.snapshot().opens).toBe(guard.snapshot().closes);
  });
  it("tracks a cap stop as incomplete rather than a complete shorter selection", async () => {
    const state = model({ "src/a.js": "export {};", "src/b.js": "export {};" });
    const guard = createLintInputGuard({ root, boundaries, fileSystem: state.fileSystem, limits: { subjects: 1 } });
    const result = await lintRoot({ guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(result.complete).toBe(false);
    expect(result.traversalFinished).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.scope).toMatchObject({ configured: 2, linted: 1 });
    expect(result.failure?.path).toBe("src/b.js");
  });
  it.each(["count", "nul", "owner-is-leaf", "unknown-group"])("rejects invalid receipt schema %s before owner access", mutation => {
    const state = model();
    const packet = structuredClone(state.packet);
    if (mutation === "count") packet.records.pop();
    if (mutation === "nul") packet.records[0].path += String.fromCharCode(0);
    if (mutation === "owner-is-leaf") packet.records[0].owners[0].path = packet.records[5].path;
    if (mutation === "unknown-group") packet.records[0].group = "unknown";
    const text = JSON.stringify(packet);
    state.volume.writeFileSync(root + "/" + state.binding.path, text);
    expect(() => state.guard.loadReceipts({ ...state.binding, bytes: Buffer.byteLength(text), sha256: digest(text) })).toThrow();
    expect(state.operations.filter(operation => operation.method === "openSync").map(operation => operation.path)).toEqual([root + "/" + state.binding.path]);
  });
  it("refuses receipt relocation even when the owner bytes are unchanged", async () => {
    const state = model();
    const record = state.packet.records[0];
    state.volume.renameSync(root + "/" + record.path, root + "/" + record.path + ".moved");
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(receiptPayloads(state)).toEqual([]);
  });
  it("refuses case aliases of a special literal receipt", async () => {
    const state = model();
    const record = state.packet.records[0];
    const variant = record.path.slice(0, record.path.lastIndexOf("/") + 1) + "BACK\\slash";
    state.volume.renameSync(root + "/" + record.path, root + "/" + variant);
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(state.operations.some(operation => operation.method === "openSync" && operation.path === root + "/" + variant)).toBe(false);
  });
  it("ordinary parsing errors retain exit one", async () => {
    const state = model({ "src/broken.js": "const = ;" });
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(1);
    expect(result.complete).toBe(true);
    expect(result.results.find((entry: any) => entry.filePath.endsWith("/broken.js"))?.fatalErrorCount).toBe(1);
  });
  it("prevents root command or config identity drift across loading", async () => {
    for (const target of ["package.json", "eslint.config.js"]) {
      const state = model({ "package.json": JSON.stringify({ scripts: { "lint:eslint": "node scripts/lint-eslint.mjs" } }), "eslint.config.js": "export default [];" });
      const loadConfig = vi.fn(async () => {
        state.volume.writeFileSync(root + "/" + target, "changed");
        return { default: state.config, lintInputGuard: state.guard };
      });
      const code = await main({ argv: [], root, fileSystem: state.fileSystem, loadConfig, stdout: { write: vi.fn() }, stderr: { write: vi.fn() } });
      expect(code).toBe(2);
      expect(receiptPayloads(state)).toEqual([]);
      expect(state.operations.some(operation => operation.method === "openSync" && operation.path === root + "/" + state.binding.path)).toBe(false);
    }
  });
  it("guards the config filesystem adapter without widening payload admission", () => {
    const state = model({ "src/file.js": "export {};" });
    expect(state.guard.fileSystem.readFileSync(root + "/src/file.js").toString()).toBe("export {};");
    expect(state.guard.fileSystem.readdirSync(root + "/src")).toEqual(["file.js"]);
    expect(() => state.guard.fileSystem.readFileSync("/outside/file.js")).toThrow(/outside/);
    expect(() => state.guard.fileSystem.readFileSync(root + "/src/file.js", "utf8")).toThrow(/options/);
  });
  it("exercises successful staged main only with injected memory config", async () => {
    const state = model({ "package.json": JSON.stringify({ scripts: { "lint:eslint": "node scripts/lint-eslint.mjs" } }), "eslint.config.js": "export default [];" });
    const realLoad = state.guard.loadReceipts;
    const guard = { ...state.guard, loadReceipts: () => realLoad(state.binding) };
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    expect(await main({ argv: ["--format", "json"], root, fileSystem: state.fileSystem, loadConfig: async () => ({ default: state.config, lintInputGuard: guard }), stdout, stderr })).toBe(0);
    expect(JSON.parse(stderr.write.mock.calls[0][0])).toMatchObject({ complete: true, exitCode: 0 });
    expect(receiptPayloads(state)).toEqual([]);
  });
});

describe("final scope accounting controls", () => {
  it("prints unfinished selection rather than hiding cap gaps", async () => {
    const state = model({ "src/a.js": "export {};", "src/b.js": "export {};", "src/c.js": "export {};" });
    const guard = createLintInputGuard({ root, boundaries, fileSystem: state.fileSystem, limits: { subjects: 1 } });
    const result = await lintRoot({ guard, config: state.config, receiptBinding: state.binding });
    const stderr = { write: vi.fn() };
    await printLintResult(result, { format: "json", maxWarnings: -1 }, { write: vi.fn() }, stderr);
    expect(JSON.parse(stderr.write.mock.calls[0][0])).toMatchObject({ exitCode: 2, complete: false, unprocessed: result.unprocessed });
    expect(result.unprocessed.entries).toContain("src/c.js");
    expect(result.unprocessed.descendantsUnknown).toBe(true);
  });
  it("reports separate fixed bootstrap authentication counters", async () => {
    const state = model({ "package.json": JSON.stringify({ scripts: { "lint:eslint": "node scripts/lint-eslint.mjs" } }), "eslint.config.js": "export default [];" });
    const realLoad = state.guard.loadReceipts;
    const guard = { ...state.guard, loadReceipts: () => realLoad(state.binding) };
    const stderr = { write: vi.fn() };
    expect(await main({ argv: ["--format", "json"], root, fileSystem: state.fileSystem, loadConfig: async () => ({ default: state.config, lintInputGuard: guard }), stdout: { write: vi.fn() }, stderr })).toBe(0);
    expect(JSON.parse(stderr.write.mock.calls[0][0])).toMatchObject({ bootstrapCounters: { subjects: 0, opens: 2, closes: 2 } });
  });
  it("does not access globally ignored held descendants", async () => {
    const held = "packages/safe-bash/tests/held-capture";
    const state = model({ [held + "/payload.js"]: "mustNotRead();", "src/ordinary.js": "missing();" });
    const config = [...state.config, { ignores: [held + "/**"] }];
    const result = await lintRoot({ guard: state.guard, config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(1);
    expect(result.scope.heldExcluded).toBe(1);
    expect(state.operations.filter(operation => operation.path === root + "/" + held || operation.path.startsWith(root + "/" + held + "/"))).toEqual([]);
  });
  it("retains held case aliases as gaps without accessing them", async () => {
    const held = "packages/safe-bash/tests/HELD-CAPTURE";
    const state = model({ [held + "/payload.js"]: "mustNotRead();", "src/ordinary.js": "missing();" });
    const config = [...state.config, { ignores: ["packages/safe-bash/tests/held-capture/**"] }];
    const result = await lintRoot({ guard: state.guard, config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(result.gaps.map((entry: any) => entry.path)).toEqual([held]);
    expect(result.results.some((entry: any) => entry.filePath.endsWith("/ordinary.js"))).toBe(true);
    expect(state.operations.filter(operation => operation.path === root + "/" + held || operation.path.startsWith(root + "/" + held + "/"))).toEqual([]);
  });
  it("refuses aggregate subject bytes before opening a second payload", () => {
    const state = model({ "src/a.js": "123", "src/b.js": "456" });
    const guard = createLintInputGuard({ root, boundaries, fileSystem: state.fileSystem, limits: { subjectBytes: 5 } });
    expect(guard.read("src/a.js", "subject").toString()).toBe("123");
    expect(() => guard.read("src/b.js", "subject")).toThrow(/aggregate/);
    expect(guard.snapshot()).toMatchObject({ opens: 1, closes: 1, failed: true, subjectBytes: 3 });
  });
  it("refuses bulk suppressions before receipt authentication", async () => {
    const state = model({ "package.json": JSON.stringify({ scripts: { "lint:eslint": "node scripts/lint-eslint.mjs" } }), "eslint.config.js": "export default [];", "eslint-suppressions.json": "{}" });
    const stderr = { write: vi.fn() };
    expect(await main({ argv: [], root, fileSystem: state.fileSystem, loadConfig: async () => ({ default: state.config, lintInputGuard: state.guard }), stdout: { write: vi.fn() }, stderr })).toBe(2);
    expect(JSON.parse(stderr.write.mock.calls[0][0]).error).toContain("bulk suppressions");
    expect(state.operations.some(operation => operation.method === "openSync" && [root + "/" + state.binding.path, root + "/eslint-suppressions.json"].includes(operation.path))).toBe(false);
  });
});


describe("registered metadata-only capability boundaries", () => {
  const endpoints = ["read", "directory", "inspect", "inspect-raw", "readFileSync", "readdirSync", "lstatSync", "realpathSync", "readlinkSync"] as const;
  it.each(endpoints)("refuses stable replacements through %s without payload or descent", endpoint => {
    for (const replacement of ["regular", "directory"] as const) {
      for (const descendant of [false, true]) {
        if (replacement === "regular" && descendant) continue;
        const state = model();
        const record = state.packet.records.find(entry => entry.path.endsWith("/N05/witness.data"))!;
        const absolute = root + "/" + record.path;
        state.volume.unlinkSync(absolute);
        if (replacement === "regular") state.volume.writeFileSync(absolute, "FORBIDDEN RECEIPT PAYLOAD");
        else {
          state.volume.mkdirSync(absolute);
          state.volume.writeFileSync(absolute + "/child.js", "FORBIDDEN DESCENDANT PAYLOAD");
        }
        state.guard.loadReceipts(state.binding);
        state.operations.length = 0;
        const relative = record.path + (descendant ? "/child.js" : "");
        const target = root + "/" + relative;
        const invoke = () => {
          if (endpoint === "read") return state.guard.read(relative, "configuration");
          if (endpoint === "directory") return state.guard.directory(relative);
          if (endpoint === "inspect") return state.guard.inspect(relative);
          if (endpoint === "inspect-raw") return state.guard.inspect(relative, true);
          return state.guard.fileSystem[endpoint](target);
        };
        expect(invoke).toThrow();
        expect(state.operations.filter(operation => operation.path.startsWith(absolute + "/"))).toEqual([]);
        expect(state.operations.filter(operation => operation.path === absolute && ["openSync", "readdirSync", "realpathSync"].includes(operation.method))).toEqual([]);
      }
    }
  });
  it("keeps all 25 registered lstat and valid readlink controls metadata-only", () => {
    const state = model({ "src/ordinary.js": "export {};" });
    const records = state.guard.loadReceipts(state.binding);
    state.operations.length = 0;
    for (const record of records) {
      const absolute = root + "/" + record.path;
      const stat = state.guard.fileSystem.lstatSync(absolute);
      expect(stat.isSymbolicLink()).toBe(record.kind === "symlink");
      expect(stat.isFile()).toBe(record.kind === "regular");
      expect(state.guard.inspect(record.path).stat.ino).toBe(stat.ino);
      if (record.kind === "symlink") expect(state.guard.fileSystem.readlinkSync(absolute)).toBe(record.target);
    }
    const leaves = new Set(records.map(record => root + "/" + record.path));
    expect(state.operations.filter(operation => leaves.has(operation.path) && ["openSync", "readdirSync", "realpathSync"].includes(operation.method))).toEqual([]);
    expect(state.guard.fileSystem.readFileSync(root + "/src/ordinary.js").toString()).toBe("export {};");
  });
  it("rejects target drift through both metadata endpoints without target access", () => {
    for (const endpoint of ["lstatSync", "readlinkSync"] as const) {
      const state = model();
      const record = state.packet.records.find(entry => entry.path.endsWith("/N05/witness.data"))!;
      const absolute = root + "/" + record.path;
      state.volume.unlinkSync(absolute);
      state.volume.symlinkSync("/never-read-target", absolute);
      state.guard.loadReceipts(state.binding);
      state.operations.length = 0;
      expect(() => state.guard.fileSystem[endpoint](absolute)).toThrow(/target/);
      expect(state.operations.some(operation => operation.path === "/never-read-target")).toBe(false);
    }
  });
  it("rejects case aliases and their descendants before filesystem operations", () => {
    for (const endpoint of endpoints) {
      const state = model();
      const record = state.packet.records.find(entry => entry.path.endsWith("/N05/witness.data"))!;
      state.guard.loadReceipts(state.binding);
      state.operations.length = 0;
      const relative = record.path.slice(0, -"witness.data".length) + "WITNESS.data/child.js";
      const invoke = () => {
        if (endpoint === "read") return state.guard.read(relative);
        if (endpoint === "directory") return state.guard.directory(relative);
        if (endpoint === "inspect") return state.guard.inspect(relative);
        if (endpoint === "inspect-raw") return state.guard.inspect(relative, true);
        return state.guard.fileSystem[endpoint](root + "/" + relative);
      };
      expect(invoke).toThrow();
      expect(state.operations).toEqual([]);
    }
  });
  it("does not expose a replacement while asynchronous selection is pending", async () => {
    const state = model();
    const records = state.guard.loadReceipts(state.binding);
    const record = records.find((entry: any) => entry.path.endsWith("/N05/witness.data"));
    let release!: (value: string) => void;
    const classification = new Promise<string>(resolve => { release = resolve; });
    const pending = state.guard.verifyReceipt(record, { classify: () => classification });
    const absolute = root + "/" + record.path;
    state.volume.unlinkSync(absolute);
    state.volume.mkdirSync(absolute);
    state.volume.writeFileSync(absolute + "/child.js", "neverRead();");
    state.operations.length = 0;
    expect(() => state.guard.fileSystem.readdirSync(absolute)).toThrow();
    release(record.selection);
    await expect(pending).rejects.toThrow(/receipt/);
    expect(state.operations.some(operation => operation.path.startsWith(absolute + "/") || (operation.path === absolute && ["readdirSync", "openSync", "realpathSync"].includes(operation.method)))).toBe(false);
    expect(state.guard.snapshot().opens).toBe(state.guard.snapshot().closes);
  });
});


describe("single-operation loader admission", () => {
  function inventoryModel(count = 8, depth = 3) {
    const capture = "tests/owned/" + Array.from({ length: depth }, (_, index) => "level-" + index).join("/");
    const ownerPath = "tests/owned/owner.json";
    const payload = "export const fixture = true;";
    const paths = Array.from({ length: count }, (_, index) => capture + "/group-" + Math.floor(index / 8) + "/file-" + index + ".mjs");
    const owner = JSON.stringify({ captured: paths });
    const inventory = { version: 1, records: [{ id: "owned-copy", role: "immutable-harness-capture", owners: [{ path: ownerPath, bytes: Buffer.byteLength(owner), sha256: digest(owner) }], proof: { owner: ownerPath, selector: "captured", pathBase: capture, relation: "owned synthetic captured inputs" }, members: paths.map(path => ({ path, bytes: Buffer.byteLength(payload), sha256: digest(payload) })), codeDirectory: capture }] };
    const state = model({ [ownerPath]: owner, ...Object.fromEntries(paths.map(path => [path, payload])) });
    return { ...state, inventory, paths, capture, payload };
  }
  it("authenticates the actual integrated512 census within the unchanged cap", () => {
    const state = inventoryModel(512, 24);
    const result = verifyLintInventory(root, state.inventory, boundaries, state.guard.fileSystem);
    expect(result.files).toEqual(state.paths);
    expect(state.guard.snapshot()).toMatchObject({ opens: 513, closes: 513, failed: false });
    expect(state.guard.snapshot().metadataOperations).toBeLessThan(250000);
    console.log(JSON.stringify({ control: "integrated512", counters: state.guard.snapshot() }));
  }, 15000);
  it.each(["guarded", "ordinary"])("keeps inventory/read results on the %s path", route => {
    const state = inventoryModel();
    const fileSystem = route === "guarded" ? state.guard.fileSystem : state.fileSystem;
    expect(verifyLintInventory(root, state.inventory, boundaries, fileSystem).files).toEqual(state.paths);
    expect(readRegularInput(root, state.paths[0], 100, fileSystem, boundaries).toString()).toBe(state.payload);
    expect(() => readRegularInput(root, state.paths[0], 1, fileSystem, boundaries)).toThrow();
  });
  it.each(["guarded", "ordinary"])("keeps declared link metadata and pre-descent checks on %s", route => {
    const state = inventoryModel(1);
    const link = state.capture + "/escape.mjs";
    const absolute = root + "/" + link;
    const record = state.inventory.records[0] as any;
    record.role = "generated-negative";
    record.symlinks = [{ path: link, target: "missing-held-target" }];
    state.volume.symlinkSync("missing-held-target", absolute);
    const facade = route === "guarded" ? state.guard.fileSystem : state.fileSystem;
    expect(verifyLintInventory(root, state.inventory, boundaries, facade).files).toEqual([...state.paths, link]);
    expect(state.operations.filter(operation => operation.path.endsWith("missing-held-target") || (operation.path === absolute && operation.method === "openSync"))).toEqual([]);
    state.volume.unlinkSync(absolute);
    state.volume.mkdirSync(absolute);
    state.volume.writeFileSync(absolute + "/owner.json", "{}");
    record.owners.push({ path: link + "/owner.json", bytes: 2, sha256: digest("{}") });
    state.operations.length = 0;
    expect(() => verifyLintInventory(root, state.inventory, boundaries, facade)).toThrow(/remain a symlink/);
    expect(state.operations.filter(operation => operation.path.startsWith(absolute + "/") || (operation.path === absolute && operation.method !== "lstatSync"))).toEqual([]);
  });
  it.each(["guarded", "ordinary"])("retains a trailing root slash on %s without normalizing traversal", route => {
    const state = inventoryModel(1);
    const facade = route === "guarded" ? state.guard.fileSystem : state.fileSystem;
    expect(readRegularInput(root + "/", state.paths[0], 100, facade, boundaries).toString()).toBe(state.payload);
    expect(verifyLintInventory(root + "/", state.inventory, boundaries, facade).files).toEqual(state.paths);
    if (route === "guarded") {
      state.operations.length = 0;
      expect(() => readRegularInput(root + "/unused/..", state.paths[0], 100, facade, boundaries)).toThrow();
      expect(state.operations).toEqual([]);
    }
  });
  it("rejects omitted or oversized read bounds before payload admission", () => {
    for (const maximum of [undefined, -1, Infinity, 16777217]) {
      const state = inventoryModel(1);
      expect(() => readRegularInput(root, state.paths[0], maximum, state.guard.fileSystem, boundaries)).toThrow(/bound/);
      expect(state.operations).toEqual([]);
    }
  });
  it.each([undefined, null, false, 0, "", NaN, new Error("selected")])("keeps optimized read and close identity for %j", reason => {
    for (const scenario of ["read", "close", "combined"]) {
      const state = inventoryModel(1);
      const closeReason = new Error("close");
      const closeSync = vi.fn((descriptor: number) => { state.memory.closeSync(descriptor); if (scenario !== "read") throw closeReason; });
      const guard = createLintInputGuard({ root, boundaries, fileSystem: { ...state.fileSystem, readSync(...args: any[]) { if (scenario !== "close") throw reason; return (state.memory.readSync as any)(...args); }, closeSync } });
      let caught = false;
      let failure: any;
      try { readRegularInput(root, state.paths[0], 100, guard.fileSystem, boundaries); }
      catch (error) { caught = true; failure = error; }
      expect(caught).toBe(true);
      if (scenario === "combined") { expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors[0]).toBe(reason); expect(failure.errors[1]).toBe(closeReason); }
      else expect(failure).toBe(scenario === "read" ? reason : closeReason);
      expect(closeSync).toHaveBeenCalledTimes(1);
      expect(guard.snapshot()).toMatchObject({ reading: false, failed: true });
    }
  });
  it("retains descriptor drift checks and closure through optimized reads", () => {
    const state = inventoryModel(1);
    let calls = 0;
    const closeSync = vi.fn((descriptor: number) => state.memory.closeSync(descriptor));
    const guard = createLintInputGuard({ root, boundaries, fileSystem: { ...state.fileSystem, fstatSync(descriptor: number) { const stat = state.memory.fstatSync(descriptor); if (++calls === 2) stat.size++; return stat; }, closeSync } });
    expect(() => readRegularInput(root, state.paths[0], 100, guard.fileSystem, boundaries)).toThrow(/identity drift/);
    expect(closeSync).toHaveBeenCalledTimes(1);
  });
  it("dispatches one fresh guarded operation per regular read", () => {
    const state = inventoryModel(1);
    const facade = { ...state.guard.fileSystem, readdirSync: vi.fn(() => { throw new Error("nested ancestor validation"); }), lstatSync: vi.fn(() => { throw new Error("nested leaf validation"); }) };
    expect(readRegularInput(root, state.paths[0], 100, facade, boundaries).toString()).toBe(state.payload);
    expect(facade.readdirSync).not.toHaveBeenCalled();
    expect(facade.lstatSync).not.toHaveBeenCalled();
  });
  it.each(["guarded", "ordinary"])("rejects a declared regular ancestor before descent on %s", route => {
    const state = inventoryModel(1);
    const leaf = state.paths[0];
    state.volume.unlinkSync(root + "/" + leaf);
    state.volume.mkdirSync(root + "/" + leaf);
    state.volume.writeFileSync(root + "/" + leaf + "/nested.mjs", "forbidden()");
    state.inventory.records[0].owners.push({ path: leaf + "/nested.mjs", bytes: Buffer.byteLength("forbidden()"), sha256: digest("forbidden()") });
    state.operations.length = 0;
    expect(() => verifyLintInventory(root, state.inventory, boundaries, route === "guarded" ? state.guard.fileSystem : state.fileSystem)).toThrow(/regular file/);
    expect(state.operations.filter(operation => operation.path.startsWith(root + "/" + leaf + "/") || (operation.method === "readdirSync" && operation.path === root + "/" + leaf))).toEqual([]);
  });
  it.each(["regular", "symlink"])("rejects metadata-only %s replacement directories before optimized access", kind => {
    const state = model();
    const record = state.guard.loadReceipts(state.binding).find((entry: any) => entry.kind === kind)!;
    const absolute = root + "/" + record.path;
    state.volume.unlinkSync(absolute);
    state.volume.mkdirSync(absolute);
    state.volume.writeFileSync(absolute + "/child.js", "forbidden()");
    state.operations.length = 0;
    const facade = state.guard.fileSystem as any;
    expect(() => facade.inspectAdmittedInput(absolute, () => {})).toThrow(/single-link receipt|receipt leaf kind/);
    expect(() => facade.inspectAdmittedInput(absolute + "/child.js", () => {})).toThrow(/metadata-only/);
    expect(() => facade.readAdmittedInput(absolute, 100)).toThrow();
    expect(state.operations.filter(operation => operation.method === "openSync" || operation.path.startsWith(absolute + "/") || (operation.method === "readdirSync" && operation.path === absolute))).toEqual([]);
  });
  it.each(["packages/safe-bash/src/commands/XAN/held.ts", "../outside.js", "src/back\\slash.js"])("rejects %s through both dispatch endpoints before metadata", path => {
    for (const operation of ["inspect", "read"]) {
      const state = model();
      const facade = state.guard.fileSystem as any;
      expect(() => operation === "inspect" ? facade.inspectAdmittedInput(root + "/" + path, () => {}) : readRegularInput(root, path, 100, facade, boundaries)).toThrow();
      expect(state.operations).toEqual([]);
    }
  });
  it("revalidates replacement ancestors between separate reads without cached permission", () => {
    const state = inventoryModel(1);
    const path = state.paths[0];
    expect(readRegularInput(root, path, 100, state.guard.fileSystem, boundaries).toString()).toBe(state.payload);
    const directory = dirname(root + "/" + path);
    state.volume.renameSync(directory, directory + "-moved");
    state.volume.symlinkSync(directory + "-moved", directory);
    state.operations.length = 0;
    expect(() => readRegularInput(root, path, 100, state.guard.fileSystem, boundaries)).toThrow();
    expect(state.operations.filter(operation => operation.method === "openSync")).toEqual([]);
  });
  it("refuses both optimized endpoints before bootstrap readiness", () => {
    const state = model();
    const guard = createLintInputGuard({ root, fileSystem: state.fileSystem, bootstrap: true });
    const facade = guard.fileSystem as any;
    expect(() => facade.inspectAdmittedInput(root + "/package.json", () => {})).toThrow(/bootstrap/);
    expect(() => facade.readAdmittedInput(root + "/package.json", 100)).toThrow(/bootstrap/);
    expect(state.operations).toEqual([]);
  });
});

describe("initialization failure diagnostics", () => {
  const reasons = [new Error("primary"), undefined, null, false, 0, "", NaN];
  it.each(reasons)("preserves original reason %j with measured counters", async reason => {
    const state = model();
    const boundaryBinding = { path: "packages/safe-bash/integration-boundaries.json", bytes: 2, sha256: digest("{}") };
    state.volume.writeFileSync(root + "/" + boundaryBinding.path, "{}");
    const fileSystem = { ...state.fileSystem, readSync() { throw reason; } };
    await guardedInputs.withLintFailureDiagnostics(async (diagnostics: any) => {
      await expect(guardedInputs.initializeLintConfiguration({ root, fileSystem, boundaryBinding, buildConfig: () => [] })).rejects.toBe(reason);
      expect(diagnostics()).toMatchObject({ phase: "boundary-policy", root, counters: { opens: 1, closes: 1, readCalls: 1, readBytes: 0, failed: true, reading: false } });
    });
  });
  it("records a refused metadata attempt without pretending it executed", () => {
    const state = model();
    const guard = createLintInputGuard({ root, boundaries, fileSystem: state.fileSystem, limits: { metadataOperations: 1 } });
    expect(() => guard.read("src/file.js")).toThrow(/metadata operation cap/);
    expect(guard.snapshot()).toMatchObject({ metadataOperations: 1, opens: 0, lastMetadata: { method: "readdirSync", admitted: false, completed: false } });
    expect(state.operations).toHaveLength(1);
  });
  it("reports original ordered read-close errors through the runner", async () => {
    const state = model({ "package.json": JSON.stringify({ scripts: { "lint:eslint": "node scripts/lint-eslint.mjs" } }), "eslint.config.js": "export default [];" });
    const boundaryBinding = { path: "packages/safe-bash/integration-boundaries.json", bytes: 2, sha256: digest("{}") };
    state.volume.writeFileSync(root + "/" + boundaryBinding.path, "{}");
    const closeSync = vi.fn((descriptor: number) => { state.memory.closeSync(descriptor); throw false; });
    const fileSystem = { ...state.fileSystem, readSync() { throw undefined; }, closeSync };
    let selected: any;
    const stderr = { write: vi.fn() };
    const code = await main({ argv: [], root, fileSystem: state.fileSystem, stdout: { write: vi.fn() }, stderr, loadConfig: async () => {
      try { return await guardedInputs.initializeLintConfiguration({ root, fileSystem, boundaryBinding, buildConfig: () => [] }); }
      catch (error) { selected = error; throw error; }
    } });
    expect(code).toBe(2);
    expect(selected).toBeInstanceOf(AggregateError);
    expect(selected.errors).toEqual([undefined, false]);
    expect(closeSync).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stderr.write.mock.calls[0][0])).toMatchObject({ complete: false, initializationFailure: { phase: "boundary-policy", counters: { opens: 1, closes: 0, readBytes: 0, failed: true } } });
  });
  it("isolates concurrent and nested diagnostic observation without stale failures", async () => {
    await Promise.all([false, null].map(reason => guardedInputs.withLintFailureDiagnostics(async (diagnostics: any) => {
      expect(diagnostics()).toBeNull();
      await Promise.resolve();
      const state = model();
      const boundaryBinding = { path: "packages/safe-bash/integration-boundaries.json", bytes: 2, sha256: digest("{}") };
      state.volume.writeFileSync(root + "/" + boundaryBinding.path, "{}");
      await expect(guardedInputs.initializeLintConfiguration({ root, fileSystem: { ...state.fileSystem, readSync() { throw reason; } }, boundaryBinding, buildConfig: () => [] })).rejects.toBe(reason);
      const observed = diagnostics();
      await guardedInputs.withLintFailureDiagnostics(async (nested: any) => { expect(nested()).toBeNull(); await Promise.resolve(); });
      expect(diagnostics()).toBe(observed);
    })));
  });
});



describe("guarded configuration bootstrap ordering", () => {
  function bootstrapModel(observation: "all" | "opens" = "all") {
    const state = model({ "package.json": "{}", "eslint.config.js": "export default [];", "src/ordinary.js": "export {};" }, observation);
    const policy = { version: 1, ...boundaries, heldEvidenceDirectories: ["tests/owned/held-capture"], fixtureDirectories: [] };
    const text = JSON.stringify(policy);
    const binding = { path: "packages/safe-bash/integration-boundaries.json", bytes: Buffer.byteLength(text), sha256: digest(text) };
    state.volume.writeFileSync(root + "/" + binding.path, text);
    const calls: string[] = [];
    const options = {
      root,
      fileSystem: state.fileSystem,
      boundaryBinding: binding,
      receiptBinding: state.binding,
      buildConfig(_inputs: unknown, fileSystem?: unknown) { calls.push(fileSystem ? "final-config" : "selection-config"); return state.config; },
      loadBoundaries(_root: string, fileSystem: any) { calls.push("boundary-owners"); return JSON.parse(fileSystem.readFileSync(root + "/" + binding.path)); },
      lintExclusions() { calls.push("inventory-provenance"); return { files: [], directories: [] }; }
    };
    return { ...state, policy, policyBinding: binding, calls, options };
  }
  it("forwards reduced initialization limits without allowing a higher metadata cap", async () => {
    const state = bootstrapModel("opens");
    await expect(guardedInputs.initializeLintConfiguration({ ...state.options, limits: { metadataOperations: 1 } }).then(() => "initialized")).rejects.toMatchObject({ code: "LINT_LIMIT", message: "metadata operation cap" });
    await expect(guardedInputs.initializeLintConfiguration({ ...state.options, limits: { metadataOperations: 8000001 } })).rejects.toThrow(/invalid input limit: metadataOperations/);
  });
  it("captures the actual metadata cap in inventory phase and clears a fresh initialization", async () => {
    const state = bootstrapModel("opens");
    const metadataLimit = 10000;
    const options = { ...state.options, limits: { metadataOperations: metadataLimit }, lintExclusions(_root: string, _boundaries: unknown, fileSystem: any) {
      for (let attempt = 0; attempt <= metadataLimit; attempt++) fileSystem.lstatSync(root + "/src/ordinary.js");
      return { files: [], directories: [] };
    } };
    await guardedInputs.withLintFailureDiagnostics(async (diagnostics: any) => {
      await expect(guardedInputs.initializeLintConfiguration(options)).rejects.toMatchObject({ code: "LINT_LIMIT", message: "metadata operation cap" });
      const failure = diagnostics();
      expect(failure).toMatchObject({ phase: "inventory-provenance", root, counters: { metadataOperations: metadataLimit, failed: true, reading: false, receiptChecks: 50, subjects: 0, lastMetadata: { admitted: false, completed: false } } });
      expect(failure.counters.opens).toBe(failure.counters.closes);
      expect(failure.counters.lastMetadata.path).toBeTypeOf("string");
      expect(receiptPayloads(state)).toEqual([]);
      console.log(JSON.stringify({ control: "initialization-cap-diagnostics", failure }));
      const fresh = bootstrapModel();
      await guardedInputs.initializeLintConfiguration(fresh.options);
      expect(diagnostics()).toBeNull();
      expect(failure.counters.metadataOperations).toBe(metadataLimit);
    });
  });
  it("exposes only fixed bootstrap reads, never an empty unprotected registry", () => {
    const state = bootstrapModel();
    const guard = createLintInputGuard({ root, fileSystem: state.fileSystem, bootstrap: true });
    expect(() => guard.read("src/ordinary.js")).toThrow(/bootstrap/);
    expect(() => guard.fileSystem.lstatSync(root + "/src/ordinary.js")).toThrow(/bootstrap/);
    expect(() => guard.fileSystem.readdirSync(root)).toThrow(/bootstrap/);
    expect(state.operations).toEqual([]);
    const fresh = createLintInputGuard({ root, fileSystem: state.fileSystem, bootstrap: true });
    expect(fresh.read("package.json").toString()).toBe("{}");
  });
  it("orders quarantine, owner authentication, metadata and then inventory", async () => {
    const state = bootstrapModel();
    const result = await guardedInputs.initializeLintConfiguration(state.options);
    const inventory = root + "/" + state.packet.inventory.path;
    const inventoryIndex = state.operations.findIndex(operation => operation.method === "openSync" && operation.path === inventory);
    const beforeInventory = state.operations.slice(0, inventoryIndex);
    expect(inventoryIndex).toBeGreaterThan(0);
    const firstLeaf = beforeInventory.findIndex(operation => state.packet.records.some(record => operation.path === root + "/" + record.path));
    const owners = [...new Set(state.packet.records.flatMap(record => record.owners.map(owner => root + "/" + owner.path)))];
    for (const owner of owners) expect(beforeInventory.findIndex(operation => operation.method === "openSync" && operation.path === owner)).toBeLessThan(firstLeaf);
    for (const record of state.packet.records) expect(beforeInventory.some(operation => operation.method === "lstatSync" && operation.path === root + "/" + record.path)).toBe(true);
    expect(state.calls).toEqual(["selection-config", "boundary-owners", "inventory-provenance", "final-config"]);
    expect(receiptPayloads(state)).toEqual([]);
    expect(result.guard.snapshot()).toMatchObject({ receiptsComplete: true, bootstrap: true, used: false });
  });
  it("quarantines every endpoint during owner authentication", async () => {
    const state = bootstrapModel();
    const guard = createLintInputGuard({ root, fileSystem: state.fileSystem, bootstrap: true });
    guard.loadPolicy(state.policyBinding);
    const original = state.fileSystem.readSync.bind(state.fileSystem);
    const owner = state.packet.records[0].owners[0];
    let checked = false;
    state.fileSystem.readSync = ((...args: any[]) => {
      const count = original(...args);
      if (!checked && state.operations.at(-1)?.path === root + "/" + owner.path) {
        checked = true;
        const before = state.operations.length;
        expect(() => guard.fileSystem.lstatSync(root + "/" + state.packet.records[0].path)).toThrow(/bootstrap/);
        expect(() => guard.directory(state.packet.records[0].path + "/child.js")).toThrow();
        expect(state.operations).toHaveLength(before);
      }
      return count;
    }) as any;
    await guard.initializeReceipts(() => createLintSelection(root, state.config), state.binding);
    expect(checked).toBe(true);
  });
  it.each(["owner", "kind", "selection"])("stops %s denial before inventory and provenance", async failure => {
    const state = bootstrapModel();
    const record = state.packet.records.find(record => record.path.endsWith("/N05/witness.data"))!;
    if (failure === "owner") state.volume.writeFileSync(root + "/" + state.packet.records[0].owners[0].path, "changed owner");
    if (failure === "kind") { state.volume.unlinkSync(root + "/" + record.path); state.volume.mkdirSync(root + "/" + record.path); }
    if (failure === "selection") (state.config as any[]).push({ files: ["**/*.data"] });
    await expect(guardedInputs.initializeLintConfiguration(state.options)).rejects.toThrow();
    expect(state.operations.some(operation => operation.path === root + "/" + state.packet.inventory.path)).toBe(false);
    expect(state.calls.includes("boundary-owners") || state.calls.includes("inventory-provenance")).toBe(false);
    if (failure === "owner") expect(state.operations.some(operation => state.packet.records.some(record => operation.path === root + "/" + record.path))).toBe(false);
    if (failure === "selection") expect(state.operations.some(operation => operation.path === root + "/" + record.path)).toBe(false);
    expect(receiptPayloads(state)).toEqual([]);
  });
  it("keeps failed bootstrap poisoned and denies state reuse", async () => {
    const state = bootstrapModel();
    const guard = createLintInputGuard({ root, fileSystem: state.fileSystem, bootstrap: true });
    guard.loadPolicy(state.policyBinding);
    state.volume.writeFileSync(root + "/" + state.packet.records[0].owners[0].path, "changed");
    await expect(guard.initializeReceipts(() => createLintSelection(root, state.config), state.binding)).rejects.toThrow();
    const before = state.operations.length;
    expect(() => guard.fileSystem.readFileSync(root + "/src/ordinary.js")).toThrow();
    await expect(guard.initializeReceipts(() => createLintSelection(root, state.config), state.binding)).rejects.toThrow();
    expect(state.operations).toHaveLength(before);
  });
  it("reuses only the completed binding while keeping lint invocation one-shot", async () => {
    const state = bootstrapModel();
    const context = await guardedInputs.initializeLintConfiguration(state.options);
    const before = state.operations.length;
    expect(context.guard.loadReceipts(state.binding)).toHaveLength(25);
    await expect(context.guard.initializeReceipts(() => createLintSelection(root, state.config), state.binding)).rejects.toThrow();
    expect(state.operations).toHaveLength(before);
    const first = await lintRoot({ guard: context.guard, config: context.config, receiptBinding: state.binding });
    expect(first.complete).toBe(true);
    const second = await lintRoot({ guard: context.guard, config: context.config, receiptBinding: state.binding });
    expect(second.exitCode).toBe(2);
    expect(second.failure?.message).toContain("already used");
  });
  it.each(["policy", "receipt", "inventory", "provenance", "final-selection"])("fails closed on %s drift without reusing partial state", async failure => {
    const state = bootstrapModel();
    let exposed: any;
    if (failure === "policy") state.volume.writeFileSync(root + "/" + state.policyBinding.path, "{}");
    if (failure === "receipt") state.volume.writeFileSync(root + "/" + state.binding.path, "{}");
    if (failure === "inventory") state.volume.writeFileSync(root + "/" + state.packet.inventory.path, "{}");
    const originalLoader = state.options.loadBoundaries;
    state.options.loadBoundaries = (_root, fileSystem) => { exposed = fileSystem; return originalLoader(_root, fileSystem); };
    if (failure === "provenance") state.options.lintExclusions = () => { throw new Error("provenance rejected"); };
    if (failure === "final-selection") state.options.buildConfig = (_inputs, fileSystem) => fileSystem ? [...state.config, { files: ["**/*.data"] }] as any : state.config;
    await expect(guardedInputs.initializeLintConfiguration(state.options)).rejects.toThrow();
    if (exposed) expect(() => exposed.readFileSync(root + "/src/ordinary.js")).toThrow(/failed/);
    if (failure === "policy" || failure === "receipt") {
      expect(state.operations.some(operation => state.packet.records.some(record => operation.path === root + "/" + record.path))).toBe(false);
      expect(state.operations.some(operation => operation.path === root + "/" + state.packet.inventory.path)).toBe(false);
    }
    expect(receiptPayloads(state)).toEqual([]);
  });
  it("rejects concurrent initialization and changed cached bindings without reads", async () => {
    const state = bootstrapModel();
    const guard = createLintInputGuard({ root, fileSystem: state.fileSystem, bootstrap: true });
    guard.loadPolicy(state.policyBinding);
    let release!: (selection: unknown) => void;
    const pending = guard.initializeReceipts(() => new Promise(resolve => { release = resolve; }), state.binding);
    const before = state.operations.length;
    await expect(guard.initializeReceipts(() => createLintSelection(root, state.config), state.binding)).rejects.toThrow(/already started/);
    expect(() => guard.loadReceipts(state.binding)).toThrow(/bootstrap/);
    expect(state.operations).toHaveLength(before);
    release(createLintSelection(root, state.config));
    await pending;
    const complete = state.operations.length;
    expect(() => guard.loadReceipts({ ...state.binding, sha256: "0".repeat(64) })).toThrow(/binding changed/);
    expect(state.operations).toHaveLength(complete);
  });
  it("requires a fresh capability for a new configuration initialization", async () => {
    const state = bootstrapModel();
    const first = await guardedInputs.initializeLintConfiguration(state.options);
    const second = await guardedInputs.initializeLintConfiguration(state.options);
    expect(first.guard).not.toBe(second.guard);
    expect(first.guard.snapshot().used).toBe(false);
    expect(second.guard.snapshot().used).toBe(false);
  });
});

describe("read and close failure settlement", () => {
  const reasons = [
    { name: "Error", reason: new Error("primary") },
    { name: "undefined", reason: undefined },
    { name: "null", reason: null },
    { name: "false", reason: false },
    { name: "zero", reason: 0 },
    { name: "empty", reason: "" },
    { name: "NaN", reason: NaN }
  ];
  for (const mode of ["sync", "async consumer"] as const) {
    it.each(reasons)(mode + " preserves $name presence and ordered cleanup", async ({ reason }) => {
      const secondary = reasons[reasons.length - reasons.findIndex(entry => Object.is(entry.reason, reason)) - 1].reason;
      for (const scenario of ["read-only", "close-only", "combined"] as const) {
        const state = model({ "src/file.js": "export {};" });
        const events: string[] = [];
        let opened = -1;
        const openSync = (...args: any[]) => { opened = (state.memory.openSync as any)(...args); return opened; };
        const readSync = (...args: any[]) => {
          events.push("read");
          if (scenario !== "close-only") throw reason;
          return (state.memory.readSync as any)(...args);
        };
        const closeSync = vi.fn((descriptor: number) => {
          state.memory.closeSync(descriptor);
          events.push("closed");
          if (scenario !== "read-only") throw secondary;
        });
        const guard = createLintInputGuard({ root, boundaries, fileSystem: { ...state.fileSystem, openSync, readSync, closeSync } });
        let caught = false;
        let failure: unknown;
        try {
          if (mode === "sync") guard.read("src/file.js", "subject");
          else await Promise.resolve().then(() => guard.read("src/file.js", "subject"));
        } catch (error) {
          caught = true;
          failure = error;
          events.push("settled");
        }
        expect(caught).toBe(true);
        if (scenario === "combined") {
          expect(failure).toBeInstanceOf(AggregateError);
          expect((failure as AggregateError).errors).toHaveLength(2);
          expect((failure as AggregateError).errors[0]).toBe(reason);
          expect((failure as AggregateError).errors[1]).toBe(secondary);
        } else expect(failure).toBe(scenario === "read-only" ? reason : secondary);
        expect(events).toEqual(["read", "closed", "settled"]);
        expect(closeSync).toHaveBeenCalledTimes(1);
        expect(() => state.memory.fstatSync(opened)).toThrow();
        expect(guard.snapshot()).toMatchObject({ failed: true, reading: false });
        expect(() => guard.read("src/file.js", "subject")).toThrow(/failed/);
        expect(closeSync).toHaveBeenCalledTimes(1);
      }
    });
  }
  it.each(reasons)("keeps async selection rejection $name without leaked reads", async ({ reason }) => {
    const state = model();
    const record = state.guard.loadReceipts(state.binding)[0];
    let reject!: (reason: unknown) => void;
    const classification = new Promise<string>((_resolve, fail) => { reject = fail; });
    const result = state.guard.verifyReceipt(record, { classify: () => classification });
    reject(reason);
    await expect(result).rejects.toBe(reason);
    expect(receiptPayloads(state)).toEqual([]);
    expect(state.guard.snapshot()).toMatchObject({ reading: false });
    expect(state.guard.snapshot().opens).toBe(state.guard.snapshot().closes);
  });
});


describe("owned directory operation and exact root receipt", () => {
  it("models POSIX link size from creation without hidden readlink or target access", () => {
    const state = model();
    const readlink = vi.spyOn(state.memory, "readlinkSync");
    expect(state.fileSystem.lstatSync(root + "/CLAUDE.md").size).toBe(9);
    expect(readlink).not.toHaveBeenCalled();
    expect(state.operations.some(operation => operation.path === root + "/AGENTS.md")).toBe(false);
  });
  it("preserves all 24 legacy receipt records and adds only the closed root link", () => {
    expect(receiptData.version).toBe(2);
    expect(receiptData.records).toHaveLength(25);
    expect(digest(JSON.stringify(receiptData.records.slice(0, 24)))).toBe("b00bcfda3b7abd3c8f21fdf1f55701ea74013f2706e879e11732624306f363f6");
    expect(receiptData.records[24]).toMatchObject({ id: "root-claude-link", group: "root-claude-link-1", path: "CLAUDE.md", kind: "symlink", selection: "unconfigured", target: "AGENTS.md", inventoryRecord: null, companion: null });
  });
  it("authenticates and reports 25 metadata-only leaves without touching the root target", async () => {
    const state = model();
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.complete).toBe(true);
    expect(result.receipts).toHaveLength(25);
    expect(result.receipts.find(record => record.path === "CLAUDE.md")).toMatchObject({ kind: "symlink", selection: "unconfigured", metadataOnly: true });
    expect(state.operations.some(operation => operation.path === root + "/AGENTS.md")).toBe(false);
    expect(receiptPayloads(state)).toEqual([]);
  });
  it.each(["configured", "ignored"])("refuses the root leaf when selection becomes %s before leaf metadata", async selection => {
    const state = model();
    const config = [...state.config, selection === "configured" ? { files: ["CLAUDE.md"] } : { ignores: ["CLAUDE.md"] }];
    const result = await lintRoot({ guard: state.guard, config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(state.operations.some(operation => operation.path === root + "/CLAUDE.md" || operation.path === root + "/AGENTS.md")).toBe(false);
  });
  it.each(["regular", "directory", "target"])("rejects root link %s replacement without payload or descent", async replacement => {
    const state = model();
    state.volume.unlinkSync(root + "/CLAUDE.md");
    if (replacement === "regular") state.volume.writeFileSync(root + "/CLAUDE.md", "AGENTS.md");
    else if (replacement === "directory") {
      state.volume.mkdirSync(root + "/CLAUDE.md");
      state.volume.writeFileSync(root + "/CLAUDE.md/child.js", "forbidden();");
    } else state.volume.symlinkSync("/never-read-target", root + "/CLAUDE.md");
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(state.operations.some(operation => operation.path.startsWith(root + "/CLAUDE.md/") || operation.path === "/never-read-target" || operation.path === root + "/AGENTS.md")).toBe(false);
    expect(state.operations.some(operation => operation.path === root + "/CLAUDE.md" && ["openSync", "readdirSync"].includes(operation.method))).toBe(false);
  });
  it.each(["claude.md", "other.md", "nested/CLAUDE.md"])("does not generalize the root receipt to %s", async replacement => {
    const state = model();
    state.packet.records[24].path = replacement;
    const text = JSON.stringify(state.packet);
    state.volume.writeFileSync(root + "/" + state.binding.path, text);
    const binding = { ...state.binding, bytes: Buffer.byteLength(text), sha256: digest(text) };
    const before = state.operations.length;
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: binding });
    expect(result.exitCode).toBe(2);
    expect(state.operations.slice(before).some(operation => operation.path === root + "/" + replacement || operation.path === root + "/CLAUDE.md")).toBe(false);
  });
  for (const route of ["loadReceipts", "lintRoot"] as const) {
    it.each(["compound nested", "compound different", "omitted", "renamed group", "legacy replacement", "duplicate root"])("rejects mandatory root schema %s through " + route + " before owner or inventory access", async mutation => {
      const state = model();
      const rootRecord = state.packet.records[24];
      const rootOwner = rootRecord.owners[0].path;
      const legacy = structuredClone(state.packet.records[0]);
      if (mutation.startsWith("compound")) {
        rootRecord.path = "packages/safe-bash/review/" + (mutation === "compound nested" ? "nested.md" : "different.md");
        rootRecord.owners = legacy.owners;
      } else if (mutation === "omitted") state.packet.records.pop();
      else if (mutation === "renamed group") rootRecord.group = "renamed-root-group";
      else if (mutation === "legacy replacement") {
        state.packet.records[24] = { ...legacy, id: "legacy-replacement", path: "packages/safe-bash/review/legacy.md" };
      } else state.packet.records[0] = structuredClone(rootRecord);
      state.volume.unlinkSync(root + "/" + rootOwner);
      const text = JSON.stringify(state.packet);
      state.volume.writeFileSync(root + "/" + state.binding.path, text);
      const binding = { ...state.binding, bytes: Buffer.byteLength(text), sha256: digest(text) };
      if (route === "loadReceipts") expect(() => state.guard.loadReceipts(binding)).toThrow();
      else {
        const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: binding });
        expect(result.exitCode).toBe(2);
        expect(result.complete).toBe(false);
      }
      const forbidden = new Set([
        ...receiptData.records.flatMap(record => [record.path, ...record.owners.map(owner => owner.path)]),
        ...state.packet.records.map(record => record.path),
        state.packet.inventory.path,
        "AGENTS.md"
      ].map(path => root + "/" + path));
      expect(state.operations.filter(operation => forbidden.has(operation.path))).toEqual([]);
      expect(state.operations.filter(operation => operation.method === "openSync").map(operation => operation.path)).toEqual([root + "/" + binding.path]);
      expect(state.guard.snapshot().opens).toBe(state.guard.snapshot().closes);
    });
  }
  it.each(["bytes", "selector", "git-proof"])("refuses root owner %s drift before root leaf metadata", async changed => {
    const state = model();
    const owner = state.packet.records[24].owners[0];
    if (changed === "bytes") state.volume.writeFileSync(root + "/" + owner.path, "changed");
    else {
      if (changed === "selector") owner.selectors = ["/unbound"];
      else {
        const proof = structuredClone(rootLinkOwnerData);
        proof.observations[0].blob = "0".repeat(40);
        const bytes = JSON.stringify(proof);
        state.volume.writeFileSync(root + "/" + owner.path, bytes);
        owner.bytes = Buffer.byteLength(bytes);
        owner.sha256 = digest(bytes);
      }
      const text = JSON.stringify(state.packet);
      state.volume.writeFileSync(root + "/" + state.binding.path, text);
      state.binding.bytes = Buffer.byteLength(text);
      state.binding.sha256 = digest(text);
    }
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(state.operations.some(operation => operation.path === root + "/CLAUDE.md" || operation.path === root + "/AGENTS.md")).toBe(false);
  });
  it("denies root leaf payload endpoints and ordinary fallback while allowing exact metadata", () => {
    const state = model();
    state.guard.loadReceipts(state.binding);
    expect(state.guard.fileSystem.lstatSync(root + "/CLAUDE.md").isSymbolicLink()).toBe(true);
    expect(state.guard.fileSystem.readlinkSync(root + "/CLAUDE.md").toString()).toBe("AGENTS.md");
    const ordinary = { ...state.guard.fileSystem, readAdmittedInput: undefined };
    expect(() => readRegularInput(root, "CLAUDE.md", 16, ordinary, boundaries)).toThrow();
    expect(state.operations.some(operation => operation.method === "openSync" && operation.path === root + "/CLAUDE.md")).toBe(false);
    expect(state.operations.some(operation => operation.path === root + "/AGENTS.md")).toBe(false);
  });
  it.each(["payload", "optimized", "directory", "descendant", "alias"])("keeps the root %s endpoint quarantined before target operations", endpoint => {
    const state = model();
    state.guard.loadReceipts(state.binding);
    const before = state.operations.length;
    expect(() => {
      if (endpoint === "payload") return state.guard.read("CLAUDE.md", "subject");
      if (endpoint === "optimized") return state.guard.fileSystem.readAdmittedInput(root + "/CLAUDE.md", 16);
      if (endpoint === "directory") return state.guard.directory("CLAUDE.md", true);
      if (endpoint === "descendant") return state.guard.directory("CLAUDE.md/child", true);
      return state.guard.inspect("claude.md");
    }).toThrow();
    expect(state.operations).toHaveLength(before);
  });
  it("retains ordinary directory output and refreshes every payload admission", () => {
    const state = model({ "src/member.js": "export {};" });
    expect(Object.keys(state.guard.directory("src")).sort()).toEqual(["entries", "entriesSha256", "identity"]);
    const directory = state.guard.directory("src", true);
    expect(directory.inspections.get("member.js").kind).toBe("file");
    state.volume.unlinkSync(root + "/src/member.js");
    state.volume.symlinkSync("/never-read", root + "/src/member.js");
    expect(() => state.guard.read("src/member.js", "subject")).toThrow();
    expect(state.operations.some(operation => operation.method === "openSync")).toBe(false);
  });
  it.each(["root", "ancestor"])("rejects %s replacement before the next listed child metadata", replacement => {
    const state = model({ "src/first.data": "first", "src/second.data": "second" });
    let swapped = false;
    const fileSystem = { ...state.fileSystem, realpathSync(absolute: string) {
      const value = state.fileSystem.realpathSync(absolute);
      if (!swapped && absolute === root + "/src/first.data") {
        swapped = true;
        const original = replacement === "root" ? root : root + "/src";
        const moved = replacement === "root" ? "/previous-root" : root + "/previous-src";
        state.volume.renameSync(original, moved);
        state.volume.symlinkSync(moved, original);
      }
      return value;
    } };
    const guard = createLintInputGuard({ root, boundaries, fileSystem });
    const directory = guard.directory("src", true);
    expect(Object.hasOwn(directory, "failure")).toBe(true);
    expect(state.operations.some(operation => operation.path === root + "/src/second.data")).toBe(false);
  });

  it.each(["nlink", "short-size", "long-size"])("refuses root symlink %s metadata drift before target text", async field => {
    const state = model();
    const fileSystem = { ...state.fileSystem, lstatSync(absolute: string) {
      const stat = state.fileSystem.lstatSync(absolute);
      if (absolute === root + "/CLAUDE.md") {
        if (field === "nlink") stat.nlink = 2;
        else stat.size = field === "short-size" ? 8 : 10;
      }
      return stat;
    } };
    const guard = createLintInputGuard({ root, boundaries, fileSystem });
    const result = await lintRoot({ guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(state.operations.some(operation => operation.method === "readlinkSync" && operation.path === root + "/CLAUDE.md")).toBe(false);
    expect(state.operations.some(operation => operation.path === root + "/AGENTS.md")).toBe(false);
  });
  it("starts every directory operation with fresh admission rather than a cached observation", () => {
    const state = model({ "src/member": "owned" });
    expect(state.guard.directory("src", true).inspections.get("member").kind).toBe("file");
    state.volume.unlinkSync(root + "/src/member");
    state.volume.mkdirSync(root + "/src/member");
    const before = state.operations.length;
    expect(state.guard.directory("src", true).inspections.get("member").kind).toBe("directory");
    expect(state.operations.slice(before).some(operation => operation.method === "lstatSync" && operation.path === root + "/src/member")).toBe(true);
  });
  it.each([undefined, null, false, 0, "", new Error("directory metadata")])("preserves explicit directory failure presence and identity for %s", reason => {
    const state = model({ "src/member.js": "export {};" });
    let directoryStats = 0;
    const fileSystem = { ...state.fileSystem, lstatSync(absolute: string) {
      if (absolute === root + "/src" && ++directoryStats === 4) throw reason;
      return state.fileSystem.lstatSync(absolute);
    } };
    const guard = createLintInputGuard({ root, boundaries, fileSystem });
    const directory = guard.directory("src", true);
    expect(Object.hasOwn(directory, "failure")).toBe(true);
    expect(directory.failure).toBe(reason);
    expect(directory.entries).toEqual(["member.js"]);
    expect(state.operations.some(operation => operation.method === "openSync")).toBe(false);
  });
  it("keeps all listed but unconsumed entries on a mid-directory cap failure", async () => {
    const prefix = "zz-cost/" + Array.from({ length: 18 }, (_, index) => "depth-" + index).join("/") + "/batch";
    const files = Object.fromEntries(Array.from({ length: 512 }, (_, index) => [prefix + "/member-" + index + ".data", "owned"]));
    const state = model(files);
    const guard = createLintInputGuard({ root, boundaries, fileSystem: state.fileSystem, limits: { metadataOperations: 15000 } });
    const result = await lintRoot({ guard, config: state.config, receiptBinding: state.binding });
    expect(result.exitCode).toBe(2);
    expect(result.counters.metadataOperations).toBe(15000);
    expect(result.failure?.path.startsWith(prefix + "/")).toBe(true);
    expect(result.unprocessed.entries).toHaveLength(512);
    expect(result.unprocessed.descendantsUnknown).toBe(true);
  });
  it("completes an owned mixed traversal under the authorized eight-million metadata cap", async () => {
    const files: Record<string, string> = {};
    const parents = Array.from({ length: 19 }, (_, index) => "depth-" + index).join("/");
    for (let group = 0; group < 2; group++) {
      for (let member = 0; member < 32; member++) files[parents + "/group-" + group + "/member-" + member + (member % 16 === 0 ? ".mjs" : ".data")] = member % 16 === 0 ? "export const value = 1;" : "owned noncode";
    }
    const state = model(files, "opens");
    const result = await lintRoot({ guard: state.guard, config: state.config, receiptBinding: state.binding });
    expect(result.complete).toBe(true);
    expect(result.scope.linted).toBe(9);
    expect(result.scope.unconfigured).toBe(65);
    expect(result.counters.metadataOperations).toBe(15131);
    expect(result.counters.metadataOperations).toBeLessThan(8000000);
    expect(result.counters.opens).toBe(result.counters.closes);
    expect(receiptPayloads(state)).toEqual([]);
    console.log(JSON.stringify({ control: "owned-directory-mixed-64", scope: result.scope, counters: result.counters, receipts: result.receipts.length, unprocessed: result.unprocessed }));
  });
});
