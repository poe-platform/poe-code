import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, FsError, type FsOptions } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { Shell } from "../../src/shell/index.js";
import { fixture, run } from "./helpers.js";

async function sortableFixture() {
  const fs = await fixture({ "a-new-small": "x", "b-old-large": "123456789", "c-old-large": "123456789" });
  await fs.utimes("/work/a-new-small", 300, 300);
  await fs.utimes("/work/b-old-large", 100, 100);
  await fs.utimes("/work/c-old-large", 100, 100);
  return fs;
}

for (const args of [["-lh"], ["-l", "--human-readable"]]) {
  for (const [size, expected] of [
    [0, "0"], [1, "1"], [1023, "1023"], [1024, "1.0K"], [1025, "1.1K"],
    [1536, "1.5K"], [10137, "9.9K"], [10138, "10K"], [10240, "10K"], [10241, "11K"],
    [1047552, "1023K"], [1047553, "1.0M"], [1048575, "1.0M"], [1048576, "1.0M"],
    [2 ** 30, "1.0G"], [2 ** 40, "1.0T"], [2 ** 50, "1.0P"], [Number.MAX_SAFE_INTEGER, "8.0P"],
  ] as const) test(`ls ${args.join(" ")} formats ${size} as ${expected}`, async context => {
    const fs = await fixture({ item: "" });
    await fs.utimes("/work/item", 0, 0);
    const lstat = fs.lstat.bind(fs);
    context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => ({ ...await lstat(path, options), size }));
    const result = await run("ls", [...args, "item"], { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `-rw-rw-rw- 1 0 0 ${expected} 1970-01-01 00:00 item\n`);
  });
}

for (const flag of ["-h", "--human-readable"]) test(`ls ${flag} alone retains names-only output`, async () => {
  const result = await run("ls", [flag], { fs: await sortableFixture() });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "a-new-small\nb-old-large\nc-old-large\n");
});

for (const size of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`ls -lh refuses unrepresentable human size ${String(size)}`, async context => {
    const fs = await fixture({ item: "" });
    const lstat = fs.lstat.bind(fs);
    context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => ({ ...await lstat(path, options), size }));
    const result = await run("ls", ["-lh", "item"], { fs });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /size/u);
  });
}

for (const flag of ["-t", "--sort=time", "-S", "--sort=size"]) {
  for (const reverse of [false, true]) test(`ls ${flag}${reverse ? " -r" : ""} orders metadata with deterministic ties`, async () => {
    const names = flag === "-t" || flag === "--sort=time" ? ["a-new-small", "b-old-large", "c-old-large"] : ["b-old-large", "c-old-large", "a-new-small"];
    if (reverse) names.reverse();
    const args = [flag, ...(reverse ? ["-r"] : [])];
    const result = await run("ls", args, { fs: await sortableFixture() });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, names.join("\n") + "\n");
  });
}

for (const [args, expected] of [
  [["-tS"], "b-old-large\nc-old-large\na-new-small\n"],
  [["-St"], "a-new-small\nb-old-large\nc-old-large\n"],
  [["-tSt"], "a-new-small\nb-old-large\nc-old-large\n"],
  [["-StS"], "b-old-large\nc-old-large\na-new-small\n"],
  [["--sort=time", "-S"], "b-old-large\nc-old-large\na-new-small\n"],
  [["-S", "--sort=time"], "a-new-small\nb-old-large\nc-old-large\n"],
  [["--sort", "size"], "b-old-large\nc-old-large\na-new-small\n"],
  [["--sort=size", "--sort=time", "--reverse"], "c-old-large\nb-old-large\na-new-small\n"],
  [["-tr"], "c-old-large\nb-old-large\na-new-small\n"],
  [["-Sr"], "a-new-small\nc-old-large\nb-old-large\n"],
] as const) test(`ls last sort selector wins: ${args.join(" ")}`, async () => {
  const result = await run("ls", args, { fs: await sortableFixture() });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, expected);
});

