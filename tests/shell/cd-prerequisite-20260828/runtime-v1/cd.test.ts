import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Shell, MemoryFileSystem, RealFileSystem, ReadOnlyFileSystem, S3FileSystem, MockS3Client,
  WebDavFileSystem, FsError, CommandRegistry, writeText, ShellLimitError, standardCommands,
} from "../../../../src/index.js";
import type { FileSystem, ShellOptions, ShellExecOptions } from "../../../../src/index.js";

async function fixture() {
  const fs = new MemoryFileSystem();
  for (const directory of ["/work/target", "/one/target", "/two/target", "/work/rel/target"]) await fs.mkdir(directory, { recursive: true });
  const calls: string[] = [];
  const stat = fs.stat.bind(fs);
  const access = fs.access.bind(fs);
  fs.stat = async (path, options) => { calls.push(`stat:${path}`); return stat(path, options); };
  fs.access = async (path, mode, options) => { calls.push(`access:${mode}:${path}`); return access(path, mode, options); };
  return { fs, calls };
}

async function execute(fs: FileSystem, script: string, options: Partial<ShellOptions> = {}, exec: ShellExecOptions = {}) {
  const shell = new Shell({ fs, cwd: "/work", env: { HOME: "/", PATH: "", OLDPWD: "/" }, ...options }).use(standardCommands());
  try { return await shell.exec(script, exec); } finally { await shell.dispose(); }
}

for (const [cdpath, expected, printed] of [
  ["/one:/two", "/one/target", true], ["/two:/one", "/two/target", true],
  [":/one", "/work/target", false], ["/absent::/one", "/work/target", false],
  ["/absent:", "/work/target", false], ["", "/work/target", false],
  ["/absent", "/work/target", false], ["rel", "/work/rel/target", true],
] as const) test(`ordered search ${JSON.stringify(cdpath)}`, async () => {
  const { fs } = await fixture();
  const result = await execute(fs, `CDPATH='${cdpath}'; cd target; pwd`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, `${printed ? expected + "\n" : ""}${expected}\n`);
  assert.equal(result.stderr, "");
});

