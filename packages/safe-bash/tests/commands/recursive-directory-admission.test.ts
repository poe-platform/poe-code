import assert from "node:assert/strict";
import test from "node:test";
import { createTreeCommand } from "../../src/commands/tree/tree.js";
import { createDuCommand } from "../../src/commands/du/du.js";
import { createSearchCommands } from "../../src/commands/search/index.js";
import { createChmodCommand } from "../../src/commands/metadata/chmod.js";
import { createDiffPatchCommands } from "../../src/commands/diff-patch/index.js";
import { createNodeRegexProvider } from "../../src/node.js";
import { createTarCommand } from "../../src/commands/archive/index.js";
import { MoveBudget, moveAcrossDevices } from "../../src/commands/move.js";
import { fixture, run } from "./helpers.js";

const routes = [
  { name: "tree", args: ["sub"], commands: [createTreeCommand({ limits: { maxDirectoryEntries: 2 } })], cap: 2 },
  { name: "du", args: ["--apparent-size", "sub"], commands: [createDuCommand({ limits: { maxDirectoryEntries: 2 } })], cap: 2 },
  { name: "rg", args: ["-F", "x", "sub"], commands: createSearchCommands({ maxFiles: 3, regexExecutor: createNodeRegexProvider() }), cap: 2 },
  { name: "chmod", args: ["-R", "755", "sub"], commands: [createChmodCommand({ limits: { maxEntries: 3 } })], cap: 2 },
  { name: "diff", args: ["sub", "other"], commands: createDiffPatchCommands({ maxFiles: 3 }), cap: 2 },
  { name: "tar", args: ["--format=ustar", "-cf", "-", "sub"], commands: [createTarCommand({ limits: { maxMembers: 3 } })], cap: 2 },
];

for (const route of routes) for (const honors of [true, false]) {
  test(`${route.name} admits directory size before provider work (honors=${honors})`, async () => {
    const fs = await fixture(Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`sub/${index}`, "x\n"])));
    await fs.mkdir("/work/other");
    const read = fs.readdir.bind(fs);
    const calls: (number | undefined)[] = [];
    fs.readdir = async (path, options) => {
      calls.push(options?.maxEntries);
      assert.equal(options?.maxEntries, route.cap);
      return read(path, honors ? options : undefined);
    };
    try {
      const result = await run(route.name, route.args, { fs, commands: route.commands });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /limit exceeded/u);
    } catch (error) {
      assert.equal(route.name, "tree");
      assert.equal((error as { code?: string }).code, "EFBIG");
    }
    assert.deepEqual(calls, [route.cap]);
  });
}

test("diff admits matching directory names once", async () => {
  const fs = await fixture({ "sub/a": "x\n", "sub/b": "x\n", "other/a": "x\n", "other/b": "x\n" });
  const read = fs.readdir.bind(fs);
  const caps: (number | undefined)[] = [];
  fs.readdir = async (path, options) => { caps.push(options?.maxEntries); return read(path, options); };
  assert.equal((await run("diff", ["sub", "other"], { fs, commands: createDiffPatchCommands({ maxFiles: 3 }) })).exitCode, 0);
  assert.deepEqual(caps, [2, 2]);
});

test("cross-device move admits its remaining traversal budget", async () => {
  const fs = await fixture({ "sub/a": "x" });
  const { context } = await run("true", [], { fs });
  const read = fs.readdir.bind(fs);
  const caps: (number | undefined)[] = [];
  fs.readdir = async (path, options) => { caps.push(options?.maxEntries); return read(path, options); };
  assert.equal(await moveAcrossDevices(context, "/work/sub", "/work/dest", false, new MoveBudget(context.signal)), true);
  assert.deepEqual(caps, [99997]);
});

for (const route of routes.filter(route => route.name !== "diff")) {
  test(`${route.name} accepts a listing exactly at the cap`, async () => {
    const fs = await fixture({ "sub/a": "x\n", "sub/b": "x\n" });
    const result = await run(route.name, route.args, { fs, commands: route.commands });
    assert.equal(result.exitCode, 0, result.stderr);
  });
}

for (const create of [createTreeCommand, createDuCommand]) {
  test(`${create.name} derives the cap from total entries when the per-directory limit is infinite`, async () => {
    const fs = await fixture({ "sub/a": "x", "sub/b": "x" });
    const read = fs.readdir.bind(fs);
    const caps: (number | undefined)[] = [];
    fs.readdir = async (path, options) => { caps.push(options?.maxEntries); return read(path, options); };
    const command = create({ limits: { maxEntries: 3 } });
    const args = command.name === "du" ? ["--apparent-size", "sub"] : ["sub"];
    assert.equal((await run(command.name, args, { fs, commands: [command] })).exitCode, 0);
    assert.deepEqual(caps, [2]);
  });
}

for (const route of [
  { name: "tree", commands: [createTreeCommand({ limits: { maxEntries: 1 } })] },
  { name: "du", commands: [createDuCommand({ limits: { maxEntries: 1 } })] },
  { name: "rg", commands: createSearchCommands({ maxFiles: 1, regexExecutor: createNodeRegexProvider() }) },
  { name: "chmod", commands: [createChmodCommand({ limits: { maxEntries: 1 } })] },
]) {
  test(`${route.name} admits an empty directory with zero entries remaining`, async () => {
    const fs = await fixture();
    await fs.mkdir("/work/sub");
    const read = fs.readdir.bind(fs);
    fs.readdir = async (path, options) => { assert.equal(options?.maxEntries, 0); return read(path, options); };
    const args = route.name === "rg" ? ["--files", "sub"] : route.name === "chmod" ? ["-R", "755", "sub"] : route.name === "du" ? ["--apparent-size", "sub"] : ["sub"];
    const result = await run(route.name, args, { fs, commands: route.commands });
    assert.equal(result.exitCode, route.name === "rg" ? 1 : 0, result.stderr);
  });
}
