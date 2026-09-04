import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createCommandArguments, FsError, type CommandContext, type FileSystem, type InvocationCleanup } from "../../../src/contracts/index.js";
import { shellValueBytes, shellValueFromBytes, type ShellValue } from "../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMemoryFileSystem as canonicalMemoryFileSystem } from "../../../../safe-fs/src/fs/memory/index.js";
import { withFileSystemQuota } from "poe-code/safe-fs";
import { Shell } from "../../../src/shell/shell.js";
import { createTruncateCommand, truncateCommands } from "../../../src/commands/truncate/index.js";
import { run, withoutBlockMetadata, wrapped } from "./helpers.js";

const usage = "\nTry 'truncate --help' for more information.\n";

async function invoke(values: readonly ShellValue[], fs: FileSystem = createMemoryFileSystem(), overrides: Partial<CommandContext> = {}) {
  const argumentsOwned = createCommandArguments(values);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createTruncateCommand().execute({
    command: "truncate", args: argumentsOwned.args, argumentValues: argumentsOwned,
    cwd: "/", env: { LC_ALL: "C" }, fs, signal: new AbortController().signal,
    stdin: (async function* () { yield await Promise.reject(new Error("unexpected stdin read")); })(),
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    ...overrides,
  });
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

test("review: no-create suppresses ENOENT for the empty filename", async () => {
  assert.deepEqual(await invoke(["-cs0", ""]), { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
});

test("review: help retains the pinned GNU C bytes without native prerequisites", async () => {
  const result = await invoke(["--help"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr.length, 0);
  assert.equal(result.stdout.length, 1400);
  assert.equal(createHash("sha256").update(result.stdout).digest("hex"), "8f8d422ebb95f2a1265c14a568fba0f055d634911b481fb62d23c9607dc6d2ab");
});

test("review: version remains an explicit truthful identity exception", async () => {
  assert.deepEqual(await invoke(["--version"]), {
    exitCode: 0,
    stdout: Buffer.from("truncate (safe-bash; GNU coreutils 9.7 semantics)\n"),
    stderr: Buffer.alloc(0),
  });
});

for (const value of ["é", "😀", shellValueFromBytes(Uint8Array.of(255)), shellValueFromBytes(Uint8Array.of(128))]) {
  const bytes = shellValueBytes(value);
  test(`review: invalid short option reports its first byte ${Buffer.from(bytes).toString("hex")}`, async () => {
    const argument = shellValueFromBytes(Buffer.concat([Buffer.from("-"), bytes]));
    const actual = await invoke([argument]);
    assert.equal(actual.exitCode, 1);
    assert.deepEqual(actual.stderr, Buffer.concat([Buffer.from("truncate: invalid option -- '"), bytes.subarray(0, 1), Buffer.from(`'${usage}`)]));
  });
}

for (const prefix of ["--", "--size=", "-s", "-s < "]) {
  test(`review: raw argument bytes survive ${JSON.stringify(prefix)} diagnostics`, async () => {
    const argument = shellValueFromBytes(Buffer.concat([Buffer.from(prefix), Buffer.from([255])]));
    const actual = await invoke([argument, "absent"]);
    assert.equal(actual.exitCode, 1);
    const expected = prefix === "--"
      ? Buffer.concat([Buffer.from("truncate: unrecognized option '--"), Buffer.from([255]), Buffer.from(`'${usage}`)])
      : Buffer.from("truncate: Invalid number: '\\377'\n");
    assert.deepEqual(actual.stderr, expected);
  });
}

test("review: raw filename cannot alias a valid replacement-character filename", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/�", Uint8Array.of(1, 2, 3));
  const result = await invoke(["-s0", shellValueFromBytes(Uint8Array.of(255))], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr.toString(), /Operation not supported/);
  assert.deepEqual(await fs.readFile("/�"), Uint8Array.of(1, 2, 3));
});

test("review: raw reference cannot alias a valid replacement-character filename", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/�", Uint8Array.of(1, 2, 3));
  const result = await invoke(["-r", shellValueFromBytes(Uint8Array.of(255)), "target"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr.toString(), /Operation not supported/);
  await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
});

test("review: actual Shell preserves raw diagnostic bytes", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(truncateCommands());
  try {
    const result = await shell.exec("truncate -s $'\\377'");
    assert.equal(result.exitCode, 1);
    assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from("truncate: Invalid number: '\\377'\n"));
  } finally { await shell.dispose(); }
});

test("review: cancelled capability admission cannot start file creation", async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController(), reason = new Error("cancel admission");
  let writes = 0;
  const host = wrapped(fs, {
    async capabilitiesFor() { controller.abort(reason); return fs.capabilities; },
    async writeFile() { writes++; },
  });
  await assert.rejects(invoke(["-s0", "new"], host, { signal: controller.signal }), error => error === reason);
  assert.equal(writes, 0);
});

