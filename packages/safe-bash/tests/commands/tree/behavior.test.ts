import assert from "node:assert/strict";
import test from "node:test";
import { createTreeCommand, createTreeCommands, treeCommands } from "../../../src/commands/tree/index.js";
import { CommandRegistry, FsError, type PluginHost } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { run, seed, shellRun, wrapped } from "./helpers.js";
import { compareVersions } from "../../../src/commands/tree/sort.js";

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
  for (const value of [0, -1, NaN, 1.5]) assert.throws(() => createTreeCommand({ limits: { maxDepth: value } }), RangeError);
});

test("unsupported/invalid options preflight before any VFS or stdin access", async () => {
  const fs = wrapped(createMemoryFileSystem(), { async lstat() { throw new Error("unexpected lstat"); } });
  for (const args of [["--du"], ["-s"], ["--prune"], ["-C"], ["--filelimit=-1"], ["--filelimit=wat"], ["--filelimit"], ["-L0"], ["-L"],
    ["--sort=size"], ["--charset=ANSI"], ["-P", "**"], ["-P", "dir/*"], ["-I", "[x"], ["-P", "[z-a]"],
    ["--help", "--du"], [""], ["\0"], ["\ud800"]]) {
    const result = await run(args, {}, { fs, stdin: (async function* () { throw new Error("unexpected stdin"); })() });
    assert.equal(result.exitCode, 2, args.join(" "));
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /unexpected/u);
  }
});

test("explicit name/version sorting, reverse and enumeration order", async () => {
  const backing = createMemoryFileSystem();
  await backing.mkdir("/dir");
  for (const name of ["v10", "v2", "v1"]) await backing.writeFile(`/dir/${name}`, new Uint8Array());
  const fs = wrapped(backing, { async readdir(path, options) {
    const entries = await backing.readdir(path, options);
    return path === "/dir" ? ["v10", "v2", "v1"].map(name => entries.find(entry => entry.name === name)!) : entries;
  } });
  for (const [options, names] of [
    [["--sort=name"], ["v1", "v10", "v2"]],
    [["--sort", "version"], ["v1", "v2", "v10"]],
    [["--sort=version", "-r"], ["v10", "v2", "v1"]],
    [["--sort=none"], ["v10", "v2", "v1"]],
  ] as const) {
    const result = await shellRun(fs, [...options, "--noreport", "dir"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `dir\n|-- ${names[0]}\n|-- ${names[1]}\n\`-- ${names[2]}\n`);
  }
});

test("filelimit skips oversized directories successfully and respects visible filters", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dir");
  for (const name of ["a", "b", ".hidden"]) await fs.writeFile(`/dir/${name}`, new Uint8Array());
  const limited = await shellRun(fs, ["--filelimit=1", "--noreport", "dir"]);
  assert.equal(limited.exitCode, 0, limited.stderr);
  assert.equal(limited.stderr, "");
  assert.equal(limited.stdout, "dir  [2 entries exceeds filelimit, not opening dir]\n");
  assert.equal((await shellRun(fs, ["--filelimit=1", "dir"])).stdout,
    "dir  [2 entries exceeds filelimit, not opening dir]\n\n1 directory, 0 files\n");
  assert.equal((await shellRun(fs, ["--filelimit", "1", "-I", "b", "--noreport", "dir"])).stdout, "dir\n`-- a\n");
  assert.equal((await shellRun(fs, ["--filelimit=0", "--noreport", "dir"])).stdout, "dir\n|-- a\n`-- b\n");
  await fs.mkdir("/outer");
  await fs.mkdir("/outer/nested");
  for (const name of ["a", "b"]) await fs.writeFile(`/outer/nested/${name}`, new Uint8Array());
  assert.equal((await shellRun(fs, ["--filelimit=1", "--noreport", "outer"])).stdout,
    "outer\n`-- nested  [2 entries exceeds filelimit, not opening dir]\n");
  const json = await shellRun(fs, ["-Ji", "--filelimit=1", "--noreport", "dir"]);
  assert.deepEqual(JSON.parse(json.stdout), [{ type: "directory", name: "dir", contents: [{ error: "2 entries exceeds filelimit, not opening dir" }] }]);
});

