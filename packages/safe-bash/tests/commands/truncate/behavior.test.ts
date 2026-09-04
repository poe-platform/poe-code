import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, FsError } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { createTruncateCommand, createTruncateCommands, truncateCommands } from "../../../src/commands/truncate/index.js";
import { run, withoutBlockMetadata, wrapped } from "./helpers.js";

test("explicit command factories and collision policy", () => {
  assert.equal(createTruncateCommand().name, "truncate");
  assert.deepEqual(createTruncateCommands().map(command => command.name), ["truncate"]);
  const commands = new CommandRegistry([{ name: "truncate", execute: () => ({ exitCode: 42 }) }]);
  const original = commands.get("truncate");
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => truncateCommands().setup(host), /already registered/u);
  assert.equal(commands.get("truncate"), original);
  truncateCommands({ replace: true }).setup(host);
  assert.notEqual(commands.get("truncate"), original);
});

for (const [size, expected] of [["3", 3], ["+3", 8], ["-3", 2], ["-9", 0], ["<3", 3], ["<9", 5], [">3", 5], [">9", 9], ["/3", 3], ["%3", 6], ["/5", 5], ["%5", 5], ["  < \t3", 3], ["0003", 3]] as const) {
  test(`size ${JSON.stringify(size)} preserves prefix and zero-fills`, async () => {
    const fs = createMemoryFileSystem();
    const original = Uint8Array.of(255, 0, 128, 65, 10);
    await fs.writeFile("/file", original);
    assert.deepEqual(await run(["-s", size, "file"], fs), { exitCode: 0, stdout: "", stderr: "" });
    const bytes = new Uint8Array(expected);
    bytes.set(original.subarray(0, expected));
    assert.deepEqual(await fs.readFile("/file"), bytes);
  });
}

for (const [size, expected] of [["K", 1024], ["kB", 1000], ["KiB", 1024], ["2kD", 2000], ["m", 1048576], ["0Q", 0], ["0RiB", 0], ["0YB", 0], ["0Z", 0], ["0EB", 0], ["0t", 0], ["0g", 0]] as const) {
  test(`GNU suffix ${size}`, async () => {
    const fs = createMemoryFileSystem();
    assert.equal((await run(["-s", size, "file"], fs)).exitCode, 0);
    assert.equal((await fs.stat("/file")).size, expected);
  });
}

for (const [args, message] of [
  [[], "you must specify either '--size' or '--reference'"],
  [["-s1"], "missing file operand"],
  [["-s"], "option requires an argument -- 's'"],
  [["--size"], "option '--size' requires an argument"],
  [["--no-create=1"], "option '--no-create' doesn't allow an argument"],
  [["-x"], "invalid option -- 'x'"],
  [["--unknown"], "unrecognized option '--unknown'"],
  [["-rref", "-s1", "file"], "you must specify a relative '--size' with '--reference'"],
  [["-rref", "-o", "file"], "'--io-blocks' was specified but '--size' was not"],
  [["-s/0", "file"], "division by zero"],
  [["-s%0", "file"], "division by zero"],
  [["-s<+2", "file"], "multiple relative modifiers specified"],
  [["-s+2", "-s+3", "file"], "multiple relative modifiers specified"],
] as const) {
  test(`GNU usage error ${args.join(" ")}`, async () => {
    const result = await run(args);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(`truncate: ${message}\n`), result.stderr);
  });
}

for (const size of ["", "1 ", "1.5", "1B", "b", "1c", "1w", "0x10", "2x3", "+K", "-K", "1kiBz", "1e", "9223372036854775808", "1Q", "-9223372036854775809"]) {
  test(`reject invalid size ${JSON.stringify(size)} before mutations`, async () => {
    const fs = createMemoryFileSystem();
    const result = await run(["-s", size, "file"], fs);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("Invalid number"), result.stderr);
    await assert.rejects(fs.stat("/file"), { code: "ENOENT" });
  });
}