test("review: creation abort prevents a second stat and retains completed bytes", async () => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController(), reason = new Error("created then cancelled");
  let stats = 0;
  const host = wrapped(fs, {
    async stat(path, options) { stats++; return fs.stat(path, options); },
    async writeFile(path, bytes, options) { await fs.writeFile(path, bytes, options); controller.abort(reason); },
  });
  await assert.rejects(invoke(["-s2", "new", "later"], host, { signal: controller.signal }), error => error === reason);
  assert.equal(stats, 1);
  assert.equal((await fs.stat("/new")).size, 0);
  await assert.rejects(fs.stat("/later"), { code: "ENOENT" });
});

test("review: Shell cancellation waits for cooperative truncate cleanup", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1, 2));
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  let cleaned = false, observed = false;
  const host = wrapped(fs, { async truncate(_path, _length, options) {
    enter();
    await new Promise<void>(resolve => options!.signal!.addEventListener("abort", () => { observed = true; resolve(); }, { once: true }));
    await released;
    cleaned = true;
    options!.signal!.throwIfAborted();
  } });
  const shell = new Shell({ fs: host }).use(truncateCommands());
  const controller = new AbortController();
  let settled = false;
  const pending = shell.exec("truncate -s0 file", { signal: controller.signal }).finally(() => { settled = true; });
  const checked = pending.then(() => {}, () => {});
  try {
    await entered;
    controller.abort(new Error("stop truncate"));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(observed, true);
    assert.equal(settled, false);
    release();
    await checked;
    assert.equal(cleaned, true);
    assert.deepEqual(await fs.readFile("/file"), Uint8Array.of(1, 2));
  } finally { release(); await checked; await shell.dispose(); }
});

test("review: many finite operands allow timer cancellation", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1));
  const controller = new AbortController(), reason = new Error("stop operand loop");
  let writes = 0;
  const host = wrapped(fs, { async truncate() { writes++; } });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(invoke(["-s0", ...Array<string>(4096).fill("file")], host, { signal: controller.signal }), error => error === reason);
    assert.ok(writes < 4096);
  } finally { clearTimeout(timer); }
});

for (const errorCode of ["ENOSPC", "EFBIG"] as const) {
  test(`review: ${errorCode} capacity refusal preserves bytes and continues`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", Uint8Array.of(255, 0, 128));
    await fs.writeFile("/later", Uint8Array.of(1, 2));
    const sizes: number[] = [];
    const host = wrapped(fs, { async truncate(path, length, options) {
      sizes.push(length!);
      if (path === "/file") throw new FsError(errorCode);
      await fs.truncate!(path, length, options);
    } });
    const result = await invoke(["-s4", "file", "later"], host);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(sizes, [4, 4]);
    assert.deepEqual(await fs.readFile("/file"), Uint8Array.of(255, 0, 128));
    assert.deepEqual(await fs.readFile("/later"), Uint8Array.of(1, 2, 0, 0));
  });
}

test("review: quota refuses expansion before the eager memory allocation", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/file", Uint8Array.of(255, 0, 128));
  const fs = withFileSystemQuota(memory, { maxBytes: 8 });
  const result = await invoke(["-s9", "file"], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr.toString(), /Filesystem quota exceeded/);
  assert.deepEqual(await memory.readFile("/file"), Uint8Array.of(255, 0, 128));
});

test("review: huge exact size is delegated only to a refusing mock, never allocated", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1));
  let requested = 0;
  const host = wrapped(fs, { async truncate(_path, length) { requested = length!; throw new FsError("EFBIG"); } });
  assert.equal((await invoke(["-s9007199254740991", "file"], host)).exitCode, 1);
  assert.equal(requested, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(await fs.readFile("/file"), Uint8Array.of(1));
});

test("review: canonical memory block size and explicit fallback fixtures remain distinct", async () => {
  const fs = canonicalMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1));
  assert.equal((await fs.stat("/file")).ioBlockSize, 65536);
  let requested = 0;
  const host = wrapped(fs, { async truncate(_path, length) { requested = length!; } });
  const result = await run(["-os2", "file"], host, { ioBlockSize() { assert.fail("canonical metadata must win"); } });
  assert.equal(result.exitCode, 0);
  assert.equal(requested, 131072);
  const fallback = await run(["-os2", "file"], withoutBlockMetadata(host), { ioBlockSize: () => 512 });
  assert.equal(fallback.exitCode, 0);
  assert.equal(requested, 1024);
});

