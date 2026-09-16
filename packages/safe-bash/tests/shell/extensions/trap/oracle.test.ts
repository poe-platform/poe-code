import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { authenticateOracle, nativeOptions, runNative, type OracleHost } from "./oracle.js";

const bytes = Buffer.from("in-memory oracle executable");
const digest = createHash("sha256").update(bytes).digest("hex");
const env = { SAFE_BASH_TEST_BASH: "/fixture/bash", SAFE_BASH_TEST_BASH_SHA256: digest };

function fixture() {
  let executions = 0, closes = 0;
  const stat = { size: bytes.length, mode: 0o100755, isFile: () => true };
  const host: OracleHost = {
    now: () => 0,
    lstat: () => stat,
    open: () => ({
      stat: () => stat,
      read(buffer, position) {
        const chunk = bytes.subarray(position, position + buffer.length);
        buffer.set(chunk);
        return chunk.length;
      },
      close() { closes++; },
    }),
    spawn(executable, args, options) {
      executions++;
      assert.equal(executable, env.SAFE_BASH_TEST_BASH);
      assert.equal(options.killSignal, "SIGKILL");
      assert.ok(options.timeout > 0 && options.timeout <= 2000);
      assert.ok(options.maxBuffer <= 65536);
      assert.equal(options.env.BASH_ENV, undefined);
      assert.equal(options.env.PATH, "/__safe_bash_oracle_no_path__");
      return { status: 0, signal: null, stdout: Buffer.from(args.includes("--version") ? "GNU bash, version 5.2.37(1)-release (fixture)\n" : "body"), stderr: Buffer.alloc(0) };
    },
  };
  return { host, stat, executions: () => executions, closes: () => closes };
}

test("only completely absent Bash prerequisites name a native-only skip", () => {
  assert.match(String(nativeOptions({}).skip), /SAFE_BASH_TEST_BASH.*SAFE_BASH_TEST_BASH_SHA256.*5\.2\.37/u);
  for (const supplied of [{ SAFE_BASH_TEST_BASH: "" }, { SAFE_BASH_TEST_BASH_SHA256: "" }, env]) assert.equal(nativeOptions(supplied).skip, false);
});

for (const supplied of [
  {}, { SAFE_BASH_TEST_BASH: "/fixture/bash" }, { SAFE_BASH_TEST_BASH_SHA256: digest },
  { ...env, SAFE_BASH_TEST_BASH: "bash" }, { ...env, SAFE_BASH_TEST_BASH: "/bad\0bash" },
  { ...env, SAFE_BASH_TEST_BASH_SHA256: "invalid" }, { ...env, SAFE_BASH_TEST_BASH_SHA256: digest.toUpperCase() },
]) test(`invalid or partial oracle prerequisites fail: ${JSON.stringify(supplied)}`, () => {
  const candidate = fixture();
  assert.throws(() => authenticateOracle(supplied, candidate.host));
  assert.equal(candidate.executions(), 0);
});

test("valid bounded executable is hashed before version and script execution", () => {
  const candidate = fixture();
  assert.equal(authenticateOracle(env, candidate.host), env.SAFE_BASH_TEST_BASH);
  assert.equal(candidate.closes(), 1);
  assert.equal(candidate.executions(), 1);
  assert.equal(runNative("printf body", undefined, env, candidate.host).stdout.toString(), "body");
  assert.equal(candidate.executions(), 3);
});

