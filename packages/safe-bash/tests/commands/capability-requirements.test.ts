import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem, FileSystemCapabilities } from "../../src/contracts/filesystem.js";
import { evaluateCommandSupport } from "../../src/contracts/command-requirements.js";
import { filesystemCommands } from "../../src/commands/filesystem.js";
import { fixture, run } from "./helpers.js";
import * as browser from "../../src/browser.js";
import * as root from "../../src/index.js";

test("cross-mount move retains its existing route without requiring native backend rename", async () => {
  const source = await fixture({ source: "payload" });
  const target = await fixture({ target: "previous" });
  const fs = new root.MountFileSystem({ root: await fixture(), mounts: {
    "/source": restricted(source, { rename: false }),
    "/target": restricted(target, { rename: false }),
  } });
  const definition = filesystemCommands().find(command => command.name === "mv")!;
  assert.equal(evaluateCommandSupport(definition, fs.capabilities).status, "partial");
  const result = await run("mv", ["/source/work/source", "/target/work/target"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(await target.readFile("/work/target")), "payload");
  await assert.rejects(source.stat("/work/source"), { code: "ENOENT" });
});

test("cross-mount move admits source removal and destination publication before content effects", async () => {
  for (const denied of ["remove", "copy"] as const) {
    const source = await fixture({ source: "payload" });
    const target = await fixture({ target: "previous" });
    const fs = new root.MountFileSystem({ root: await fixture(), mounts: {
      "/source": restricted(source, denied === "remove" ? { remove: false } : {}),
      "/target": restricted(target, denied === "copy" ? { copy: false, exclusiveCopy: false,
        write: false, streamingWrite: false, exclusiveCreate: false } : {}),
    } });
    const result = await run("mv", ["/source/work/source", "/target/work/target"], { fs });
    assert.equal(result.exitCode, 1, denied);
    assert.match(result.stderr, /ENOTSUP/u);
    assert.equal(new TextDecoder().decode(await target.readFile("/work/target")), "previous");
    assert.equal(new TextDecoder().decode(await source.readFile("/work/source")), "payload");
  }
});

test("existing cross-mount transfer routes override unavailable native copy modes without new fallback", async () => {
  for (const command of ["cp", "mv"]) for (const missing of [false, true]) {
    const source = await fixture({ source: "payload" });
    const target = await fixture(missing ? {} : { target: "previous" });
    let nativeCopies = 0;
    const destination = new Proxy(restricted(target, { rename: false, copy: false, exclusiveCopy: false }), {
      get(backing, property) {
        if (property === "copyFile") return async () => { nativeCopies++; assert.fail("native destination copy is not this route"); };
        return Reflect.get(backing, property);
      },
    });
    const fs = new root.MountFileSystem({ root: await fixture(), mounts: { "/source": source, "/target": destination } });
    await fs.copyFile("/source/work/source", "/target/work/proof", { exclusive: true });
    assert.equal(new TextDecoder().decode(await target.readFile("/work/proof")), "payload");
    const result = await run(command, ["/source/work/source", "/target/work/target"], { fs });
    assert.equal(result.exitCode, 0, `${command} missing=${missing}: ${result.stderr}`);
    assert.equal(new TextDecoder().decode(await target.readFile("/work/target")), "payload");
    assert.equal(nativeCopies, 0);
    if (command === "mv") await assert.rejects(source.stat("/work/source"), { code: "ENOENT" });
    else assert.equal(new TextDecoder().decode(await source.readFile("/work/source")), "payload");
  }
});

test("cross-mount transfers preserve independent exclusive creation on a create-only destination", async () => {
  for (const command of ["cp", "mv"]) {
    const source = await fixture({ source: "payload" });
    const target = await fixture();
    const flags: string[] = [];
    const createOnly = new Proxy(restricted(target, { copy: false, exclusiveCopy: false,
      write: false, streamingWrite: false, exclusiveCreate: true }), {
      get(backing, property) {
        if (property === "writeFile") return async (path: string, bytes: Uint8Array, options: Parameters<FileSystem["writeFile"]>[2]) => {
          assert.equal(options?.flag, "wx");
          flags.push(options?.flag ?? "");
          await target.writeFile(path, bytes, options);
        };
        return Reflect.get(backing, property);
      },
    });
    const fs = new root.MountFileSystem({ root: await fixture(), mounts: { "/source": source, "/target": createOnly } });
    await fs.copyFile("/source/work/source", "/target/work/proof", { exclusive: true });
    const result = await run(command, ["/source/work/source", "/target/work/new"], { fs });
    assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
    assert.equal(new TextDecoder().decode(await target.readFile("/work/new")), "payload");
    assert.deepEqual(flags, ["wx", "wx"]);
    if (command === "mv") await assert.rejects(source.stat("/work/source"), { code: "ENOENT" });
    else assert.equal(new TextDecoder().decode(await source.readFile("/work/source")), "payload");
  }
});

function restricted(fs: FileSystem, capabilities: FileSystemCapabilities): FileSystem {
  return new Proxy(fs, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, ...capabilities };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

test("capability evaluation and admission are shared public browser and root APIs", () => {
  assert.equal("evaluateCommandSupport" in browser, true);
  assert.equal("assertCommandRequirements" in browser, true);
  assert.equal(Reflect.get(browser, "evaluateCommandSupport"), evaluateCommandSupport);
  assert.equal(Reflect.get(root, "evaluateCommandSupport"), evaluateCommandSupport);
  assert.equal(Reflect.get(root, "assertCommandRequirements"), Reflect.get(browser, "assertCommandRequirements"));
});

test("command help distinguishes modes and unknown declarations without probing methods", () => {
  const command = filesystemCommands().find(command => command.name === "touch")!;
  const support = evaluateCommandSupport(command, { stat: true, exclusiveCreate: true, timestamps: false });
  assert.equal(support.status, "partial");
  assert.equal(support.modes.find(mode => mode.id === "create")?.status, "supported");
  assert.equal(support.modes.find(mode => mode.id === "existing")?.status, "unsupported");
  assert.equal(evaluateCommandSupport(command, {}).status, "partial");
  assert.equal(evaluateCommandSupport(filesystemCommands().find(command => command.name === "mkdir")!, {
    explicitDirectories: false, mkdir: false, recursiveMkdir: false,
  }).status, "unsupported");
  assert.equal(evaluateCommandSupport({ name: "custom", execute: () => ({ exitCode: 0 }) }, {}).status, "partial");
  assert.deepEqual(evaluateCommandSupport({ filesystemRequirements: [] }, {}), { status: "supported", declared: true, modes: [] });
});

test("browser pure and optional-file commands have honest capability help", () => {
  for (const command of browser.createBrowserCommands()) {
    assert.equal(evaluateCommandSupport(command, {}).declared, true, command.name);
    if (["echo", "printf", "true", "false", "basename", "dirname", "tr"].includes(command.name)) {
      assert.equal(evaluateCommandSupport(command, {}).status, "supported", command.name);
    }
    if (["cat", "cut", "sort", "uniq", "head", "tail", "wc"].includes(command.name)) {
      const support = evaluateCommandSupport(command, { read: false, streamingRead: false, write: false, streamingWrite: false });
      assert.equal(support.status, "partial", command.name);
      assert.equal(support.modes.find(mode => mode.id === "stdin")?.status, "supported", command.name);
      assert.equal(support.modes.find(mode => mode.id === "file")?.status, "unsupported", command.name);
    }
  }
});

test("text file input and output modes fail before reading stdin or truncating output", async () => {
  const backing = await fixture({ input: "b\na\n", output: "keep" });
  const fs = restricted(backing, { read: false, streamingRead: false, write: false, streamingWrite: false });
  for (const [command, args] of [["cut", ["-b1", "input"]], ["sort", ["input"]], ["uniq", ["input", "output"]]] as const) {
    const result = await run(command, args, { fs });
    assert.equal(result.exitCode, 1, command);
    assert.equal(result.stdout, "", command);
    assert.match(result.stderr, /ENOTSUP/u, command);
  }
  let pulls = 0;
  const stdin = { async *[Symbol.asyncIterator]() { pulls++; yield new TextEncoder().encode("b\na\n"); } };
  assert.equal((await run("sort", ["-o", "output"], { fs, stdin })).exitCode, 1);
  assert.equal((await run("uniq", ["-", "output"], { fs, stdin })).exitCode, 1);
  assert.equal(pulls, 0);
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/output")), "keep");
  assert.equal((await run("cut", ["-b1"], { fs, stdin: "abc\n" })).stdout, "a\n");
});

test("pwd and predicates admit filesystem modes without blocking pure expressions", async () => {
  const fs = restricted(await fixture({ file: "x" }), { realpath: false, stat: false, access: false });
  assert.equal((await run("pwd", [], { fs })).exitCode, 0);
  assert.equal((await run("pwd", ["-P"], { fs })).exitCode, 1);
  assert.equal((await run("test", ["1", "-eq", "1"], { fs })).exitCode, 0);
  assert.equal((await run("test", ["-e", "file"], { fs })).exitCode, 1);
  assert.match((await run("test", ["-r", "file"], { fs })).stderr, /ENOTSUP/u);
});

test("predicate capability lookup preserves ordinary missing-path results", async () => {
  const backing = await fixture();
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilitiesFor") return async () => { throw Object.assign(new Error("missing parent"), { code: "ENOENT" }); };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  for (const flag of ["-e", "-r"]) {
    const result = await run("test", [flag, "missing/file"], { fs });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "");
  }
});

