import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, MemoryFileSystem, ReadOnlyFileSystem, CommandRegistry, standardCommands, ShellLimitError, FsError } from "../../../../src/index.js";
import type { ShellOptions, ShellExecOptions } from "../../../../src/index.js";

async function fixture(options: Partial<ShellOptions> = {}) {
  const fs = new MemoryFileSystem();
  for (const directory of ["/dev", "/c/a", "/a", "/b", "/old", "/borrowed", "/search/target", "/c/+1", "/c/-dash"]) await fs.mkdir(directory, { recursive: true });
  const shell = new Shell({ fs, cwd: "/c", env: { HOME: "/home", OLDPWD: "/old", PATH: "" }, ...options }).use(standardCommands());
  return { fs, shell };
}

async function run(script: string, options: Partial<ShellOptions> = {}, exec: ShellExecOptions = {}) {
  const { shell } = await fixture(options);
  try { return await shell.exec(script, exec); }
  finally { await shell.dispose(); }
}

const cases: readonly [string, string, number][] = [
  ["dirs", "/c\n", 0],
  ["pushd /a", "/a /c\n", 0],
  ["pushd /a >/dev/null; pushd", "/c /a\n", 0],
  ["pushd -n /b >/dev/null; pushd -n /a >/dev/null; pushd +2", "/b /c /a\n", 0],
  ["pushd -n /b >/dev/null; pushd -n /a >/dev/null; pushd -0", "/b /c /a\n", 0],
  ["pushd +0", "/c\n", 0],
  ["pushd", "", 1], ["popd", "", 1],
  ["pushd -n /b >/dev/null; pushd -n /a >/dev/null; popd", "/a /b\n", 0],
  ["pushd -n /b >/dev/null; pushd -n /a >/dev/null; popd +2", "/c /a\n", 0],
  ["pushd -n ''", "/c \n", 0],
  ["pushd -n /a >/dev/null; pushd -n; dirs -l -p", "/c\n/a\n", 0],
  ["pushd -n /a >/dev/null; pushd -n /b >/dev/null; pushd -n +1; dirs -l -p", "/c\n/a\n/c\n", 0],
  ["pushd -n /b >/dev/null; pushd -n /a >/dev/null; popd -n +0", "/c /b\n", 0],
  ["pushd -n /b >/dev/null; pushd -n /a >/dev/null; popd -n +1", "/c /b\n", 0],
  ["pushd -n /a >/dev/null; dirs -c; dirs", "/c\n", 0],
  ["pushd -n /a >/dev/null; cd /b; dirs -l -p", "/b\n/a\n", 0],
  ["pushd -n a >/dev/null; popd", "/c/a\n", 0],
  ["pushd ''", "/c /c\n", 0],
  ["pushd -n a b", "/c a\n", 0],
  ["pushd /a /b", "", 1], ["pushd /a -n", "", 1],
  ["pushd --", "", 1], ["pushd -n --", "", 0],
  ["pushd -- +1", "/c/+1 /c\n", 0],
  ["pushd -- -dash", "/c/-dash /c\n", 0],
  ["pushd -- -", "/old\n/old /c\n", 0],
  ["pushd -n -- -", "/c -\n", 0],
  ["pushd -n /a >/dev/null; pushd +99 +0", "", 1],
  ["pushd -n /a >/dev/null; popd +99 +1", "/c\n", 0],
  ["pushd -n /a >/dev/null; popd -- +99", "/a\n", 0],
  ["pushd -n /a >/dev/null; popd '' +99", "/a\n", 0],
  ["popd word", "", 2], ["dirs -c +99", "", 0], ["dirs -c +bad", "", 2],
  ["dirs -p -- +99 bad", "/c\n", 0],
  ["dirs +9223372036854775807", "", 1], ["dirs +9223372036854775808", "", 2],
  ["pushd -n /a >/dev/null; dirs ++0001", "/a\n", 0],
  ["dirs +-1", "", 1], ["dirs --9223372036854775808", "", 1],
  ["dirs '+ 1'", "", 2], ["dirs +１", "", 2], ["dirs +", "", 2],
  ["dirs -0", "/c\n", 0],
  ["pushd -n /a >/dev/null; dirs -v -p", " 0  /c\n 1  /a\n", 0],
  ["HOME=/c; pushd -n /c/a", "~ ~/a\n", 0],
  ["HOME=/c; pushd -n /cat", "~ /cat\n", 0],
  ["HOME=/c/; pushd -n /c/a", "/c /c/a\n", 0],
  ["HOME=/; dirs", "/c\n", 0],
  ["HOME=raw; pushd -n raw/a", "/c ~/a\n", 0],
  ["CDPATH=/search; pushd target", "/search/target\n/search/target /c\n", 0],
];
for (const [script, stdout, status] of cases) test(`ratified ${script}`, async () => {
  const result = await run(script);
  assert.equal(result.stdout, stdout);
  assert.equal(result.exitCode, status);
  if (status === 0) assert.equal(result.stderr, "");
});

