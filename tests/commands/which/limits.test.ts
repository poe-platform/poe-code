import assert from "node:assert/strict";
import test from "node:test";
import { createWhichCommand, type WhichLimits } from "../../../src/commands/which/index.js";
import { settings } from "../../../src/commands/which/options.js";
import { FsError } from "../../../src/contracts/index.js";
import { controlled, context, run } from "./helpers.js";

const keys: readonly (keyof WhichLimits)[] = [
  "maxArguments", "maxArgumentBytes", "maxPathEnvBytes", "maxPathComponents", "maxPathBytes", "maxProbes", "maxOutputBytes",
];

test("exact defaults; all keys reject invalid values and unknown keys", () => {
  assert.deepEqual(settings({}), {
    maxArguments: 4096, maxArgumentBytes: 65536, maxPathEnvBytes: 65536, maxPathComponents: 4096,
    maxPathBytes: 16384, maxProbes: 65536, maxOutputBytes: 8388608,
  });
  for (const key of keys) {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined, true, 1n]) {
      assert.throws(() => Reflect.apply(createWhichCommand, undefined, [{ limits: { [key]: value } }]), {
        name: "RangeError", message: `Invalid which limit: ${key}`,
      });
    }
    assert.doesNotThrow(() => createWhichCommand({ limits: { [key]: key === "maxPathBytes" ? Number.MAX_SAFE_INTEGER - 256 : Number.MAX_SAFE_INTEGER } }));
  }
  assert.throws(() => createWhichCommand({ limits: { maxPathBytes: Number.MAX_SAFE_INTEGER - 255 } }), RangeError);
  for (const key of ["bogus", "toString", "__proto__", Symbol("bogus")]) {
    assert.throws(() => Reflect.apply(createWhichCommand, undefined, [{ limits: { [key]: 1 } }]), {
      name: "RangeError", message: `Unknown which limit: ${String(key)}`,
    });
  }
});

test("limits are captured at construction and budgets restart per invocation", async () => {
  const options = { limits: { maxProbes: 1 } };
  const command = createWhichCommand(options);
  options.limits.maxProbes = 3;
  const { fs } = controlled();
  for (let attempt = 0; attempt < 2; attempt++) {
    const capture = context(["-a", "p"], { fs });
    assert.equal((await command.execute(capture.invocation)).exitCode, 1);
    assert.equal(Buffer.concat(capture.stdout).toString(), "/a/p\n");
    assert.equal(Buffer.concat(capture.stderr).toString(), "which: maxProbes limit exceeded\n");
  }
});

test("all input caps admit exact boundaries and reject before providers", async () => {
  const { fs, calls } = controlled();
  const cases = [
    { key: "maxArguments", boundary: 2, args: ["-s", "p"], env: { PATH: "" }, cwd: "/" },
    { key: "maxArgumentBytes", boundary: 5, args: ["-s", "雪"], env: { PATH: "" }, cwd: "/" },
    { key: "maxPathEnvBytes", boundary: 3, args: ["p"], env: { PATH: "雪" }, cwd: "/" },
    { key: "maxPathComponents", boundary: 3, args: ["p"], env: { PATH: "::" }, cwd: "/" },
    { key: "maxPathBytes", boundary: 4, args: ["/p"], env: { PATH: "" }, cwd: "/abc" },
  ] as const;
  for (const entry of cases) {
    const overrides = { fs, env: entry.env, cwd: entry.cwd };
    assert.equal((await run(entry.args, { limits: { [entry.key]: entry.boundary } }, overrides)).exitCode, 0);
    calls.length = 0;
    const result = await run(entry.args, { limits: { [entry.key]: entry.boundary - 1 } }, overrides);
    assert.equal(result.stderr, `which: ${entry.key} limit exceeded\n`);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(calls, []);
  }
});

test("admission priority is count, argv bytes, PATH bytes/components, cwd bytes, NUL, grammar, cwd", async () => {
  const { fs, calls } = controlled();
  const args = ["-z\0", "p"];
  const overrides = { fs, env: { PATH: "::\0" }, cwd: "bad\0" };
  const variants: readonly [Partial<WhichLimits>, string][] = [
    [{ maxArguments: 1, maxArgumentBytes: 1, maxPathEnvBytes: 1, maxPathComponents: 1, maxPathBytes: 1 }, "maxArguments limit exceeded"],
    [{ maxArgumentBytes: 1, maxPathEnvBytes: 1, maxPathComponents: 1, maxPathBytes: 1 }, "maxArgumentBytes limit exceeded"],
    [{ maxPathEnvBytes: 1, maxPathComponents: 1, maxPathBytes: 1 }, "maxPathEnvBytes limit exceeded"],
    [{ maxPathComponents: 1, maxPathBytes: 1 }, "maxPathComponents limit exceeded"],
    [{ maxPathBytes: 1 }, "maxPathBytes limit exceeded"],
    [{}, "invalid argument: NUL byte"],
  ];
  for (const [limits, message] of variants) assert.equal((await run(args, { limits }, overrides)).stderr, `which: ${message}\n`);
  assert.equal((await run(["-z"], {}, { fs, cwd: "relative" })).stderr, "which: illegal option -- z\nusage: which [-as] program ...\n");
  assert.equal((await run(["p"], {}, { fs, cwd: "relative" })).stderr, "which: cwd must be an absolute virtual path\n");
  for (const invalid of [{ args: ["p\0"] }, { env: { PATH: "\0" } }, { cwd: "/\0" }]) {
    assert.equal((await run(["p"], {}, { fs, ...invalid })).stderr, "which: invalid argument: NUL byte\n");
  }
  assert.deepEqual(calls, []);
});