test("version sort preserves native leading-zero and long-number ordering", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dir");
  const names = ["v000", "v001", "v00", "v01", "v010", "v09", "v0", "v1", "v1.2", "v1.10", "v1a", "v2", "v9", "v10", "v99999999999999999999", "v100000000000000000000"];
  for (const name of [...names].reverse()) await fs.writeFile(`/dir/${name}`, new Uint8Array());
  const result = await shellRun(fs, ["-Jiv", "--noreport", "dir"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout)[0].contents.map((entry: { name: string }) => entry.name), names);
});

test("version comparison handles numeric suffixes after leading zeros", () => {
  const bytes = (name: string): Uint8Array => new TextEncoder().encode(name);
  assert.ok(compareVersions(bytes("v-0029."), bytes("v-00210")) < 0);
  assert.ok(compareVersions(bytes("v02143a"), bytes("v029.02")) > 0);
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
  assert.equal(text.stdout.split("\n").length, names.length + 5);
  assert.match(text.stdout, /\\033\[31m/u);
  assert.match(text.stdout, /symlink -> line\\nfeed/u);
  assert.doesNotMatch(text.stdout, /[\u001b\u0085\u202e\u2028]/u);
  const result = await shellRun(fs, ["-Ji", "--noreport"]);
  assert.doesNotMatch(result.stdout, /[\u001b\u0085\u202e\u2028]/u);
  assert.deepEqual(JSON.parse(result.stdout)[0].contents.map((entry: { name: string }) => entry.name).sort(), [...names, "symlink", "dev"].sort());
  assert.deepEqual(JSON.parse(result.stdout)[0].contents.find((entry: { name: string }) => entry.name === "dev"),
    { type: "directory", name: "dev", contents: [{ type: "character", name: "null" }] });
});

test("default nofollow includes operands; -l skips ancestors and later symlink aliases", async () => {
  const fs = createMemoryFileSystem();
  await seed(fs);
  assert.equal((await shellRun(fs, ["--noreport", "link"])).stdout, "link -> dir\n");
  const result = await shellRun(fs, ["-li", "--noreport"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.match(/c\.md\n/gu)?.length, 1);
  assert.equal(result.stdout.match(/recursive, not followed/gu)?.length, 2);
  assert.match(result.stdout, /link -> dir {2}\[recursive/u);
  const json = JSON.parse((await shellRun(fs, ["-Jli", "--noreport", "link"])).stdout);
  assert.equal(json[0].type, "link");
  assert.equal(json[0].contents[0].name, "sub");
});

test("followed aliases use visit order, including at the depth limit, in text and JSON", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/data/a", { recursive: true });
  await fs.writeFile("/data/a/x", new Uint8Array());
  await fs.symlink!("a", "/data/b");
  for (const args of [["-li"], ["-li", "-L1"]]) {
    const result = await shellRun(fs, [...args, "--noreport", "data"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `data\na\n${args.length === 1 ? "x\n" : ""}b -> a  [recursive, not followed]\n`);
  }
  const json = await shellRun(fs, ["-lJi", "--noreport", "data"]);
  assert.equal(json.exitCode, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), [{ type: "directory", name: "data", contents: [
    { type: "directory", name: "a", contents: [{ type: "file", name: "x" }] },
    { type: "link", name: "b", target: "a", contents: [{ error: "recursive, not followed" }] },
  ] }]);
  const reversed = await shellRun(fs, ["-lri", "--noreport", "data"]);
  assert.equal(reversed.stdout, "data\nb -> a\nx\na\nx\n");
  const unknown = wrapped(fs, {
    async lstat(path, options) {
      const stat = { ...await fs.lstat(path, options) };
      delete stat.identityScope;
      return stat;
    },
    async stat(path, options) {
      const stat = { ...await fs.stat(path, options) };
      delete stat.identityScope;
      return stat;
    },
    compareEntry: undefined,
  });
  assert.equal((await shellRun(unknown, ["-li", "--noreport", "data"])).stdout,
    "data\na\nx\nb -> a\nx\n");
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
