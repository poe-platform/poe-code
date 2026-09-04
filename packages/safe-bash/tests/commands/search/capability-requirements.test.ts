import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { CommandRegistry, evaluateCommandSupport, toByteSource, type CommandContext, type FileSystem, type FileSystemCapabilities } from "../../../src/contracts/index.js";
import { portableSearchCommands } from "../../../src/commands/search/portable.js";
import { fixture } from "../helpers.js";

const provider = {
  createWorker() {
    return new Worker(new URL("../../../dist/commands/regex-execution/worker.js", import.meta.url), { execArgv: [] });
  },
};

function profile(backing: FileSystem, capabilities: FileSystemCapabilities, calls: string[] = [], selected?: (path: string) => FileSystemCapabilities): FileSystem {
  return new Proxy(backing, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, ...capabilities };
      if (property === "capabilitiesFor" && selected) return async (path: string) => ({ ...target.capabilities, ...capabilities, ...selected(path) });
      const member = Reflect.get(target, property);
      return typeof member === "function" ? (...args: unknown[]) => {
        calls.push(`${String(property)}:${String(args[0])}`);
        return member.apply(target, args);
      } : member;
    },
  });
}

async function run(name: string, args: readonly string[], fs: FileSystem, stdin = "match\nother\n") {
  const commands = new CommandRegistry();
  const plugin = portableSearchCommands({ provider });
  await plugin.setup({ commands, use() {}, registerFileSystem() {} });
  let stdout = "";
  let stderr = "";
  let pulls = 0;
  const context: CommandContext = {
    command: name, args, cwd: "/work", env: {}, fs, signal: new AbortController().signal,
    stdinIsDefault: false,
    stdin: { async *[Symbol.asyncIterator]() { pulls++; yield* toByteSource(stdin); } },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  };
  try { return { ...await commands.get(name)!.execute(context), stdout, stderr, pulls }; }
  finally { await plugin.dispose?.(); }
}

test("portable search definitions expose stdin, file, and special filesystem modes", async () => {
  const commands = new CommandRegistry();
  const plugin = portableSearchCommands({ provider });
  await plugin.setup({ commands, use() {}, registerFileSystem() {} });
  try {
    for (const command of commands.list()) {
      const help = evaluateCommandSupport(command, { readOnly: true, read: false, streamingRead: false });
      assert.equal(help.declared, true, command.name);
      assert.equal(help.status, "partial", command.name);
      assert.equal(help.modes.find(mode => mode.id === "stdin")?.status, "supported", command.name);
      assert.equal(help.modes.find(mode => mode.id === "file")?.status, "unsupported", command.name);
    }
    assert.ok(commands.get("rg")!.filesystemRequirements!.some(mode => mode.id === "ignore-file"));
    assert.ok(commands.get("sed")!.filesystemRequirements!.some(mode => mode.id === "in-place"));
  } finally { await plugin.dispose?.(); }
});

test("pure stdin works on readonly filesystems with unsupported file primitives", async () => {
  const calls: string[] = [];
  const fs = profile(await fixture(), { readOnly: true, read: false, streamingRead: false, stat: false, readdir: false, realpath: false, write: false, append: false }, calls);
  for (const [name, args] of [["grep", ["match"]], ["rg", ["match", "-"]], ["sed", ["-n", "/match/p"]]] as const) {
    const result = await run(name, args, fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "match\n");
  }
  assert.deepEqual(calls, []);
});

test("max-count zero does not admit or read unused input files", async () => {
  const calls: string[] = [];
  const fs = profile(await fixture({ file: "match\n" }), { read: false, streamingRead: false, stat: false, readdir: false, realpath: false }, calls);
  for (const name of ["grep", "rg"]) {
    const result = await run(name, ["-m0", "match", "file"], fs);
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.pulls, 0);
  }
  assert.deepEqual(calls, []);
});

test("pattern and script files use their actual read routes even with no input scan", async () => {
  const backing = await fixture({ patterns: "match\n", script: "p", file: "match\n" });
  const calls: string[] = [];
  const fs = profile(backing, { read: false, streamingRead: false }, calls);
  for (const name of ["grep", "rg"]) {
    const result = await run(name, ["-m0", "-f", "patterns", "file"], fs);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /ENOTSUP/);
  }
  assert.match((await run("sed", ["-f", "script"], fs)).stderr, /ENOTSUP/);
  assert.deepEqual(calls, []);
  assert.match((await run("rg", ["-f", "patterns", "-"], profile(backing, { read: false, streamingRead: true }))).stderr, /ENOTSUP/);
});