for (const flags of ["-lp", "-pv", "-vp", "-ll", "-cpv", "--help"]) test(`separate flags only ${flags}`, async () => {
  assert.equal((await run(`dirs ${flags}`)).exitCode, 2);
});

test("failure publication is not generic rollback", async () => {
  for (const [operation, expected] of [["popd", "/c\n/missing\n/a\n"], ["pushd +1", "/c\n/a\n/c\n"], ["pushd", "/c\n/c\n/a\n"], ["pushd /missing", "/c\n/missing\n/a\n"]]) {
    const result = await run(`pushd -n /a >/dev/null; pushd -n /missing >/dev/null; ${operation}; dirs -l -p`);
    assert.equal(result.stdout, expected);
    assert.match(result.stderr, /No such file/);
  }
});

test("fresh exec and shared function/source versus process and cloned contexts", async () => {
  const { fs, shell } = await fixture();
  try {
    await fs.writeFile("/script", new TextEncoder().encode("pushd -n /b >/dev/null"));
    const result = await shell.exec("f(){ pushd -n /a >/dev/null; }; f; . /script; (dirs -c); x=$(dirs -c); dirs -c | true; sh -c 'dirs -l -p'; dirs -l -p");
    assert.equal(result.stdout, "/c\n/c\n/b\n/a\n");
    assert.equal((await shell.exec("dirs -l -p")).stdout, "/c\n");
    const parallel = await Promise.all([shell.exec("pushd -n /a >/dev/null; dirs -l -p"), shell.exec("dirs -l -p")]);
    assert.deepEqual(parallel.map(result => result.stdout), ["/c\n/a\n", "/c\n"]);
  } finally { await shell.dispose(); }
});

test("invoke children inherit independent tails and may replace only their top", async () => {
  const registry = new CommandRegistry();
  registry.register({ name: "children", async execute(context) {
    await context.invoke!("pushd", ["-n", "/b"]);
    await context.invoke!("dirs", ["-l", "-p"], { cwd: "/b", env: {}, replaceEnv: true });
    return { exitCode: 0 };
  } });
  const result = await run("pushd -n /a >/dev/null; children; dirs -l -p", { commands: registry });
  assert.equal(result.stdout, "/c /b /a\n/b\n/a\n/c\n/a\n");
});

for (const body of ["pushd /borrowed >/dev/null", "pushd /a >/dev/null; cd /borrowed"]) test(`stack publication survives same-path outer middleware: ${body}`, async () => {
  const { shell } = await fixture();
  shell.use(async (context, next) => { if (context.command === "f") { await Promise.resolve(); context.cwd = "/borrowed"; } return next(); });
  try {
    const result = await shell.exec(`f(){ ${body}; }; f; pwd; printf '%s' "$PWD"`);
    assert.equal(result.stdout, "/borrowed\n/borrowed");
  } finally { await shell.dispose(); }
});

for (const body of ["dirs >/dev/null", "pushd -n /a >/dev/null", "cd /borrowed"]) test(`no stack publication retains borrowed restoration: ${body}`, async () => {
  const { shell } = await fixture();
  shell.use((context, next) => { if (context.command === "f") context.cwd = "/borrowed"; return next(); });
  try { assert.equal((await shell.exec(`f(){ ${body}; }; f; pwd`)).stdout, "/c\n"); }
  finally { await shell.dispose(); }
});