test("review: cleanup closes admission before the first provider call", async () => {
  const fs = createMemoryFileSystem();
  let calls = 0;
  const host = wrapped(fs, { async stat() { calls++; throw new FsError("ENOENT"); } });
  const parent = new AbortController();
  await assert.rejects(invoke(["-s0", "new"], host, { signal: parent.signal, registerCleanup(close) { void close(); } }), /invocation is closed/);
  assert.equal(calls, 0);
  assert.equal(parent.signal.aborted, false);
});

test("review: overlapping cleanup waits for admitted stat and blocks late creation", async () => {
  const fs = createMemoryFileSystem();
  const parent = new AbortController();
  let enter!: () => void, release!: () => void, close: InvocationCleanup | undefined;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  const host = wrapped(fs, {
    async stat() { assert.ok(close); enter(); await released; throw new FsError("ENOENT"); },
    async writeFile() { writes++; },
  });
  const running = assert.rejects(invoke(["-s0", "new"], host, { signal: parent.signal, registerCleanup(callback) { close = callback; } }), /invocation is closed/);
  await entered;
  const first = close!();
  assert.equal(close!(), first);
  let closed = false;
  const closing = Promise.resolve(first).then(() => { closed = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, false);
  } finally { release(); await closing; await running; }
  assert.equal(writes, 0);
  assert.equal(parent.signal.aborted, false);
});

for (const reason of [false, null]) {
  test(`review: falsey cancellation reason stays unchanged: ${reason}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", Uint8Array.of(1));
    const controller = new AbortController();
    const host = wrapped(fs, { async truncate() { controller.abort(reason); throw reason; } });
    await assert.rejects(invoke(["-s0", "file"], host, { signal: controller.signal, registerCleanup() {} }), error => error === reason);
  });
}

test("review: file appearing during creation admission keeps its prefix", async () => {
  const fs = createMemoryFileSystem();
  const host = wrapped(fs, { async capabilitiesFor() {
    await fs.writeFile("/race", Uint8Array.of(255, 0, 128));
    return fs.capabilities;
  } });
  const result = await invoke(["-s+1", "race"], host);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(await fs.readFile("/race"), Uint8Array.of(255, 0, 128, 0));
});

test("review: no-create does not recreate a target removed after stat", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", Uint8Array.of(1));
  const host = wrapped(fs, { async truncate(path, length, options) {
    await fs.rm(path);
    await fs.truncate!(path, length, options);
  } });
  assert.equal((await invoke(["-cs0", "file"], host)).exitCode, 1);
  await assert.rejects(fs.stat("/file"), { code: "ENOENT" });
});

for (const name of ["é", "😀", "�", "\ufefffile"]) {
  test(`review: valid UTF-8 path retains exact identity: ${JSON.stringify(name)}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile(`/${name}`, Uint8Array.of(255, 128));
    const result = await invoke(["-s1", shellValueFromBytes(new TextEncoder().encode(name))], fs);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(await fs.readFile(`/${name}`), Uint8Array.of(255));
  });
}

test("review: symlink-parent traversal is not lexically normalized", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/a");
  await fs.mkdir("/b/child", { recursive: true });
  await fs.symlink("/b/child", "/a/link");
  await fs.writeFile("/a/file", Uint8Array.of(1, 2));
  await fs.writeFile("/b/file", Uint8Array.of(3, 4));
  assert.equal((await invoke(["-s1", "link/../file"], fs, { cwd: "/a" })).exitCode, 0);
  assert.deepEqual(await fs.readFile("/a/file"), Uint8Array.of(1, 2));
  assert.deepEqual(await fs.readFile("/b/file"), Uint8Array.of(3));
});