test("rg --files admits directory traversal but no content reads when ignores are disabled", async () => {
  const backing = await fixture({ "tree/file": "match\n" });
  const fs = profile(backing, { read: false, streamingRead: false });
  const files = await run("rg", ["--files", "--no-ignore", "tree"], fs);
  assert.equal(files.exitCode, 0, files.stderr);
  assert.equal(files.stdout, "tree/file\n");
  const ignored = await run("rg", ["--files", "tree"], fs);
  assert.equal(ignored.exitCode, 2);
  assert.equal(ignored.stdout, "");
  assert.match(ignored.stderr, /ENOTSUP/);
  const noWalk = await run("rg", ["--files", "--no-ignore", "tree"], profile(backing, { readdir: false }));
  assert.equal(noWalk.exitCode, 2);
  assert.equal(noWalk.stdout, "");
  assert.match(noWalk.stderr, /ENOTSUP/);
});

test("rg file input honors the read route and does not require directory primitives", async () => {
  const backing = await fixture({ file: "match\n" });
  const calls: string[] = [];
  const result = await run("rg", ["match", "file"], profile(backing, { readdir: false, realpath: false, streamingRead: false, read: true }, calls));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "match\n");
  assert.ok(calls.includes("readFile:/work/file"));
  assert.ok(!calls.some(call => call.startsWith("readStream:")));
});

test("rg depth zero does not admit unused directory or content operations", async () => {
  const calls: string[] = [];
  const backing = await fixture({ "tree/file": "match\n" });
  const fs = profile(backing, { read: false, streamingRead: false, readdir: false, realpath: false }, calls);
  const result = await run("rg", ["--files", "--no-ignore", "--max-depth", "0", "tree"], fs);
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(calls.every(call => call.startsWith("stat:") || call.startsWith("lstat:")));
});

test("rg directory symlink canonicalization does not require an unvisited child's listing", async () => {
  const backing = await fixture({ "tree/file": "match\n", "other/file": "match\n" });
  await backing.symlink("../other", "/work/tree/link");
  const fs = profile(backing, {}, [], path => path === "/work/tree/link" ? { readdir: false } : {});
  const result = await run("rg", ["--files", "--no-ignore", "--follow", "--max-depth", "1", "tree"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "tree/file\n");
});

test("rg uses enumerated file types without requiring unused child stat operations", async () => {
  const backing = await fixture({ "tree/file": "match\n" });
  const fs = profile(backing, {}, [], path => path === "/work/tree/file" ? { stat: false } : {});
  const result = await run("rg", ["--no-ignore", "match", "tree"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "tree/file:match\n");
});

test("unknown filesystem declarations remain compatible without claiming proven support", async () => {
  const backing = await fixture({ file: "match\n" });
  const fs = profile(backing, Object.fromEntries(Object.keys(backing.capabilities).map(name => [name, undefined])));
  for (const [name, args] of [["grep", ["match", "file"]], ["rg", ["match", "file"]], ["sed", ["-i", "s/match/new/", "file"]]] as const) {
    const result = await run(name, args, fs);
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/file")), "new\n");
});

test("sed mutation modes reject before output initialization, input consumption, or backups", async () => {
  for (const [args, capabilities] of [
    [["-i", "s/match/new/", "file"], { readOnly: true }],
    [["-i.bak", "w output", "file"], { copy: false }],
    [["w output"], { append: false }],
    [["s/match/new/w output"], { write: false }],
  ] as const) {
    const backing = await fixture({ file: "match\n", output: "keep" });
    const result = await run("sed", args, profile(backing, capabilities));
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /ENOTSUP|EROFS/);
    assert.equal(result.stdout, "");
    assert.equal(result.pulls, 0);
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/file")), "match\n");
    assert.equal(new TextDecoder().decode(await backing.readFile("/work/output")), "keep");
    await assert.rejects(backing.stat("/work/file.bak"), { code: "ENOENT" });
  }
});

test("sed preflights all selected in-place paths before changing the first", async () => {
  const backing = await fixture({ first: "match\n", second: "match\n" });
  const fs = profile(backing, {}, [], path => path === "/work/second" ? { write: false } : {});
  assert.match((await run("sed", ["-i", "s/match/new/", "first", "second"], fs)).stderr, /ENOTSUP/);
  assert.equal(new TextDecoder().decode(await backing.readFile("/work/first")), "match\n");
});

test("sed lazy reads and grep quiet mode do not admit skipped paths", async () => {
  const backing = await fixture({ first: "match\n", second: "match\n", extra: "extra\n" });
  const fs = profile(backing, {}, [], path => path === "/work/second" || path === "/work/extra" ? { read: false, streamingRead: false } : {});
  assert.equal((await run("grep", ["-q", "match", "first", "second"], fs)).exitCode, 0);
  assert.equal((await run("rg", ["-q", "match", "first", "second"], fs)).exitCode, 0);
  assert.equal((await run("sed", ["q", "first", "second"], fs)).exitCode, 0);
  assert.equal((await run("sed", ["-n", "2r extra"], fs, "one\n")).exitCode, 0);
  const reached = await run("sed", ["r extra"], fs, "one\n");
  assert.notEqual(reached.exitCode, 0);
  assert.equal(reached.stdout, "");
});