test("unused PATH is fully admitted for slash operands and absent PATH does not bypass input errors", async () => {
  const { fs, calls } = controlled();
  assert.equal((await run(["/p"], { limits: { maxPathComponents: 1 } }, { fs, env: { PATH: ":" } })).stderr, "which: maxPathComponents limit exceeded\n");
  assert.equal((await run(["/p"], {}, { fs, env: { PATH: "\0" } })).stderr, "which: invalid argument: NUL byte\n");
  assert.equal((await run(["/p\0"], {}, { fs, env: {} })).stderr, "which: invalid argument: NUL byte\n");
  assert.deepEqual(calls, []);
});

test("display and absolute lookup bytes each pre-admit before stat", async () => {
  const { fs, calls } = controlled();
  assert.equal((await run(["雪"], { limits: { maxPathBytes: 6 } }, { fs, cwd: "/", env: { PATH: "" } })).stdout, "./雪\n");
  calls.length = 0;
  for (const overrides of [{ cwd: "/", env: { PATH: "" } }, { cwd: "/", env: { PATH: "/long" } }]) {
    assert.equal((await run(["雪"], { limits: { maxPathBytes: 5 } }, { fs, ...overrides })).stderr, "which: maxPathBytes limit exceeded\n");
  }
  assert.deepEqual(calls, []);
  assert.equal((await run(["/雪"], { limits: { maxPathBytes: 4 } }, { fs, cwd: "/" })).exitCode, 0);
});

test("logical probes include duplicate, directory-designating, failed and nonregular attempts", async () => {
  const { fs, calls } = controlled();
  const result = await run(["-a", "p"], { limits: { maxProbes: 1 } }, { fs, env: { PATH: "/a:/a" } });
  assert.equal(result.stdout, "/a/p\n");
  assert.equal(result.stderr, "which: maxProbes limit exceeded\n");
  assert.deepEqual(calls, ["stat /a/p", "access /a/p"]);
  calls.length = 0;
  assert.equal((await run(["p/", "/oversize"], { limits: { maxProbes: 1, maxPathBytes: 5 } }, { fs, cwd: "/" })).stderr, "which: maxProbes limit exceeded\n");
  assert.deepEqual(calls, []);
  assert.equal((await run(["", "", "p"], { limits: { maxProbes: 1 } }, { fs })).stderr, "");
  for (const mode of ["miss", "nonregular"] as const) {
    let stats = 0;
    const provider = controlled({ async stat() {
      stats++;
      if (mode === "miss") throw new FsError("ENOENT");
      return { type: "directory", size: 0, mode: 0o755, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
    } });
    assert.equal((await run(["-a", "p"], { limits: { maxProbes: 1 } }, { fs: provider.fs })).stderr, "which: maxProbes limit exceeded\n");
    assert.equal(stats, 1);
    assert.deepEqual(provider.calls, []);
  }
});

test("UTF-8 replacement encoding, cumulative LF bytes and quiet zero-output allowance", async () => {
  const { fs } = controlled();
  for (const [name, byteLength] of [["雪", 3], ["😀", 4], ["\ud800", 3], ["\udfff", 3]] as const) {
    const lineBytes = byteLength + 3;
    const result = await run([name], { limits: { maxOutputBytes: lineBytes, maxArgumentBytes: byteLength } }, { fs, cwd: "/", env: { PATH: "" } });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.chunks[0], new TextEncoder().encode(`./${name}\n`));
    assert.equal((await run([name], { limits: { maxOutputBytes: lineBytes - 1 } }, { fs })).stderr, "which: maxOutputBytes limit exceeded\n");
  }
  const capped = await run(["-a", "p"], { limits: { maxOutputBytes: 9 } }, { fs });
  assert.equal(capped.stdout, "/a/p\n");
  assert.equal(capped.stderr, "which: maxOutputBytes limit exceeded\n");
  assert.equal(capped.diagnostics.length, 1);
  assert.equal((await run(["-as", "p"], { limits: { maxOutputBytes: 1 } }, { fs })).exitCode, 0);
});

test("default boundaries are not small hidden ceilings; repeated scan work remains bounded", async () => {
  const { fs } = controlled();
  const longFlags = `-${"s".repeat(65534)}`;
  assert.equal((await run([longFlags, "p"], {}, { fs })).exitCode, 0);
  assert.equal((await run([`${longFlags}s`, "p"], {}, { fs })).stderr, "which: maxArgumentBytes limit exceeded\n");
  assert.equal((await run(Array.from({ length: 4097 }, () => ""), {}, { fs })).stderr, "which: maxArguments limit exceeded\n");
  assert.equal((await run(["p"], {}, { fs, env: { PATH: ":".repeat(4096) } })).stderr, "which: maxPathComponents limit exceeded\n");
  assert.equal((await run(["/p"], {}, { fs, env: { PATH: "a".repeat(65537) } })).stderr, "which: maxPathEnvBytes limit exceeded\n");
  assert.equal((await run(["p"], {}, { fs, cwd: `/${"v".repeat(16384)}` })).stderr, "which: maxPathBytes limit exceeded\n");
});