for (const operand of ["/one/target", "./target", "../one/target", ".", "..", ""]) test(`oversized CDPATH bypass ${JSON.stringify(operand)}`, async () => {
  const { fs } = await fixture();
  const result = await execute(fs, `cd '${operand}'`, { env: { CDPATH: "x".repeat(65_537) } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("relative HOME and relative OLDPWD each print exactly once", async () => {
  for (const script of ["HOME=target; cd", "OLDPWD=target; cd -"]) {
    const { fs } = await fixture();
    const result = await execute(fs, `CDPATH=/one; ${script}`);
    assert.equal(result.stdout, "/one/target\n");
    assert.equal(result.exitCode, 0);
  }
});

for (const code of ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP", "ENOTSUP", "EIO", "ECANCELED"] as const) {
  test(`typed search failure ${code}`, async () => {
    const { fs, calls } = await fixture();
    const stat = fs.stat.bind(fs);
    fs.stat = async (path, options) => { if (path === "/one/target") { calls.push(`failure:${path}`); throw new FsError(code, { path }); } return stat(path, options); };
    const result = await execute(fs, "CDPATH=/one:/two; cd target");
    const miss = ["ENOENT", "ENOTDIR", "EACCES"].includes(code);
    assert.equal(result.exitCode, miss ? 0 : 1);
    assert.equal(calls.includes("stat:/two/target"), miss);
  });
}

test("duck-typed errno is fatal, not a lookup miss", async () => {
  const { fs, calls } = await fixture();
  fs.stat = async () => { calls.push("throw"); throw Object.assign(new Error("not typed"), { code: "ENOENT" }); };
  const result = await execute(fs, "CDPATH=/one:/two; cd target");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(calls, ["throw"]);
});

test("non-directory skips access and fallback error determines diagnostic", async () => {
  const { fs, calls } = await fixture();
  await fs.writeFile("/one/problem", new TextEncoder().encode("file"));
  const result = await execute(fs, "CDPATH=/one; cd problem");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(calls, ["stat:/one/problem", "stat:/work/problem"]);
  assert.match(result.stderr, /cd: problem: No such file or directory/);
});

test("empty duplicate components and equivalent final fallback are fresh", async () => {
  const { fs, calls } = await fixture();
  const stat = fs.stat.bind(fs);
  let seen = 0;
  fs.stat = async (path, options) => {
    if (++seen <= 2) { calls.push(`miss:${path}`); throw new FsError("ENOENT", { path }); }
    return stat(path, options);
  };
  const result = await execute(fs, "CDPATH=:; cd target");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.deepEqual(calls, ["miss:/work/target", "miss:/work/target", "stat:/work/target", "access:1:/work/target"]);
});

test("delegated X_OK denial precedes checked state writes", async () => {
  const { fs } = await fixture();
  fs.access = async (path) => { throw new FsError("EACCES", { path }); };
  const result = await execute(fs, 'cd /one/target; pwd; printf "%s|%s" "$PWD" "$OLDPWD"');
  assert.equal(result.stdout, "/work\n/work|/");
  assert.match(result.stderr, /Permission denied/);
});

for (const variable of ["OLDPWD", "PWD"] as const) test(`checked ${variable} preserves earlier writes only`, async () => {
  const { fs } = await fixture();
  const result = await execute(fs, `readonly ${variable}; CDPATH=/one; cd target; pwd; printf '%s|%s' "$PWD" "$OLDPWD"`);
  assert.equal(result.stdout, variable === "OLDPWD" ? "/work\n/work|/" : "/one/target\n/work|/work");
  assert.match(result.stderr, /readonly variable/);
});

for (const pipe of [false, true]) test(`subshell/pipeline cwd isolation ${pipe}`, async () => {
  const { fs } = await fixture();
  const result = await execute(fs, pipe ? "CDPATH=/one; cd target | true; pwd" : "CDPATH=/one; (cd target; pwd); pwd");
  assert.equal(result.stdout, pipe ? "/work\n" : "/one/target\n/one/target\n/work\n");
});

test("prefix bindings restore while successful cwd remains", async () => {
  const { fs } = await fixture();
  const result = await execute(fs, 'PWD=temporary OLDPWD=temporary CDPATH=/one cd target; pwd; printf "%s|%s|%s" "$PWD" "$OLDPWD" "${CDPATH-unset}"');
  assert.equal(result.stdout, "/one/target\n/one/target\n/work|/|unset");
});

test("host invoke cd leaves parent and getopts cursor unchanged", async () => {
  const { fs } = await fixture();
  const commands = new CommandRegistry([{ name: "host", async execute(context) {
    assert.ok(context.invoke);
    await context.invoke("cd", ["target"], { env: { CDPATH: "/two" } });
    await writeText(context.stdout, `${context.cwd}\n`);
    return { exitCode: 0 };
  } }]);
  const result = await execute(fs, 'getopts ab opt -ab; host; getopts ab opt -ab; printf "%s:%s:" "$opt" "$OPTIND"; pwd', { commands });
  assert.equal(result.stdout, "/two/target\n/work\nb:2:/work\n");
});

for (const broken of [false, true]) test(`awaited output failure does not roll back, EPIPE=${broken}`, async () => {
  const { fs } = await fixture();
  let first = true;
  const result = await execute(fs, 'CDPATH=/one; cd target; printf "%s:" "$?"; pwd', {}, { stdout: { async write() {
    if (first) { first = false; throw Object.assign(new Error("sink"), broken ? { code: "EPIPE" } : {}); }
  } } });
  assert.equal(result.stdout, `/one/target\n${broken ? 141 : 1}:/one/target\n`);
});

for (const reason of [false, 0, "", new FsError("ENOENT")]) test(`caller abort wins over lookup miss ${String(reason)}`, async () => {
  const { fs } = await fixture();
  const controller = new AbortController();
  fs.access = async () => { controller.abort(reason); throw new FsError("EACCES"); };
  await assert.rejects(execute(fs, "CDPATH=/one:/two; cd target", {}, { signal: controller.signal }), error => Object.is(error, reason));
});

test("scan yields to caller cancellation before any provider call", async () => {
  const { fs, calls } = await fixture();
  const controller = new AbortController();
  const pending = execute(fs, "cd target", { env: { CDPATH: "x".repeat(60_000) } }, { signal: controller.signal });
  setImmediate(() => controller.abort(false));
  await assert.rejects(pending, error => error === false);
  assert.deepEqual(calls, []);
});

for (const [value, text] of [["x".repeat(65_537), "65536 UTF-8 bytes"], [":".repeat(4096), "4096 components"], ["é".repeat(32_769), "65536 UTF-8 bytes"]]) {
  test(`CDPATH preflight ${value!.length}/${text}`, async () => {
    const { fs, calls } = await fixture();
    const result = await execute(fs, "cd target", { env: { CDPATH: value! } });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes(`cd: CDPATH exceeds ${text}`));
    assert.deepEqual(calls, []);
  });
}

test("4096 slots followed by fresh fallback make 4097 stat probes", async () => {
  const { fs, calls } = await fixture();
  fs.stat = async path => { calls.push(path); throw new FsError("ENOENT", { path }); };
  const result = await execute(fs, "cd target", { env: { CDPATH: ":".repeat(4095) } });
  assert.equal(result.exitCode, 1);
  assert.equal(calls.length, 4097);
});

test("raw path cap rejects before normalization can shorten it", async () => {
  const { fs, calls } = await fixture();
  const result = await execute(fs, "cd target", { env: { CDPATH: "/".repeat(65_536) } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /cd: path exceeds 65536 UTF-8 bytes/);
  assert.deepEqual(calls, []);
});

test("absolute 65536-byte target admitted, next byte refused", async () => {
  for (const length of [65_536, 65_537]) {
    const { fs, calls } = await fixture();
    const directory = await fs.stat("/work");
    calls.length = 0;
    fs.stat = async path => { calls.push(path); return directory; };
    fs.access = async () => {};
    const result = await execute(fs, 'cd "$DEST"', { env: { DEST: "/" + "x".repeat(length - 1) } });
    assert.equal(result.exitCode, length === 65_536 ? 0 : 1);
    assert.equal(calls.length, length === 65_536 ? 1 : 0);
  }
});

test("local helper-work failure has ordinary status and leaves subsequent command usable", async () => {
  const { fs, calls } = await fixture();
  fs.stat = async path => { calls.push(path); throw new FsError("ENOENT", { path }); };
  const result = await execute(fs, 'cd "$DEST"; printf "%s" "$?"', { env: { DEST: "x".repeat(60_000), CDPATH: ":".repeat(100) } });
  assert.equal(result.stdout, "1");
  assert.match(result.stderr, /cd: helper work limit exceeded/);
  assert.equal(calls.length, 46);
});

for (const script of ["unset HOME; cd", "unset OLDPWD; cd -", "cd one two"]) test(`argument/missing-variable precedence ${script}`, async () => {
  const { fs, calls } = await fixture();
  const result = await execute(fs, script, { env: { CDPATH: "x".repeat(65_537) } });
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.stderr, /exceeds/);
  assert.deepEqual(calls, []);
});

for (const size of [65_792, 65_793]) test(`diagnostic payload ASCII boundary ${size}`, async () => {
  const { fs } = await fixture();
  fs.stat = async () => { throw new Error("x".repeat(size)); };
  const result = await execute(fs, "cd target");
  const payload = result.stderr.replace(/^shell: line 1: /, "").replace(/\n$/, "");
  assert.equal(payload, size === 65_792 ? "x".repeat(size) : "x".repeat(65_780) + " [truncated]");
});

test("multibyte diagnostic keeps scalar boundary and exact suffix", async () => {
  const { fs } = await fixture();
  fs.stat = async () => { throw new Error("a" + "😀".repeat(20_000)); };
  const result = await execute(fs, "cd target");
  const payload = result.stderr.replace(/^shell: line 1: /, "").replace(/\n$/, "");
  assert.equal(payload, "a" + "😀".repeat(16_444) + " [truncated]");
  assert.ok(Buffer.byteLength(payload) <= 65_792);
});

test("parent output budget remains authoritative for diagnostic writes", async () => {
  const { fs } = await fixture();
  fs.stat = async () => { throw new Error("x".repeat(100_000)); };
  await assert.rejects(execute(fs, "cd target", { limits: { maxOutputBytes: 10 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});

for (const adapter of ["memory", "real", "readonly", "s3", "webdav"] as const) test(`public ${adapter} cd search and metadata-only delegation`, async () => {
  const root = await mkdtemp(join(tmpdir(), "safe-bash-cd-adapter-"));
  try {
    let fs: FileSystem;
    const requests: string[] = [];
    if (adapter === "s3") fs = new S3FileSystem({ bucket: "cd", transport: new MockS3Client({ buckets: ["cd"] }) });
    else if (adapter === "real") fs = new RealFileSystem({ root });
    else if (adapter === "webdav") fs = new WebDavFileSystem({ baseUrl: "https://cd.invalid/dav/", fetch: async (url, init) => {
      requests.push(`${init?.method}:${new Headers(init?.headers).get("depth")}:${new URL(url).pathname}`);
      const href = new URL(url).pathname;
      if (!new Set(["/dav/work", "/dav/one/target"]).has(href.replace(/\/$/, ""))) return new Response(null, { status: 404 });
      return new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`, { status: 207 });
    } });
    else fs = new MemoryFileSystem();
    if (adapter !== "webdav") { await fs.mkdir("/work", { recursive: true }); await fs.mkdir("/one/target", { recursive: true }); }
    if (adapter === "readonly") fs = new ReadOnlyFileSystem(fs);
    const result = await execute(fs, "CDPATH=/absent:/one; cd target; pwd");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "/one/target\n/one/target\n");
    assert.equal(result.stderr, "");
    assert.ok(requests.every(request => request.startsWith("PROPFIND:0:")));
    if (adapter === "webdav") assert.deepEqual(requests, [
      "PROPFIND:0:/dav/absent/target", "PROPFIND:0:/dav/absent",
      "PROPFIND:0:/dav/one/target", "PROPFIND:0:/dav/one/target",
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
