import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, FsError, type FileSystem, type FsOptions, type RemoveOptions } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createReadOnlyFileSystem } from "../../src/fs/readonly/index.js";
import { Shell } from "../../src/shell/index.js";
import { fixture, run } from "./helpers.js";

const now = 1_700_000_000_000;

for (const [predicate, unit] of [["-mtime", 86_400_000], ["-mmin", 60_000]] as const) {
  const cases: readonly [string, readonly string[]][] = predicate === "-mtime" ? [
    ["0", ["zero", "below-one"]], ["1", ["one", "below-two"]],
    ["+1", []], ["-1", ["future", "zero", "below-one", "one"]],
    ["+0", ["below-two", "two"]], ["-0", ["future", "zero"]],
  ] : [
    ["0", ["future"]], ["1", ["zero", "below-one"]],
    ["+1", ["below-two", "two"]], ["-1", ["future", "zero", "below-one"]],
    ["+0", ["below-one", "one", "below-two", "two"]], ["-0", ["future"]],
  ];
  for (const [operand, expected] of cases) test(`find ${predicate} ${operand} uses exact elapsed-time boundaries`, async context => {
    context.mock.method(Date, "now", () => now);
    const ages = { future: -1, zero: 0, "below-one": unit - 1, one: unit, "below-two": unit * 2 - 1, two: unit * 2 };
    const fs = await fixture(Object.fromEntries(Object.keys(ages).map(name => [name, "data"])));
    for (const [name, age] of Object.entries(ages)) await fs.utimes(`/work/${name}`, now - age, now - age);
    const result = await run("find", [".", "-type", "f", predicate, operand], { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, [...expected].sort().map(name => `./${name}\n`).join(""));
  });

  for (const operand of [undefined, "", "x", "1.5", "--1", "++1", "1e2", "9007199254740991", "9007199254740992"]) {
    test(`find ${predicate} rejects ${JSON.stringify(operand)} before actions`, async () => {
      const fs = await fixture({ keep: "keep" });
      const args = ["keep", "-delete", predicate, ...(operand === undefined ? [] : [operand])];
      const result = await run("find", args, { fs });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /requires an argument|invalid.*(time|number)/u);
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/keep")), "keep");
    });
  }
}

test("find captures invocation time once rather than aging files during traversal", async context => {
  const fs = await fixture({ first: "", second: "" });
  for (const name of ["first", "second"]) await fs.utimes(`/work/${name}`, now - 59_999, now - 59_999);
  let clock = now;
  context.mock.method(Date, "now", () => clock);
  const lstat = fs.lstat.bind(fs);
  context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => { clock += 60_000; return lstat(path, options); });
  const result = await run("find", [".", "-type", "f", "-mmin", "1"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "./first\n./second\n");
});

test("find -mtime signed boundaries retain GNU's strict older and one-second newer cutoff", async context => {
  context.mock.method(Date, "now", () => now);
  const fs = await fixture({ below: "", equal: "", above: "" });
  for (const [name, age] of [["below", 999], ["equal", 1000], ["above", 1001]] as const) {
    await fs.utimes(`/work/${name}`, now - age, now - age);
  }
  const result = await run("find", [".", "-type", "f", "-mtime", "-0"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "./below\n");
});

test("find -newer is strict and captures each reference before traversal", async context => {
  const fs = await fixture({ older: "", equal: "", newer: "", reference: "" });
  for (const [name, timestamp] of [["older", now - 1], ["equal", now], ["newer", now + 1], ["reference", now]] as const) {
    await fs.utimes(`/work/${name}`, timestamp, timestamp);
  }
  const lstat = fs.lstat.bind(fs);
  let referenceReads = 0;
  context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => {
    if (path === "/work/reference") referenceReads++;
    return lstat(path, options);
  });
  const result = await run("find", ["older", "equal", "newer", "-newer", "reference", "-newer", "reference"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "newer\n");
  assert.equal(result.stderr, "");
  assert.equal(referenceReads, 1);
});

for (const expression of [["-delete", "-newer", "missing"], ["-false", "-a", "-newer", "missing"], ["-print", "-newer", "missing"]]) {
  test(`find reference failure precedes traversal: ${expression.join(" ")}`, async () => {
    const fs = await fixture({ keep: "keep" });
    const result = await run("find", ["keep", ...expression], { fs });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /ENOENT.*missing/u);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/keep")), "keep");
  });
}