test("ls sorts file operands rather than preserving caller order", async () => {
  const result = await run("ls", ["-S", "c-old-large", "a-new-small", "b-old-large"], { fs: await sortableFixture() });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "b-old-large\nc-old-large\na-new-small\n");
});

test("ls option scanning stops at --, including sort-looking filenames", async () => {
  const fs = await fixture({ "-t": "1", "-S": "12345" });
  const result = await run("ls", ["--sort=size", "--", "-t", "-S"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "-S\n-t\n");
});

for (const args of [["--sort"], ["--sort="], ["--sort=name"], ["--sort=none"], ["--sort=time=bad"], ["--human-readable=1"], ["-s"]]) {
  test(`ls rejects unsupported option ${args.join(" ")} before filesystem access`, async context => {
    const fs = await fixture();
    context.mock.method(fs, "lstat", async () => assert.fail("unexpected metadata access"));
    context.mock.method(fs, "stat", async () => assert.fail("unexpected metadata access"));
    const result = await run("ls", args, { fs });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.notEqual(result.stderr, "");
  });
}

for (const flags of [["-t"], ["-tr"], ["-dt"]]) test(`ls groups operands and separates directory headers: ${flags.join(" ")}`, async () => {
  const fs = await fixture({ "a-dir/alpha": "", "b-dir/beta": "", "a-file": "", "b-file": "" });
  for (const [name, modified] of [["a-file", 100], ["b-file", 200], ["a-dir", 300], ["b-dir", 400]] as const) await fs.utimes(`/work/${name}`, modified, modified);
  const result = await run("ls", [...flags, "b-dir", "a-file", "a-dir", "b-file"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, flags[0] === "-dt" ? "b-dir\na-dir\nb-file\na-file\n" : flags[0] === "-tr"
    ? "a-file\nb-file\n\na-dir:\nalpha\n\nb-dir:\nbeta\n"
    : "b-file\na-file\n\nb-dir:\nbeta\n\na-dir:\nalpha\n");
});

test("ls preserves headers for multiple empty directories and suppresses them for one directory", async () => {
  const fs = await fixture();
  await fs.mkdir("/work/alpha");
  await fs.mkdir("/work/beta");
  for (const [args, expected] of [[["-S", "alpha"], ""], [["-S", "beta", "alpha"], "alpha:\n\nbeta:\n"]] as const) {
    const result = await run("ls", args, { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
  }
});

test("ls human formatting and metadata sorting compose without sorting rounded sizes", async () => {
  const fs = await fixture({ alpha: "x".repeat(1025), beta: "x".repeat(1026) });
  const result = await run("ls", ["-lhS"], { fs });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout.trimEnd().split("\n").map(line => [line.split(" ")[4], line.split(" ").at(-1)]), [["1.1K", "beta"], ["1.1K", "alpha"]]);
});

for (const follow of [false, true]) test(`ls sorts links using ${follow ? "target" : "link"} metadata`, async context => {
  let clock = 1000;
  context.mock.method(Date, "now", () => clock);
  const fs = await fixture({ target: "x".repeat(2048), other: "x".repeat(100) });
  await fs.utimes("/work/target", 100, 100);
  await fs.utimes("/work/other", 200, 200);
  clock = 300;
  await fs.symlink("target", "/work/link");
  const size = await run("ls", ["-dS", ...(follow ? ["-L"] : []), "link", "other"], { fs });
  assert.equal(size.exitCode, 0);
  assert.equal(size.stdout, follow ? "link\nother\n" : "other\nlink\n");
  const time = await run("ls", ["-dt", ...(follow ? ["-L"] : []), "link", "other"], { fs });
  assert.equal(time.exitCode, 0);
  assert.equal(time.stdout, follow ? "other\nlink\n" : "link\nother\n");
  const human = await run("ls", ["-lh", ...(follow ? ["-L"] : []), "link"], { fs });
  assert.equal(human.exitCode, 0);
  assert.equal(human.stdout.split(" ")[4], follow ? "2.0K" : "6");
  assert.equal(human.stdout.includes(" -> target"), !follow);
});

for (const flag of ["-S", "-SF", "-Sd", "-Sl", "-SlL"]) test(`ls command-line directory link policy: ${flag}`, async () => {
  const fs = await fixture({ "target/child": "" });
  await fs.symlink("target", "/work/link");
  const result = await run("ls", [flag, "link"], { fs });
  assert.equal(result.exitCode, 0);
  if (flag === "-S") assert.equal(result.stdout, "child\n");
  else if (flag === "-SF") assert.equal(result.stdout, "link@\n");
  else if (flag === "-Sd") assert.equal(result.stdout, "link\n");
  else assert.match(result.stdout, flag === "-Sl" ? /link -> target\n$/u : /child\n$/u);
});

test("ls recursive metadata order reuses one observation per entry", async context => {
  const fs = await fixture({ "root/child/leaf": "", "root/older": "" });
  await fs.utimes("/work/root/child", 200, 200);
  await fs.utimes("/work/root/older", 100, 100);
  const lstat = fs.lstat.bind(fs);
  const calls: string[] = [];
  context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => { calls.push(path); return lstat(path, options); });
  context.mock.method(fs, "stat", async () => assert.fail("unexpected dereference"));
  const result = await run("ls", ["-tR", "root"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "root:\nchild\nolder\n\nroot/child:\nleaf\n");
  assert.deepEqual(calls.sort(), ["/work/root", "/work/root/child", "/work/root/child/leaf", "/work/root/older"]);
});

test("ls ignores hidden entries before collecting sort metadata", async context => {
  const fs = await sortableFixture();
  await fs.writeFile("/work/.hidden", new Uint8Array());
  const lstat = fs.lstat.bind(fs);
  context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => {
    assert.notEqual(path, "/work/.hidden");
    return lstat(path, options);
  });
  assert.equal((await run("ls", ["-S"], { fs })).exitCode, 0);
});

for (const reason of [false, 0, "", null]) test(`ls preserves falsey cancellation after metadata: ${JSON.stringify(reason)}`, async context => {
  const fs = await sortableFixture();
  const controller = new AbortController();
  const lstat = fs.lstat.bind(fs);
  const calls: string[] = [];
  context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => {
    calls.push(path);
    const result = await lstat(path, options);
    if (path === "/work/a-new-small") controller.abort(reason);
    return result;
  });
  let rejected = false;
  try { await run("ls", ["-S"], { fs, signal: controller.signal }); }
  catch (error) { rejected = true; assert.equal(error, reason); }
  assert.equal(rejected, true);
  assert.equal(calls.includes("/work/b-old-large"), false);
});

test("ls sorting yields to scheduled cancellation before rendering", async context => {
  const fs = await sortableFixture();
  const controller = new AbortController();
  const lstat = fs.lstat.bind(fs);
  context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => {
    if (path === "/work/a-new-small") setImmediate(() => controller.abort(false));
    return lstat(path, options);
  });
  let rejected = false;
  try { await run("ls", ["-S"], { fs, signal: controller.signal }); }
  catch (error) { rejected = true; assert.equal(error, false); }
  assert.equal(rejected, true);
});