test("every portable filesystem-family command exposes requirements, including inspection", () => {
  const expected = ["cp", "ln", "ls", "mkdir", "mv", "readlink", "realpath", "rm", "rmdir", "touch"];
  assert.deepEqual(filesystemCommands().map(command => command.name).sort(), expected);
  for (const command of filesystemCommands()) assert.equal(evaluateCommandSupport(command, {}).declared, true, command.name);
});

test("inspection commands honor known unsupported listing and canonicalization", async () => {
  const backing = await fixture({ source: "keep" });
  assert.equal((await run("ls", ["."], { fs: restricted(backing, { readdir: false }) })).exitCode, 1);
  assert.equal((await run("ls", ["-d", "source"], { fs: restricted(backing, { readdir: false }) })).exitCode, 0);
  assert.equal((await run("realpath", ["source"], { fs: restricted(backing, { realpath: false }) })).exitCode, 1);
});

test("path-specific requirements reject later operands before earlier mutations", async () => {
  const backing = await fixture({ existing: "keep" });
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilitiesFor") return async (path: string) => ({
        ...target.capabilities, timestamps: path !== "/work/existing", exclusiveCreate: true,
      });
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  assert.equal((await run("touch", ["new", "existing"], { fs })).exitCode, 1);
  await assert.rejects(backing.stat("/work/new"), { code: "ENOENT" });
});