test("option permutation, abbreviations, clusters, dash operand and retained relative mode", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array(5));
  assert.equal((await run(["file", "--siz=+2", "-s3"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/file")).size, 8);
  assert.equal((await run(["-cs2", "file"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/file")).size, 2);
  assert.equal((await run(["--s=1", "--", "-", "-s8"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/-")).size, 1);
  assert.equal((await fs.stat("/-s8")).size, 1);
});

test("POSIXLY_CORRECT stops options at first operand", async () => {
  const fs = createMemoryFileSystem();
  assert.equal((await run(["-s1", "file", "-s2"], fs, {}, { env: { POSIXLY_CORRECT: "" } })).exitCode, 0);
  assert.equal((await fs.stat("/file")).size, 1);
  assert.equal((await fs.stat("/-s2")).size, 1);
});

test("help/version exit immediately, but earlier parse failures win", async () => {
  assert.match((await run(["--he", "-x"])).stdout, /--io-blocks/u);
  assert.match((await run(["--ver"])).stdout, /truncate.*9\.7/u);
  assert.equal((await run(["-sbad", "--help"])).exitCode, 1);
  assert.equal((await run(["--help=oops"])).exitCode, 1);
});

test("reference sampled once, follows symlink, applies relative size to every operand", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/ref", new Uint8Array(5));
  await fs.symlink!("ref", "/link");
  assert.equal((await run(["-rlink", "-s+2", "ref", "other"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/ref")).size, 7);
  assert.equal((await fs.stat("/other")).size, 7);
  assert.equal((await run(["--ref=link", "third"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/third")).size, 7);
});

test("missing reference fails before target creation; no-create ignores only ENOENT", async () => {
  const fs = createMemoryFileSystem();
  assert.equal((await run(["-rmissing", "file"], fs)).exitCode, 1);
  await assert.rejects(fs.stat("/file"), { code: "ENOENT" });
  assert.deepEqual(await run(["-cs1", "missing/child", "file"], fs), { exitCode: 0, stdout: "", stderr: "" });
  await fs.writeFile("/file", Uint8Array.of(1));
  assert.equal((await run(["-cs0", "file/child"], fs)).exitCode, 1);
});

test("symlinks, dangling symlinks, hardlinks, metadata and multi-file errors", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1, 2, 3), { mode: 0o640 });
  await fs.utimes!("/file", 1000, 2000);
  await fs.link!("/file", "/hard");
  await fs.symlink!("file", "/link");
  await fs.symlink!("new", "/dangling");
  await fs.mkdir("/dir");
  const before = await fs.stat("/file");
  const result = await run(["-s2", "dir", "link", "dangling", "absent/child", "other"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /cannot open 'dir' for writing: Is a directory/u);
  assert.equal((await fs.stat("/hard")).size, 2);
  assert.equal((await fs.lstat("/link")).type, "symlink");
  assert.equal((await fs.stat("/new")).size, 2);
  assert.equal((await fs.stat("/other")).size, 2);
  const after = await fs.stat("/file");
  for (const field of ["ino", "mode", "uid", "gid", "nlink", "atimeMs"] as const) assert.equal(after[field], before[field]);
  assert.ok(after.mtimeMs > 2000);
  assert.ok(after.ctimeMs >= before.ctimeMs);
});

test("missing truncate capability must not fall back to whole-file read/write", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1, 2, 3));
  const unavailable = wrapped(fs, { truncate: undefined, capabilities: { ...fs.capabilities, truncate: false } });
  const result = await run(["-s1", "file", "new"], unavailable);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Operation not supported/u);
  assert.equal((await fs.stat("/file")).size, 3);
  await assert.rejects(fs.stat("/new"), { code: "ENOENT" });
});

test("io-blocks uses truthful per-target host block sizes, not reference blocks", async () => {
  const fs = withoutBlockMetadata(createMemoryFileSystem());
  await fs.writeFile("/ref", new Uint8Array(3));
  const seen: string[] = [];
  const result = await run(["-orref", "-s+2", "first", "second"], fs, { ioBlockSize(path, _stat, context) {
    assert.equal(context.fs, fs);
    seen.push(path);
    return path === "/first" ? 512 : 4096;
  } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(seen, ["/first", "/second"]);
  assert.equal((await fs.stat("/first")).size, 1027);
  assert.equal((await fs.stat("/second")).size, 8195);
});

test("missing block-size contract is unsupported, never a guessed success", async () => {
  const fs = withoutBlockMetadata(createMemoryFileSystem());
  await fs.writeFile("/file", Uint8Array.of(1, 2, 3));
  assert.match((await run(["-os1", "file"], fs)).stderr, /Operation not supported.*I\/O block size/u);
  assert.equal((await fs.stat("/file")).size, 3);
});

test("provider errors and aborts preserve meaning; operations receive signal", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1));
  const controller = new AbortController();
  const failing = wrapped(fs, { async truncate(_path, _length, options) {
    assert.equal(options?.signal, controller.signal);
    throw new FsError("ENOSPC");
  } });
  assert.match((await run(["-s2", "file"], failing, {}, { signal: controller.signal })).stderr, /No space left on device/u);
  controller.abort(new Error("cancelled"));
  await assert.rejects(run(["--help"], fs, {}, { signal: controller.signal }), /cancelled/u);
});

test("actual shell opt-in, quoted modifier and binary file", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(255, 128, 0));
  const shell = new Shell({ fs }).use(truncateCommands());
  try {
    assert.equal((await shell.exec("truncate -s '%4' file")).exitCode, 0);
    assert.deepEqual(await fs.readFile("/file"), Uint8Array.of(255, 128, 0, 0));
  } finally { await shell.dispose(); }
});
