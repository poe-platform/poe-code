import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { dateCases } from "./date-cases.js";
import { run } from "./helpers.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const binaries = resolve(root, "tests/commands/metadata-stress/.oracle/coreutils-9.7/src");
const available = ["date", "sleep", "printenv"].every(name => existsSync(join(binaries, name)));

test("pinned local GNU9.7 differential (external oracle; not a pass when absent)", { skip: available ? false : "GNU9.7 binaries unavailable; always-runnable vectors remain separate" }, async context => {
  const directory = await mkdtemp(join(tmpdir(), "safe-bash-time-env-gnu-"));
  const native = (name: string, args: readonly string[], env: Record<string, string> = { TZ: "UTC", LC_ALL: "C" }) => {
    const result = spawnSync(join(binaries, name), args, { cwd: directory, env, timeout: 3000, maxBuffer: 1024 * 1024 });
    if (result.error) throw result.error;
    assert.equal(result.signal, null);
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.status };
  };
  try {
    for (const name of ["date", "sleep", "printenv"]) assert.match(native(name, ["--version"]).stdout, /GNU coreutils\) 9\.7/);
    for (const specimen of dateCases) {
      await context.test(`GNU date ${specimen.name}`, async () => {
        const expected = native("date", specimen.args, { TZ: "UTC", LC_ALL: "C", ...specimen.env });
        assert.equal(expected.exitCode, 0, expected.stderr);
        assert.equal(expected.stdout, specimen.stdout);
        const actual = await run("date", specimen.args, {}, { env: { ...specimen.env } });
        assert.equal(actual.exitCode, expected.exitCode); assert.equal(actual.stdout, expected.stdout); assert.equal(actual.stderr, expected.stderr);
      });
    }
    for (const args of [[], ["A"], ["EMPTY"], ["missing", "A"], ["A", "A"], ["--null", "A", "EMPTY"], ["-00", "A"], ["A", "-0"], ["A=value"], ["--", "-0"], ["__proto__", "constructor", "toString"]]) {
      await context.test(`GNU printenv ${JSON.stringify(args)}`, async () => {
        const env = Object.assign(Object.create(null) as Record<string, string>, { A: "雪\nvalue", EMPTY: "", constructor: "own constructor", toString: "own method" });
        env.__proto__ = "own prototype";
        const expected = native("printenv", args, env);
        const actual = await run("printenv", args, {}, { env });
        assert.equal(actual.exitCode, expected.exitCode); assert.equal(actual.stdout, expected.stdout); assert.equal(actual.stderr, expected.stderr);
      });
    }
    for (const args of [["0"], ["0d", "0h", "0m", "0s"], [".001"], ["1e-3"], [".00000001d"], [".0000001h"], [".00001m", ".0004s"], ["--", "0"], ["+0.001"], ["-0.00"], ["1ms"], ["-1"], ["NaN"], []]) {
      await context.test(`GNU sleep ${JSON.stringify(args)}`, async () => {
        const expected = native("sleep", args);
        const actual = await run("sleep", args);
        assert.equal(actual.exitCode, expected.exitCode); assert.equal(actual.stdout, expected.stdout);
        assert.equal(actual.stderr === "", expected.stderr === "");
      });
    }
    await context.test("GNU sleep help scans past duration operands without waiting", async () => {
      for (const args of [["--help", "0"], ["0", "--help"]]) {
        const expected = native("sleep", args);
        const actual = await run("sleep", args);
        assert.equal(expected.exitCode, 0); assert.equal(actual.exitCode, 0);
        assert.match(expected.stdout, /Usage:/); assert.match(actual.stdout, /Usage:/);
        assert.equal(expected.stderr, ""); assert.equal(actual.stderr, "");
      }
    });
    await context.test("GNU reference file uses observed metadata, including Node/Apple mtime quantization", async () => {
      const path = join(directory, "reference");
      await writeFile(path, "unchanged"); await utimes(path, new Date(1700000000123), new Date(1700000000123));
      const metadata = await stat(path);
      const precise = await stat(path, { bigint: true });
      const expected = native("date", ["-r", "reference", "+%s %N"]);
      assert.equal(expected.exitCode, 0);
      assert.equal(expected.stdout, `${precise.mtimeNs / 1000000000n} ${(precise.mtimeNs % 1000000000n).toString().padStart(9, "0")}\n`);
      const { fs } = await run("printenv", []);
      await fs.writeFile("/reference", Buffer.from("unchanged")); await fs.utimes!("/reference", metadata.atimeMs, metadata.mtimeMs);
      assert.equal((await run("date", ["-r", "reference", "+%s %N"], {}, { fs })).stdout, expected.stdout);
    });
  } finally { await rm(directory, { recursive: true }); }
});