test("rmdir -p admits parent capabilities before removing children", async () => {
  const backing = await fixture();
  await backing.mkdir("/work/parent/child", { recursive: true });
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilitiesFor") return async (path: string) => ({
        ...target.capabilities, removeDirectory: path !== "/work/parent",
      });
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
  assert.equal((await run("rmdir", ["-p", "parent/child"], { fs })).exitCode, 1);
  assert.equal((await backing.stat("/work/parent/child")).type, "directory");
});

test("touch admits all known requirements before creating any operand", async () => {
  const backing = await fixture({ existing: "keep" });
  const fs = restricted(backing, { exclusiveCreate: true, timestamps: false });
  const result = await run("touch", ["new", "existing"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOTSUP/u);
  await assert.rejects(backing.stat("/work/new"), { code: "ENOENT" });
  assert.equal((await run("touch", ["new"], { fs })).exitCode, 0);
});

test("touch missing needs exclusive creation, not ordinary write or timestamp updates", async () => {
  const backing = await fixture({ existing: "keep", reference: "time" });
  const fs = restricted(backing, { write: true, exclusiveCreate: false, timestamps: true });
  assert.equal((await run("touch", ["missing"], { fs })).exitCode, 1);
  await assert.rejects(backing.stat("/work/missing"), { code: "ENOENT" });
  assert.equal((await run("touch", ["-c", "missing"], { fs })).exitCode, 0);
  assert.equal((await run("touch", ["existing"], { fs })).exitCode, 0);
  const noTimes = restricted(backing, { exclusiveCreate: true, timestamps: false });
  assert.equal((await run("touch", ["-r", "reference", "missing"], { fs: noTimes })).exitCode, 1);
  await assert.rejects(backing.stat("/work/missing"), { code: "ENOENT" });
});

test("mandatory methods do not override known unsupported filesystem modes", async () => {
  for (const [command, args, capabilities] of [
    ["mkdir", ["new"], { explicitDirectories: false }],
    ["mkdir", ["-p", "new/deep"], { recursiveMkdir: false }],
    ["mv", ["source", "target"], { rename: false }],
    ["cp", ["source", "target"], { copy: false }],
    ["rm", ["source"], { remove: false }],
    ["rm", ["-r", "directory"], { recursiveRemove: false }],
    ["rmdir", ["directory"], { removeDirectory: false }],
    ["ln", ["-sf", "source", "target"], { symlinks: false }],
    ["ln", ["-f", "source", "target"], { hardlinks: false }],
  ] as const) {
    const backing = await fixture({ source: "source", target: "keep" });
    await backing.mkdir("/work/directory");
    const result = await run(command, args, { fs: restricted(backing, capabilities) });
    assert.equal(result.exitCode, 1, command);
    assert.match(result.stderr, /ENOTSUP/u, command);
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/target")), "keep", command);
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/source")), "source", command);
    assert.equal((await backing.stat("/work/directory")).type, "directory", command);
    await assert.rejects(backing.stat("/work/new"), { code: "ENOENT" });
  }
});

test("recursive copy preflights nested link requirements before making destination directories", async () => {
  const backing = await fixture({ "tree/file": "payload" });
  await backing.symlink("file", "/work/tree/link");
  const result = await run("cp", ["-R", "tree", "new"], { fs: restricted(backing, { symlinks: false }) });
  assert.equal(result.exitCode, 1);
  await assert.rejects(backing.stat("/work/new"), { code: "ENOENT" });
});

test("readlink is independent of the ability to create links", async () => {
  const backing = await fixture({ source: "keep" });
  await backing.symlink("source", "/work/link");
  const result = await run("readlink", ["link"], { fs: restricted(backing, { symlinks: false, readlink: true }) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "source\n");
  assert.equal((await run("readlink", ["link"], { fs: restricted(backing, { readlink: false }) })).exitCode, 1);
});