test("readonly checked state ordering retains partial publications", async () => {
  const old = await run("readonly OLDPWD; pushd /a; dirs -l -p; printf '%s|%s' \"$PWD\" \"$OLDPWD\"");
  assert.equal(old.stdout, "/c\n/c|/old");
  assert.match(old.stderr, /readonly/);
  const current = await run("readonly PWD; pushd /a; dirs -l -p; printf '%s|%s' \"$PWD\" \"$OLDPWD\"");
  assert.equal(current.stdout, "/a\n/c|/c");
  assert.match(current.stderr, /readonly/);
  const swapped = await run("pushd -n /a >/dev/null; readonly OLDPWD; pushd; dirs -l -p");
  assert.equal(swapped.stdout, "/c\n/c\n");
});

for (const beforeTail of [true, false]) test(`output failure ${beforeTail ? "required cd print before" : "automatic print after"} tail publication`, async () => {
  const { shell } = await fixture();
  let failed = false;
  shell.use((context, next) => {
    if (context.command === "pushd") Object.assign(context, { stdout: { async write() { if (!failed) { failed = true; throw new Error("stack sink"); } } } });
    return next();
  });
  try {
    const result = await shell.exec(`${beforeTail ? "CDPATH=/search; pushd target" : "pushd /a"}; dirs -l -p`);
    assert.equal(result.stdout, beforeTail ? "/search/target\n" : "/a\n/c\n");
    assert.match(result.stderr, /stack sink/);
  } finally { await shell.dispose(); }
});

test("no-cd operations require neither metadata nor writable filesystem", async () => {
  const { fs, shell: setup } = await fixture();
  await setup.dispose();
  fs.stat = async () => { throw new Error("unexpected stat"); };
  fs.access = async () => { throw new Error("unexpected access"); };
  const result = await run("readonly PWD OLDPWD; pushd -n /missing; dirs -l -p; popd -n; dirs -c", { fs: new ReadOnlyFileSystem(fs) });
  assert.equal(result.stdout, "/c /missing\n/c\n/missing\n/c\n");
  assert.equal(result.stderr, "");
});

test("builtin discovery, function shadowing and LET/getopts state remain integrated", async () => {
  const result = await run("type -t pushd dirs popd; pushd(){ printf shadow; }; pushd; command pushd -n /a >/dev/null; let 'answer=6*7'; set -- -ab; getopts ab first; dirs -c; getopts ab second; printf '|%s|%s|%s' \"$answer\" \"$first\" \"$second\"");
  assert.equal(result.stdout, "builtin\nbuiltin\nbuiltin\nshadow|42|a|b");
  assert.equal(result.stderr, "");
});

for (const unused of ["dirs -l", "dirs -c", "pushd -n"]) test(`unused oversized HOME ${unused}`, async () => {
  assert.equal((await run(unused, { env: { HOME: "x".repeat(65_537) } })).exitCode, 0);
});
test("used HOME and reached argv limits versus ignored trailing arguments", async () => {
  assert.match((await run("dirs", { env: { HOME: "x".repeat(65_537) } })).stderr, /HOME exceeds 65536/);
  assert.match((await run('pushd -n "$RAW"', { env: { RAW: "x".repeat(65_537) } })).stderr, /argument exceeds 65536/);
  assert.equal((await run('pushd -n raw "$RAW"', { env: { RAW: "x".repeat(65_537) } })).exitCode, 0);
  assert.equal((await run('dirs -- "$RAW"', { env: { RAW: "x".repeat(65_537) } })).exitCode, 0);
});

test("inclusive raw UTF8 cap and 16KiB scalar-safe output", async () => {
  const chunks: Uint8Array[] = [];
  const raw = "😀".repeat(16_384);
  const result = await run('pushd -n "$RAW"', { env: { RAW: raw } }, { stdout: { async write(chunk) { chunks.push(chunk.slice()); } } });
  assert.equal(result.stdout, `/c ${raw}\n`);
  assert.ok(chunks.length >= 5);
  assert.ok(chunks.every(chunk => chunk.length <= 16_384));
  assert.equal(chunks.map(chunk => new TextDecoder("utf-8", { fatal: true }).decode(chunk)).join(""), result.stdout);
});