test("find -newer requires an operand and preserves option-looking reference names", async () => {
  const fs = await fixture({ keep: "", "-depth": "" });
  await fs.utimes("/work/-depth", 0, 0);
  assert.equal((await run("find", ["keep", "-newer"], { fs })).exitCode, 2);
  const result = await run("find", ["keep", "-newer", "-depth"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "keep\n");
});

for (const follow of ["-P", "-L"]) test(`find ${follow} applies symlink policy to time and reference metadata`, async context => {
  context.mock.method(Date, "now", () => now);
  const fs = await fixture({ candidate: "", reference: "" });
  await fs.utimes("/work/candidate", now - 60_000, now - 60_000);
  await fs.utimes("/work/reference", now - 120_000, now - 120_000);
  await fs.symlink("reference", "/work/reference-link");
  await fs.symlink("candidate", "/work/candidate-link");
  const newer = await run("find", [follow, "candidate", "-newer", "reference-link"], { fs });
  assert.equal(newer.exitCode, 0);
  assert.equal(newer.stdout, follow === "-L" ? "candidate\n" : "");
  const age = await run("find", [follow, "candidate-link", "-mmin", "2"], { fs });
  assert.equal(age.exitCode, 0);
  assert.equal(age.stdout, follow === "-L" ? "candidate-link\n" : "");
});

test("find -delete removes files then empty directories without implicit print", async context => {
  const fs = await fixture({ "tree/nested/file": "data" });
  const calls: string[] = [];
  const rm = fs.rm.bind(fs);
  const rmdir = fs.rmdir.bind(fs);
  context.mock.method(fs, "rm", async (path: string, options?: RemoveOptions) => {
    assert.notEqual(options?.recursive, true);
    assert.notEqual(options?.force, true);
    calls.push(`rm:${path}`);
    await rm(path, options);
  });
  context.mock.method(fs, "rmdir", async (path: string, options?: FsOptions) => { calls.push(`rmdir:${path}`); await rmdir(path, options); });
  const result = await run("find", ["tree", "-delete"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(calls, ["rm:/work/tree/nested/file", "rmdir:/work/tree/nested", "rmdir:/work/tree"]);
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("find -delete composes with AND, OR, negation, explicit print and short circuiting", async () => {
  for (const [expression, output, removed] of [
    [["-false", "-a", "-delete"], "", false],
    [["-true", "-o", "-delete"], "", false],
    [["-delete", "-a", "-print"], "file\n", true],
    [["!", "-delete", "-o", "-print"], "file\n", true],
    [["(", "-false", "-o", "-delete", ")", "-print0"], "file\0", true],
  ] as const) {
    const fs = await fixture({ file: "data" });
    const result = await run("find", ["file", ...expression], { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, output);
    assert.equal(result.stderr, "");
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), removed ? [] : ["file"]);
  }
});

test("find -delete failure is false for OR and leaves nonempty directories intact", async () => {
  const fs = await fixture({ "tree/child": "keep" });
  const result = await run("find", ["tree", "-maxdepth", "0", "-delete", "-o", "-print"], { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "tree\n");
  assert.match(result.stderr, /ENOTEMPTY/u);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/tree/child")), "keep");
});

test("find -delete preserves a child arriving after directory enumeration", async context => {
  const fs = await fixture();
  await fs.mkdir("/work/tree");
  const rmdir = fs.rmdir.bind(fs);
  context.mock.method(fs, "rmdir", async (path: string, options?: FsOptions) => {
    await fs.writeFile(`${path}/arrived`, new TextEncoder().encode("keep"));
    await rmdir(path, options);
  });
  const result = await run("find", ["tree", "-delete"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTEMPTY/u);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/tree/arrived")), "keep");
});

for (const explicitDepth of [false, true]) test(`find prune/delete requires explicit depth: ${explicitDepth}`, async () => {
  const fs = await fixture({ "tree/skip/child": "data" });
  const args = ["tree", ...(explicitDepth ? ["-depth"] : []), "-name", "skip", "-prune", "-o", "-delete", "-print"];
  const result = await run("find", args, { fs });
  assert.equal(result.exitCode, 1);
  if (explicitDepth) {
    assert.equal(result.stdout, "tree/skip/child\n");
    assert.match(result.stderr, /ENOTEMPTY/u);
    assert.deepEqual(await fs.readdir("/work/tree/skip"), []);
  } else {
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /-prune.*-depth|-depth.*-prune/u);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/tree/skip/child")), "data");
  }
});

test("find -delete honors mindepth and does not try to remove the default dot root", async () => {
  for (const args of [["-delete"], [".", "-mindepth", "1", "-delete"]]) {
    const fs = await fixture({ "tree/file": "data" });
    const result = await run("find", args, { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readdir("/work"), []);
  }
});

for (const follow of ["-P", "-L"]) test(`find ${follow} deletion traverses only when requested and unlinks the link`, async () => {
  const fs = await fixture({ "target/file": "keep" });
  await fs.symlink("target", "/work/link");
  const result = await run("find", [follow, "link", "-delete", "-print"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, follow === "-L" ? "link/file\nlink\n" : "link\n");
  assert.equal((await fs.stat("/work/target")).type, "directory");
  assert.deepEqual((await fs.readdir("/work/target")).map(entry => entry.name), follow === "-L" ? [] : ["file"]);
  await assert.rejects(fs.lstat("/work/link"), { code: "ENOENT" });
});

test("find -L -delete removes dangling links but refuses traversal cycles", async () => {
  const fs = await fixture();
  await fs.symlink("missing", "/work/dangling");
  assert.equal((await run("find", ["-L", "dangling", "-delete"], { fs })).exitCode, 0);
  await fs.symlink(".", "/work/cycle");
  const result = await run("find", ["-L", "cycle", "-delete"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ELOOP/u);
});

test("find -delete respects readonly backends and returns false to OR", async () => {
  const memory = await fixture({ keep: "keep" });
  const result = await run("find", ["keep", "-delete", "-o", "-print"], { fs: createReadOnlyFileSystem(memory) });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "keep\n");
  assert.match(result.stderr, /EROFS/u);
  assert.equal(new TextDecoder().decode(await memory.readFile("/work/keep")), "keep");
});

for (const capability of ["readOnly", "remove", "removeDirectory", "snapshotRmdir", "missing-rmdir"] as const) {
  test(`find -delete admits actual-path capabilities: ${capability}`, async () => {
    const memory = await fixture();
    await memory.mkdir("/work/empty");
    let mutations = 0;
    const fs = new Proxy(memory, {
      get(target, property) {
        if (property === "capabilitiesFor") return async () => ({ ...target.capabilities, [capability]: capability === "readOnly" || capability === "snapshotRmdir" });
        if (property === "rmdir" && capability === "missing-rmdir") return undefined;
        const member = Reflect.get(target, property);
        if (property === "rm" || property === "rmdir") return async () => { mutations++; };
        return typeof member === "function" ? member.bind(target) : member;
      },
    }) as FileSystem;
    const operand = capability === "remove" ? "file" : "empty";
    if (operand === "file") await memory.writeFile("/work/file", new Uint8Array());
    const result = await run("find", [operand, "-delete"], { fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, capability === "readOnly" ? /EROFS/u : /ENOTSUP/u);
    assert.equal(mutations, 0);
    assert.ok(await memory.lstat(`/work/${operand}`));
  });
}

for (const reason of [false, 0, "", null]) {
  for (const operation of ["rm", "rmdir", "lstat"] as const) {
    test(`find preserves falsey cancellation ${JSON.stringify(reason)} from ${operation}`, async context => {
      const fs = await fixture({ first: "data", second: "keep" });
      await fs.mkdir("/work/empty");
      const controller = new AbortController();
      const original = fs[operation].bind(fs);
      context.mock.method(fs, operation, async (path: string, options?: FsOptions) => {
        if (operation === "rm") await original(path, options);
        controller.abort(reason);
        throw reason;
      });
      const args = operation === "lstat" ? ["first", "-newer", "second"] : [operation === "rmdir" ? "empty" : "first", "second", "-delete"];
      let rejected = false;
      try { await run("find", args, { fs, signal: controller.signal }); }
      catch (error) { rejected = true; assert.equal(error, reason); }
      assert.equal(rejected, true);
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/second")), "keep");
      if (operation === "rm") await assert.rejects(fs.readFile("/work/first"), { code: "ENOENT" });
    });
  }
}

test("find -delete preserves the existing directory-entry cap", async context => {
  const fs = await fixture({ "tree/first": "keep", "tree/second": "keep" });
  const commands = new CommandRegistry(createStandardCommands({ maxDirectoryEntries: 1 }));
  const shell = new Shell({ fs, commands, cwd: "/work" });
  context.after(() => shell.dispose());
  const result = await shell.exec("find tree -delete");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /directory entry limit/u);
  assert.deepEqual((await fs.readdir("/work/tree")).map(entry => entry.name), ["first", "second"]);
});

test("find -delete preserves the 1024 depth ceiling without recursively removing unvisited descendants", async context => {
  const fs = await fixture();
  const directory = await fs.lstat("/work");
  let deepest = 0;
  let removals = 0;
  context.mock.method(fs, "lstat", async (path: string) => { deepest = Math.max(deepest, path.split("/").length - 3); return directory; });
  context.mock.method(fs, "realpath", async (path: string) => path);
  context.mock.method(fs, "readdir", async () => [{ name: "child", type: "directory" as const }]);
  context.mock.method(fs, "rmdir", async () => { removals++; throw new FsError("ENOTEMPTY"); });
  const result = await run("find", ["tree", "-delete"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /find depth limit exceeded \(1024\)/u);
  assert.equal(deepest, 1024);
  assert.equal(removals, 1025);
});

test("find treats -delete and -depth inside predicate/exec operands as literal values", async () => {
  const fs = await fixture({ "-depth": "keep", file: "keep" });
  const named = await run("find", [".", "-name", "-depth"], { fs });
  assert.equal(named.exitCode, 0);
  assert.equal(named.stdout, "./-depth\n");
  const result = await run("find", ["file", "-exec", "printf", "%s", "-delete", ";"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "-delete");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/file")), "keep");
});

test("find -delete implies postorder even when the action is short-circuited", async () => {
  const fs = await fixture({ "tree/file": "keep" });
  const result = await run("find", ["tree", "-print", "-false", "-a", "-delete"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "tree/file\ntree\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/tree/file")), "keep");
});

test("find time predicates compose with destructive actions without implicit output", async context => {
  context.mock.method(Date, "now", () => now);
  const fs = await fixture({ old: "remove", recent: "keep", reference: "keep" });
  await fs.utimes("/work/old", 0, 0);
  await fs.utimes("/work/reference", now - 1, now - 1);
  const old = await run("find", [".", "-type", "f", "-mtime", "+1", "-delete"], { fs });
  assert.equal(old.exitCode, 0);
  assert.equal(old.stdout, "");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["recent", "reference"]);
  const newer = await run("find", [".", "-type", "f", "-newer", "reference", "-delete"], { fs });
  assert.equal(newer.exitCode, 0);
  assert.equal(newer.stdout, "");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["reference"]);
});

test("find keeps the captured reference timestamp even when an action deletes the reference", async () => {
  const fs = await fixture({ reference: "", newer: "" });
  await fs.utimes("/work/reference", 0, 0);
  const result = await run("find", ["reference", "newer", "-delete", "-newer", "reference", "-print"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "newer\n");
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("find -L -newer falls back for dangling reference links but preserves permission failures", async context => {
  context.mock.method(Date, "now", () => now);
  const fs = await fixture({ candidate: "keep" });
  await fs.utimes("/work/candidate", now + 1, now + 1);
  await fs.symlink("missing", "/work/reference");
  const result = await run("find", ["-L", "candidate", "-newer", "reference"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "candidate\n");
  context.mock.method(fs, "stat", async () => { throw new FsError("EACCES"); });
  const denied = await run("find", ["-L", "candidate", "-delete", "-newer", "reference"], { fs });
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.stdout, "");
  assert.match(denied.stderr, /EACCES/u);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/candidate")), "keep");
});

test("find output limits stop later deletions without rolling back completed ones", async context => {
  const fs = await fixture({ first: "remove", second: "keep" });
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()), cwd: "/work", limits: { maxOutputBytes: 1 } });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("find . -mindepth 1 -delete -print"), { limit: "maxOutputBytes" });
  await assert.rejects(fs.lstat("/work/first"), { code: "ENOENT" });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/second")), "keep");
});

test("find retains unsupported time/ownership/traversal syntax without deleting files", async () => {
  const fs = await fixture({ keep: "keep" });
  for (const expression of [["-daystart"], ["-newermt", "2026-09-05"], ["-atime", "1"], ["-user", "root"], ["-execdir", "true", ";"], ["-xdev"]]) {
    const result = await run("find", ["keep", "-delete", ...expression], { fs });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /unsupported expression/u);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/keep")), "keep");
  }
});