test("ls preserves the directory-entry cap before collecting child metadata", async context => {
  const fs = await sortableFixture();
  const lstat = fs.lstat.bind(fs);
  let reads = 0;
  context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => { reads++; return lstat(path, options); });
  const shell = new Shell({ fs, cwd: "/work", commands: new CommandRegistry(createStandardCommands({ maxDirectoryEntries: 1 })) });
  context.after(() => shell.dispose());
  const result = await shell.exec("ls -S");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /directory entry limit/u);
  assert.equal(result.stdout, "");
  assert.equal(reads, 1);
});

test("ls human sorting preserves shell output and invocation budgets", async context => {
  const fs = await sortableFixture();
  const shell = new Shell({ fs, cwd: "/work", commands: new CommandRegistry(createStandardCommands()) });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("ls -lhS", { limits: { maxOutputBytes: 3 } }), { limit: "maxOutputBytes" });
  await assert.rejects(shell.exec("ls -S; ls -t", { limits: { maxCommands: 1 } }), { limit: "maxCommands" });
});

test("ls preserves root operand errors while rendering valid operands", async () => {
  const fs = await sortableFixture();
  const result = await run("ls", ["-S", "missing", "a-new-small"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOENT.*missing/u);
  assert.equal(result.stdout, "a-new-small\n");
});

test("ls retains errors from required child metadata and explicit dereferencing", async context => {
  const fs = await sortableFixture();
  const lstat = fs.lstat.bind(fs);
  context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => {
    if (path === "/work/b-old-large") throw new FsError("EACCES", { path });
    return lstat(path, options);
  });
  const result = await run("ls", ["-t"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EACCES/u);
  assert.equal(result.stdout, "");
  await fs.symlink("missing", "/work/dangling");
  const dangling = await run("ls", ["-SL", "dangling"], { fs });
  assert.equal(dangling.exitCode, 1);
  assert.match(dangling.stderr, /ENOENT/u);
});

test("ls includes synthetic dot entries in metadata sorting without changing -A semantics", async context => {
  const fs = await fixture({ file: "x", ".hidden": "x" });
  const lstat = fs.lstat.bind(fs);
  const sizes: Record<string, number> = { "/work": 10, "/": 20, "/work/.hidden": 30 };
  context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => {
    const stat = await lstat(path, options);
    return { ...stat, size: sizes[path] ?? stat.size };
  });
  const all = await run("ls", ["-aS"], { fs });
  assert.equal(all.exitCode, 0);
  assert.equal(all.stdout, ".hidden\n..\n.\nfile\n");
  const almost = await run("ls", ["-ASr"], { fs });
  assert.equal(almost.exitCode, 0);
  assert.equal(almost.stdout, "file\n.hidden\n");
});