for (const reason of [false, 0, "", new FsError("ENOENT")]) test(`exact caller cancellation ${String(reason)}`, async () => {
  const { fs, shell } = await fixture();
  const controller = new AbortController();
  fs.access = async () => { controller.abort(reason); throw new FsError("EACCES"); };
  try { await assert.rejects(shell.exec("pushd /a", { signal: controller.signal }), error => Object.is(error, reason)); }
  finally { await shell.dispose(); }
});

test("long helper scans yield to cancellation without provider effects", async () => {
  const { fs, shell } = await fixture({ env: { RAW: "x".repeat(65_536) } });
  let called = false;
  fs.stat = async () => { called = true; throw new Error("unexpected"); };
  const controller = new AbortController();
  const reason = { cancel: "scan" };
  const pending = shell.exec('pushd -n "$RAW"', { signal: controller.signal });
  const immediate = setImmediate(() => controller.abort(reason));
  try { await assert.rejects(pending, error => error === reason); assert.equal(called, false); }
  finally { clearImmediate(immediate); await shell.dispose(); }
});

test("shared output and command budgets remain authoritative", async () => {
  await assert.rejects(run("pushd /a", { limits: { maxOutputBytes: 2 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  assert.equal((await run("pushd /a", { limits: { maxCommands: 1 } })).exitCode, 0);
});

test("4096 remembered entries inclusive, next insertion before missing OLDPWD", async () => {
  const setup = Array.from({ length: 4096 }, () => "pushd -n '' >/dev/null").join(";");
  const result = await run(`${setup}; dirs +4096; unset OLDPWD; pushd -; printf '%s' "$?"`, { limits: { maxCommands: 20_000, maxOutputBytes: 32 * 1024 * 1024 } });
  assert.equal(result.stdout, "\n1");
  assert.match(result.stderr, /pushd: directory stack exceeds 4096 entries/);
  assert.doesNotMatch(result.stderr, /OLDPWD not set/);
});

test("chunk writes apply real backpressure before a later chunk", async () => {
  const { shell } = await fixture({ env: { RAW: "x".repeat(65_536) } });
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = new Promise<void>(resolve => { entered = resolve; });
  let writes = 0;
  let settled = false;
  const pending = shell.exec('pushd -n "$RAW"', { stdout: { async write() {
    if (++writes === 1) { entered(); await blocked; }
  } } });
  void pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await first;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(writes, 1);
    assert.equal(settled, false);
    release();
    assert.equal((await pending).exitCode, 0);
    assert.ok(writes >= 5);
  } finally { release(); await pending.catch(() => undefined); await shell.dispose(); }
});

test("EPIPE automatic display retains published state and maps to141", async () => {
  const { shell } = await fixture();
  shell.use((context, next) => {
    if (context.command === "pushd") Object.assign(context, { stdout: { async write() { throw Object.assign(new Error("closed"), { code: "EPIPE" }); } } });
    return next();
  });
  try {
    const result = await shell.exec('pushd /a; printf "%s:" "$?"; dirs -l -p');
    assert.equal(result.stdout, "141:/a\n/c\n");
  } finally { await shell.dispose(); }
});

test("nested same-path readonly PWD failure preserves actual cwd publication", async () => {
  const { shell } = await fixture();
  shell.use((context, next) => { if (context.command === "f") context.cwd = "/borrowed"; return next(); });
  try {
    const result = await shell.exec('readonly PWD; f(){ pushd /borrowed; }; f; dirs -l -p; printf "%s|%s" "$PWD" "$OLDPWD"');
    assert.equal(result.stdout, "/borrowed\n/c|/borrowed");
    assert.match(result.stderr, /PWD: readonly variable/);
  } finally { await shell.dispose(); }
});

test("registry inventory unchanged by discovery and execution of three builtins", async () => {
  const { shell } = await fixture();
  try {
    await shell.exec(":");
    const before = shell.commands.list().map(command => command.name).sort();
    assert.ok(["pushd", "dirs", "popd"].every(name => !before.includes(name)));
    const result = await shell.exec("pushd /a; dirs -c; pushd -n /b; popd -n");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(shell.commands.list().map(command => command.name).sort(), before);
  } finally { await shell.dispose(); }
});
