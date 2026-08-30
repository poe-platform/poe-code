import assert from "node:assert/strict";
import test from "node:test";
import { createTreeCommand, createTreeCommands, treeCommands } from "../../../src/commands/tree/index.js";
import { CommandRegistry, FsError, type PluginHost } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { run, seed, shellRun, wrapped } from "./helpers.js";

test("standalone API, replacement preflight, snapshot options and positive integer limits", () => {
  assert.equal(createTreeCommand().name, "tree");
  assert.deepEqual(createTreeCommands().map(command => command.name), ["tree"]);
  const original = { name: "tree", execute() { return { exitCode: 42 }; } };
  const host: PluginHost = { commands: new CommandRegistry([original]), use() {}, registerFileSystem() {} };
  assert.throws(() => treeCommands().setup(host), /already registered/u);
  assert.equal(host.commands.get("tree")!.execute, original.execute);
  const options = { replace: true };
  const plugin = treeCommands(options);
  options.replace = false;
  plugin.setup(host);
  assert.notEqual(host.commands.get("tree")!.execute, original.execute);
  for (const value of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => createTreeCommand({ limits: { maxDepth: value } }), RangeError);
});

test("unsupported/invalid options preflight before any VFS or stdin access", async () => {
  const fs = wrapped(createMemoryFileSystem(), { async lstat() { throw new Error("unexpected lstat"); } });
  for (const args of [["--du"], ["-s"], ["--prune"], ["-C"], ["--filelimit=3"], ["-L0"], ["-L257"], ["-L"],
    ["--sort=size"], ["--charset=ANSI"], ["-P", "**"], ["-P", "dir/*"], ["-I", "[x"], ["-P", "[z-a]"],
    ["--help", "--du"], [""], ["\0"], ["\ud800"]]) {
    const result = await run(args, {}, { fs, stdin: (async function* () { throw new Error("unexpected stdin"); })() });
    assert.equal(result.exitCode, 2, args.join(" "));
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /unexpected/u);
  }
});

test("files, missing operands, option-like names, repeat roots and valid error JSON", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array());
  await fs.mkdir("/-dash");
  await fs.writeFile("/-dash/child", new Uint8Array());
  assert.equal((await shellRun(fs, ["--noreport", "file"])).stdout, "file\n");
  assert.equal((await shellRun(fs, ["--noreport", "--", "-dash"])).stdout, "-dash\n`-- child\n");
  const result = await shellRun(fs, ["-Ji", "missing", "file", "file"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /tree: missing: no such file or directory/u);
  const data = JSON.parse(result.stdout);
  assert.equal(data[0].type, "unknown");
  assert.match(data[0].error, /no such file/u);
  assert.deepEqual(data.slice(1), [{ type: "file", name: "file" }, { type: "file", name: "file" }, { type: "report", directories: 0, files: 2 }]);
});

test("Unicode, newline, terminal controls and link targets round-trip without control injection", async () => {
  const fs = createMemoryFileSystem();
  const names = ['quote"', "雪", "line\nfeed", "control\u001b[31m", "\u0085", "\u202e", "\u2028", "back\\slash"];
  for (const name of names) await fs.writeFile(`/${name}`, new Uint8Array());
  await fs.symlink!("line\nfeed", "/symlink");
  const text = await shellRun(fs, ["--noreport"]);
  assert.equal(text.stdout.split("\n").length, names.length + 3);
  assert.match(text.stdout, /\\033\[31m/u);
  assert.match(text.stdout, /symlink -> line\\nfeed/u);
  assert.doesNotMatch(text.stdout, /[\u001b\u0085\u202e\u2028]/u);
  const result = await shellRun(fs, ["-Ji", "--noreport"]);
  assert.doesNotMatch(result.stdout, /[\u001b\u0085\u202e\u2028]/u);
  assert.deepEqual(JSON.parse(result.stdout)[0].contents.map((entry: { name: string }) => entry.name).sort(), [...names, "symlink"].sort());
});

test("default nofollow includes operands; -l skips ancestors but traverses sibling aliases", async () => {
  const fs = createMemoryFileSystem();
  await seed(fs);
  assert.equal((await shellRun(fs, ["--noreport", "link"])).stdout, "link -> dir\n");
  const result = await shellRun(fs, ["-li", "--noreport"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.match(/c\.md\n/gu)?.length, 2);
  assert.equal(result.stdout.match(/recursive, not followed/gu)?.length, 2);
  assert.doesNotMatch(result.stdout, /link -> dir {2}\[recursive/u);
  const json = JSON.parse((await shellRun(fs, ["-Jli", "--noreport", "link"])).stdout);
  assert.equal(json[0].type, "link");
  assert.equal(json[0].contents[0].name, "sub");
});

test("broken links remain entries, while denied stat/readlink/readdir remain failures", async () => {
  const backing = createMemoryFileSystem();
  await seed(backing);
  const denied = wrapped(backing, { async readdir(path, options) {
    if (path === "/dir") throw new FsError("EACCES", { path, syscall: "readdir" });
    return backing.readdir(path, options);
  } });
  const result = await shellRun(denied, ["-Ji", "--noreport"]);
  assert.equal(result.exitCode, 1);
  const contents = JSON.parse(result.stdout)[0].contents;
  assert.match(contents.find((entry: { name: string }) => entry.name === "dir").error, /permission denied/u);
  assert.equal(contents.find((entry: { name: string }) => entry.name === "broken").error, undefined);
  assert.ok(contents.some((entry: { name: string }) => entry.name === "雪"));
  const statDenied = wrapped(backing, { async stat() { throw new FsError("EPERM"); } });
  assert.equal((await run(["link"], {}, { fs: statDenied })).exitCode, 1);
  const noReadlink = wrapped(backing, { readlink: undefined });
  assert.match((await run(["link"], {}, { fs: noReadlink })).stderr, /operation not supported/u);
});

test("actual shell pipelines, files, substitutions and literal invocation preserve state", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/data"); await fs.writeFile("/data/a.txt", new Uint8Array());
  const shell = new Shell({ fs, cwd: "/data", env: { KEPT: "parent" } }).use(standardCommands()).use(treeCommands());
  shell.commands.register({ name: "call-tree", async execute(context) {
    return context.invoke!("tree", ["-fi", "--noreport", "."], { replaceEnv: true, env: {} });
  } });
  try {
    const result = await shell.exec("call-tree | cat; listing=$(tree -i --noreport); printf '%s\\n' \"$listing\" > /listing; cat /listing");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, ".\n./a.txt\n.\na.txt\n");
    assert.equal((await shell.exec("pwd; printf '%s\\n' \"$KEPT\"")).stdout, "/data\nparent\n");
  } finally { await shell.dispose(); }
});