const nativeCases: readonly (readonly ShellValue[])[] = [
  [], ["-s"], ["--siz"], ["--=1"], ["--no=1"], ["-s0", ""], ["-s0", "absent/"],
  ["-é"], ["-😀"], ["--é"], ["-s", shellValueFromBytes(Uint8Array.of(255))],
  [shellValueFromBytes(Uint8Array.of(45, 255))],
  ...["0", "1", "K", "0Q", "1Q", "999999999999999999999999x", "-9223372036854775808", "+9223372036854775807", "<+2", "/0", "%0", "> 2", "1 ", "0x10", "  +1"].map(size => ["-s", size, "absent"]),
  ...["+1", "-1", "<1", ">1", "/1", "%1"].flatMap(first => ["2", "+2", "<2", "/0"].map(last => ["-s", first, "-s", last, "absent"])),
  ...["size", "reference"].flatMap(name => Array.from({ length: name.length }, (_, index) => [`--${name.slice(0, index + 1)}`])),
  ...["no-create", "io-blocks", "help", "version"].flatMap(name => Array.from({ length: name.length }, (_, index) => [`--${name.slice(0, index + 1)}=unexpected`])),
  ["absent", "-s0"], ["-s0", "absent", "--unknown"], ["-s0", "--", "-"],
  ["-s0", "--reference=absent", "absent"], ["-s+0", "--reference=absent", "absent"],
  ["-s0", "--reference=", "absent"], ["-s+0", "--reference=", "absent"],
  ["-oc", "--siz=0", "absent"], ["--io", "absent"], ["-s2", "-s0", "absent"],
];

test("review: independent GNU 9.7 grammar and raw-byte diagnostics", { skip: process.env.SAFE_BASH_TEST_TRUNCATE === undefined ? "Requires reviewed SAFE_BASH_TEST_TRUNCATE and SAFE_BASH_TEST_TRUNCATE_SHA256" : false }, async context => {
  const binary = process.env.SAFE_BASH_TEST_TRUNCATE;
  assert.ok(binary);
  assert.equal(process.env.SAFE_BASH_TEST_TRUNCATE_SHA256, "e72b70379db18bf088208ebf5db983b6c555684218a0ed4d6e5a26c42fb058f7");
  const metadata = lstatSync(binary);
  assert.ok(metadata.isFile() && metadata.size <= 16 * 1024 * 1024);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(binary)) {
    bytes += chunk.length;
    assert.ok(bytes <= 16 * 1024 * 1024);
    hash.update(chunk);
  }
  assert.equal(hash.digest("hex"), process.env.SAFE_BASH_TEST_TRUNCATE_SHA256);
  for (const args of [["--help"], ["--h"], ["--he"], ["--hel"], ["--help", "--unknown"], ["-s0", "--help"], ["-sbad", "--help"], ["--help=1"]]) {
    await context.test(`GNU C help ${JSON.stringify(args)}`, async () => {
      const expected = spawnSync(binary, args, { argv0: "truncate", cwd: "/", env: { LC_ALL: "C" }, timeout: 2000, maxBuffer: 64 * 1024 });
      assert.ifError(expected.error);
      assert.equal(expected.signal, null);
      assert.deepEqual(await invoke(args), { exitCode: expected.status, stdout: expected.stdout, stderr: expected.stderr });
    });
  }
  assert.throws(() => lstatSync("/absent"), { code: "ENOENT" });
  assert.throws(() => lstatSync("/-"), { code: "ENOENT" });
  for (const values of nativeCases) {
    const args = ["-c", ...values];
    const literal = args.map(value => `$'${Array.from(shellValueBytes(value), byte => `\\${byte.toString(8).padStart(3, "0")}`).join("")}'`).join(" ");
    await context.test(literal, async () => {
      const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", `exec -a truncate "$1" ${literal}`, "review", binary], {
        cwd: "/", env: { LC_ALL: "C" }, timeout: 2000, maxBuffer: 64 * 1024,
      });
      assert.ifError(expected.error);
      assert.equal(expected.signal, null);
      const actual = await invoke(args);
      assert.deepEqual(actual, { exitCode: expected.status, stdout: expected.stdout, stderr: expected.stderr });
    });
  }
  for (const args of [["-cs0", "absent", "-s2"], ["-cs0", "absent", "--unknown"]]) {
    for (const name of args.slice(1)) assert.throws(() => lstatSync(`/${name}`), { code: "ENOENT" });
    await context.test(`POSIXLY_CORRECT ${JSON.stringify(args)}`, async () => {
      const expected = spawnSync(binary, args, { argv0: "truncate", cwd: "/", env: { LC_ALL: "C", POSIXLY_CORRECT: "" }, timeout: 2000, maxBuffer: 64 * 1024 });
      assert.ifError(expected.error);
      assert.equal(expected.signal, null);
      assert.deepEqual(await invoke(args, undefined, { env: { LC_ALL: "C", POSIXLY_CORRECT: "" } }), { exitCode: expected.status, stdout: expected.stdout, stderr: expected.stderr });
    });
  }
});
