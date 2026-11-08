import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

const suite = fileURLToPath(new URL("./native.test.ts", import.meta.url));
const fixtureHash = createHash("sha256").update("in-memory oracle fixture").digest("hex");
const missingPrerequisite = "native dd prerequisite absent: set DD_ORACLE and DD_ORACLE_SHA256";

function execute(env: Readonly<Record<string, string>> = {}, version?: string) {
  const childEnvironment = { ...process.env };
  delete childEnvironment.DD_ORACLE;
  delete childEnvironment.DD_ORACLE_SHA256;
  delete childEnvironment.NODE_TEST_CONTEXT;
  const preload = version === undefined ? [] : ["--import", `data:text/javascript,${encodeURIComponent(`
    import fs from "node:fs";
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const originalStat = fs.lstatSync;
    const originalStream = fs.createReadStream;
    const originalExists = fs.existsSync;
    const originalSpawn = childProcess.spawnSync;
    fs.lstatSync = (path, ...args) => path === "/virtual/dd-oracle"
      ? { isFile: () => true, size: 24 } : originalStat(path, ...args);
    fs.createReadStream = (path, ...args) => path === "/virtual/dd-oracle"
      ? { async *[Symbol.asyncIterator]() { yield Buffer.from("in-memory oracle fixture"); } }
      : originalStream(path, ...args);
    fs.existsSync = path => path === "/virtual/dd-oracle" || originalExists(path);
    childProcess.spawnSync = (path, args, options) => {
      if (path !== "/virtual/dd-oracle") return originalSpawn(path, args, options);
      if (args.length !== 1 || args[0] !== "--version") throw new Error("unqualified oracle executed comparisons");
      return { status: 0, signal: null, stdout: Buffer.from(${JSON.stringify(version)}), stderr: Buffer.alloc(0) };
    };
    syncBuiltinESMExports();
  `)}`];
  const result = spawnSync(process.execPath, ["--import", "tsx", ...preload, "--test", "--test-reporter=tap", suite], {
    env: { ...childEnvironment, ...env }, timeout: 5000, maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null);
  return { status: result.status, text: result.stdout.toString() + result.stderr.toString() };
}

test("absent native prerequisites produce named skips, never an implicit oracle run", () => {
  const result = execute();
  assert.equal(result.status, 0, result.text);
  assert.ok(result.text.includes(`# SKIP ${missingPrerequisite}`), result.text);
  assert.ok(result.text.includes("# pass 0\n"), result.text);
  assert.ok(result.text.includes("# skipped 5\n"), result.text);
});

test("explicit missing or malformed native prerequisites fail instead of skipping", () => {
  for (const [env, diagnostic] of [
    [{ DD_ORACLE: "/virtual/missing-dd-oracle", DD_ORACLE_SHA256: fixtureHash }, "ENOENT"],
    [{ DD_ORACLE: "", DD_ORACLE_SHA256: fixtureHash }, "DD_ORACLE must be a nonempty absolute path"],
    [{ DD_ORACLE: "dd", DD_ORACLE_SHA256: fixtureHash }, "DD_ORACLE must be a nonempty absolute path"],
    [{ DD_ORACLE: "/virtual/dd-oracle" }, "DD_ORACLE_SHA256 must contain 64 hexadecimal digits"],
    [{ DD_ORACLE: "/virtual/dd-oracle", DD_ORACLE_SHA256: "invalid" }, "DD_ORACLE_SHA256 must contain 64 hexadecimal digits"],
    [{ DD_ORACLE_SHA256: fixtureHash }, "DD_ORACLE must be a nonempty absolute path"],
  ] as const) {
    const result = execute(env);
    assert.notEqual(result.status, 0, result.text);
    assert.ok(result.text.includes("# skipped 0\n"), result.text);
    assert.ok(result.text.includes(diagnostic), result.text);
  }
});

test("supplied hash mismatch fails before executing the oracle", () => {
  const result = execute({ DD_ORACLE: "/virtual/dd-oracle", DD_ORACLE_SHA256: "0".repeat(64) }, "dd (coreutils) 9.7\n");
  assert.notEqual(result.status, 0, result.text);
  assert.ok(result.text.includes("# skipped 0\n"), result.text);
  assert.ok(result.text.includes("DD_ORACLE_SHA256 does not match the supplied executable"), result.text);
  assert.ok(!result.text.includes("unqualified oracle executed comparisons"), result.text);
});

test("authenticated bytes with the wrong version fail rather than skip", () => {
  const result = execute({ DD_ORACLE: "/virtual/dd-oracle", DD_ORACLE_SHA256: fixtureHash }, "dd (coreutils) 9.6\n");
  assert.notEqual(result.status, 0, result.text);
  assert.ok(result.text.includes("# skipped 0\n"), result.text);
  assert.ok(result.text.includes("DD_ORACLE must report GNU coreutils 9.7"), result.text);
});