for (const input of ["", "\0\n\\'é", "no final newline\n\n"]) test(`oracle input uses a reopenable pipe without rewriting source: ${JSON.stringify(input)}`, () => {
  const candidate = fixture();
  const original = candidate.host.spawn;
  const script = `printf '%s' "$0"; . /dev/stdin`;
  candidate.host.spawn = (executable, args, options) => {
    if (!args.includes("--version")) {
      assert.deepEqual(args.slice(0, 4), ["--noprofile", "--norc", "-c", `exec "$BASH" --noprofile --norc -c "$1" shell < <(printf '%b' "$2")`]);
      assert.equal(args[5], script);
      assert.equal(options.input, undefined);
      const encoded = args[6]!;
      const decoded: number[] = [];
      for (let index = 0; index < encoded.length; index += 5) {
        assert.equal(encoded.slice(index, index + 2), "\\0");
        decoded.push(Number.parseInt(encoded.slice(index + 2, index + 5), 8));
      }
      assert.deepEqual(Buffer.from(decoded), Buffer.from(input));
    }
    return original(executable, args, options);
  };
  runNative(script, input, env, candidate.host);
});

test("oracle input argument bound refuses before native execution", () => {
  const candidate = fixture();
  assert.throws(() => runNative(":", "é".repeat(8193), env, candidate.host), RangeError);
  assert.equal(candidate.executions(), 0);
});

for (const problem of ["missing", "symlink", "directory", "empty", "oversized", "non-executable", "hash"] as const) {
  test(`oracle ${problem} fails before native execution`, () => {
    const candidate = fixture();
    if (problem === "missing") candidate.host.lstat = () => { throw new Error("ENOENT"); };
    if (problem === "symlink" || problem === "directory") candidate.stat.isFile = () => false;
    if (problem === "empty") candidate.stat.size = 0;
    if (problem === "oversized") candidate.stat.size = 32 * 1024 * 1024 + 1;
    if (problem === "non-executable") candidate.stat.mode = 0o100644;
    assert.throws(() => authenticateOracle(problem === "hash" ? { ...env, SAFE_BASH_TEST_BASH_SHA256: "0".repeat(64) } : env, candidate.host));
    assert.equal(candidate.executions(), 0);
  });
}

for (const version of ["GNU bash, version 3.2.57(1)-release", "GNU bash, version 5.2.3(1)-release", "GNU bash, version 5.2.370(1)-release", "GNU bash, version 5.3.0(1)-release"]) {
  test(`non-target version is rejected, not substituted into historical expectations: ${version}`, () => {
    const candidate = fixture();
    candidate.host.spawn = () => ({ status: 0, signal: null, stdout: Buffer.from(version), stderr: Buffer.alloc(0) });
    assert.throws(() => authenticateOracle(env, candidate.host), /5\.2\.37/u);
  });
}

test("hashing deadline closes the admitted file before refusing execution", () => {
  const candidate = fixture();
  let clock = 0;
  candidate.host.now = () => { clock += 1001; return clock; };
  assert.throws(() => authenticateOracle(env, candidate.host), /deadline/u);
  assert.equal(candidate.executions(), 0);
  assert.equal(candidate.closes(), 1);
});

for (const failure of ["deadline", "output", "signal", "status"] as const) test(`version ${failure} fails closed`, () => {
  const candidate = fixture();
  candidate.host.spawn = () => ({
    status: failure === "status" ? 1 : 0, signal: failure === "signal" ? "SIGKILL" : null,
    stdout: Buffer.alloc(failure === "output" ? 65537 : 0), stderr: Buffer.alloc(0),
    ...(failure === "deadline" ? { error: new Error("ETIMEDOUT") } : {}),
  });
  assert.throws(() => authenticateOracle(env, candidate.host));
});

test("script output and deadline failures are not returned as oracle expectations", () => {
  for (const failure of ["output", "deadline"] as const) {
    const candidate = fixture();
    const spawn = candidate.host.spawn;
    candidate.host.spawn = (executable, args, options) => args.includes("--version") ? spawn(executable, args, options) : {
      status: 0, signal: null, stdout: Buffer.alloc(failure === "output" ? 65537 : 0), stderr: Buffer.alloc(0),
      ...(failure === "deadline" ? { error: new Error("ETIMEDOUT") } : {}),
    };
    assert.throws(() => runNative(":", undefined, env, candidate.host));
  }
});
