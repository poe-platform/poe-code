import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";
import { oracleIdentity, oracleRoot } from "./helpers.js";

for (const path of ["./helpers.ts", "./permission-profile/darwin-profile.test.ts"]) {
  test(`metadata oracle wrapper inhibits startup files without inheriting host environment: ${path}`, () => {
    const source = ts.createSourceFile(path, fs.readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "spawnSync") calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    const program = call.arguments[0];
    assert(program && ts.isStringLiteral(program));
    assert.equal(program.text, "/bin/bash");
    const args = call.arguments[1];
    assert(args && ts.isArrayLiteralExpression(args));
    assert.deepEqual(args.elements.slice(0, 3).map(element => {
      assert(ts.isStringLiteral(element));
      return element.text;
    }), ["--noprofile", "--norc", "-c"]);
    const script = args.elements[3];
    assert(script && ts.isStringLiteral(script));
    assert.equal(script.text, 'umask "$1"; shift; exec "$@"');
    const options = call.arguments[2];
    assert(options && ts.isObjectLiteralExpression(options));
    const environment = options.properties.find(property => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "env");
    assert(environment && ts.isPropertyAssignment(environment) && ts.isObjectLiteralExpression(environment.initializer));
    const entries = environment.initializer.properties.map(property => {
      if (ts.isSpreadAssignment(property)) {
        assert(ts.isIdentifier(property.expression));
        return ["...", property.expression.text];
      }
      assert(ts.isPropertyAssignment(property) && ts.isIdentifier(property.name));
      assert(ts.isStringLiteral(property.initializer) || ts.isIdentifier(property.initializer));
      return [property.name.text, property.initializer.text];
    });
    assert.deepEqual(entries, [["PATH", "/usr/bin:/bin"], ["LC_ALL", "C"], ["TZ", "UTC"], ["HOME", "cwd"], ["TMPDIR", "cwd"], ...path === "./helpers.ts" ? [["...", "env"]] : []]);
  });
}

function fixture(tool: "chmod" | "stat" | "mktemp" | "touch" | "expr") {
  const path = fileURLToPath(new URL(`../../../tmp/native-gnu/bin/${tool}`, import.meta.url));
  const second = fileURLToPath(new URL("../../../tmp/native-gnu-second/bin/stat", import.meta.url));
  const bytes = Buffer.from(`in-memory ${tool} fixture; never executed`);
  const fileSystem = createFsFromVolume(Volume.fromJSON({ [path]: bytes, [second]: bytes })) as unknown as typeof fs;
  fileSystem.chmodSync(path, 0o755);
  fileSystem.chmodSync(second, 0o755);
  const pin = { tool, version: `${tool} (GNU coreutils) 9.7`, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  const profiles = [{ id: "in-memory-darwin-only", qualification: "QUALIFIED", host: {
    platform: "darwin", arch: "arm64", distribution: "macos", version: "26.5.2", release: "25.5.0",
  }, executables: [pin] }];
  const calls: string[] = [];
  const run = (executable: string) => {
    calls.push(executable);
    return { status: 0, signal: null, stdout: pin.version + "\n", stderr: "" };
  };
  return { path, second, pin, calls, options: { platform: "darwin", arch: "arm64", release: "25.5.0", profiles, fileSystem, run } };
}

test("metadata and expr callers authenticate the selected staged identity without relocating source evidence", () => {
  const originalRoot = oracleRoot;
  for (const tool of ["chmod", "stat", "mktemp", "touch", "expr"] as const) {
    const state = fixture(tool);
    const identity = oracleIdentity(tool, state.options);
    assert.equal(identity.path, state.path);
    assert.equal(identity.sha256, state.pin.sha256);
    assert.equal(identity.version, state.pin.version);
    assert.deepEqual(state.calls, [state.path]);
  }
  assert.equal(oracleRoot, originalRoot);
  assert(oracleRoot.endsWith("/metadata-stress/.oracle/coreutils-9.7"));
});

test("stat comparison authenticates the separately staged second build", () => {
  const state = fixture("stat");
  const primary = oracleIdentity("stat", state.options);
  const secondary = oracleIdentity("stat", { ...state.options, build: 2 });
  assert.equal(primary.path, state.path);
  assert.equal(secondary.path, state.second);
  assert.notEqual(primary.path, secondary.path);
  assert.deepEqual(state.calls, [state.path, state.second]);
  state.options.fileSystem.unlinkSync(state.second);
  assert.throws(() => oracleIdentity("stat", { ...state.options, build: 2 }));
  assert.throws(() => oracleIdentity("touch", { ...state.options, build: 2 }));
});

test("native caller rejects missing, altered, linked and non-executable staged files before version execution", () => {
  for (const defect of ["missing", "hash", "size", "link", "mode"] as const) {
    const state = fixture("chmod");
    const fileSystem = state.options.fileSystem;
    if (defect === "missing") fileSystem.unlinkSync(state.path);
    if (defect === "hash") fileSystem.writeFileSync(state.path, Buffer.alloc(state.pin.size));
    if (defect === "size") fileSystem.writeFileSync(state.path, "short");
    if (defect === "mode") fileSystem.chmodSync(state.path, 0o644);
    if (defect === "link") {
      fileSystem.renameSync(state.path, state.path + "-real");
      fileSystem.symlinkSync(state.path + "-real", state.path);
    }
    assert.throws(() => oracleIdentity("chmod", state.options), defect);
    assert.deepEqual(state.calls, []);
  }
});

test("native caller preserves wrong-version and failed-version-process rejection", () => {
  for (const defect of ["version", "status", "signal", "error"] as const) {
    const state = fixture("expr");
    assert.throws(() => oracleIdentity("expr", { ...state.options, run: () => ({
      status: defect === "status" ? 1 : 0,
      signal: defect === "signal" ? "SIGKILL" : null,
      stdout: defect === "version" ? "wrong version\n" : state.pin.version + "\n",
      stderr: "",
      ...(defect === "error" ? { error: new Error("version launch failed") } : {}),
    }) }));
  }
});

test("missing qualified metadata tools and unqualified hosts never fall back to historical executables", () => {
  const state = fixture("stat");
  state.options.fileSystem.mkdirSync("/etc");
  state.options.fileSystem.writeFileSync("/etc/os-release", 'ID=ubuntu\nVERSION_ID="24.04"\n');
  const linux = { ...state.options, platform: "linux", arch: "x64", profiles: [{
    id: "in-memory-linux-without-metadata", qualification: "QUALIFIED",
    host: { platform: "linux", arch: "x64", distribution: "ubuntu", version: "24.04" },
    executables: [{ ...state.pin, tool: "tar" }],
  }] };
  assert.throws(() => oracleIdentity("stat", linux), /qualified GNU profile does not provide stat/u);
  assert.throws(() => oracleIdentity("stat", { ...state.options, release: "unqualified" }), /qualified kernel/u);
  assert.deepEqual(state.calls, []);
});

test("metadata module import stays lazy on a Linux guest without metadata executables", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { ...descriptor, value: "linux" });
    const helpers = await import(new URL("./helpers.ts?linux-import-only", import.meta.url).href);
    assert.equal(typeof helpers.oracle, "function");
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
});