test("ls recursive sorting retains ancestor-cycle rejection", async () => {
  const fs = await fixture();
  await fs.mkdir("/work/root");
  await fs.symlink(".", "/work/root/loop");
  const result = await run("ls", ["-SLR", "root"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ELOOP/u);
  assert.equal(result.stdout, "root:\nloop\n");
});

test("ls human file operands reuse their single metadata observation", async context => {
  const fs = await fixture({ item: "x" });
  const lstat = fs.lstat.bind(fs);
  let reads = 0;
  context.mock.method(fs, "lstat", async (path: string, options?: FsOptions) => { reads++; return lstat(path, options); });
  const result = await run("ls", ["-lhS", "item"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(reads, 1);
});

test("ls sorted rendering awaits sink backpressure before writing the next record", async context => {
  const fs = await sortableFixture();
  const shell = new Shell({ fs, cwd: "/work", commands: new CommandRegistry(createStandardCommands()) });
  context.after(() => shell.dispose());
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const firstWrite = new Promise<void>(resolve => { entered = resolve; });
  const writes: string[] = [];
  const execution = shell.exec("ls -S", { stdout: { async write(chunk) {
    writes.push(new TextDecoder().decode(chunk));
    if (writes.length === 1) { entered(); await blocked; }
  } } });
  try {
    await Promise.race([firstWrite, execution.then(() => assert.fail("execution settled without a blocked record"))]);
    assert.deepEqual(writes, ["b-old-large\n"]);
  } finally { release(); }
  assert.equal((await execution).exitCode, 0);
  assert.deepEqual(writes, ["b-old-large\n", "c-old-large\n", "a-new-small\n"]);
});
