import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const basePath = resolve(here, "../approved-v9-9a5a6f92/native-env.mjs");
const rawPath = resolve(here, "../../du-v9-final-independent-20260827/lineage-overlay-0bd5a1f3/replay-once/run-2026-08-27T212245338Z-1682b6/native-environment-table.json");
const expectedDiagnostic = Buffer.from("du: invalid -B argument 'invalid-value'\n", "utf8");
const expectedDiagnosticSha256 = "927dbaaabbcd6f07c69e90d54e68af1d9f353275c4455837191ea77460d77009";
const emptySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const baseIdentity = {
  bytes: 6204,
  sha256: "e537055e0b7516e2a2ddcd520f5197625334d2493b1b238d82b99edc94fd7def",
  gitBlob: "894f6b7aae57e800d8e5eb603a9ea33cb665a38f",
};
const patchedIdentity = {
  bytes: 6212,
  sha256: "e7c62a3c7976163c684f68f63efd2a95f0b7ea43481a887a5bcd32832b35b9eb",
  gitBlob: "308191c598157e2aa0e7fbb652ccceef8064d236",
};
const rawIdentity = {
  bytes: 29253,
  sha256: "a699954c6daa495fb5bb2808d140c1b157ec91c0a6a00dbc2651b0920c068d34",
  gitBlob: "f7a72329f77d9d3c556a8bb22fabc6a906e05394",
};

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const gitBlob = bytes => createHash("sha1")
  .update(Buffer.from(`blob ${bytes.length}\0`))
  .update(bytes)
  .digest("hex");
const identity = bytes => ({ bytes: bytes.length, sha256: sha256(bytes), gitBlob: gitBlob(bytes) });
const occurrences = (text, needle) => text.split(needle).length - 1;

const oldExpression = "/invalid.*block|block.*invalid/iu.test(stderr)";
const newExpression = "stderr === \"du: invalid -B argument 'invalid-value'\\n\"";
const strictExpression = `!result.timedOut && !result.spawnError && result.status !== 0 && stdout === expectedStdout && ${newExpression}`;
const transform = bytes => {
  assert.deepEqual(identity(bytes), baseIdentity, "refuse a native-env.mjs other than immutable V9");
  const text = bytes.toString("utf8");
  assert.equal(occurrences(text, oldExpression), 1, "old predicate cardinality");
  assert.equal(occurrences(text, newExpression), 0, "new predicate must not preexist");
  const patched = Buffer.from(text.replace(oldExpression, newExpression), "utf8");
  assert.deepEqual(identity(patched), patchedIdentity, "one-expression patched identity");
  return patched;
};

const baseBytes = await readFile(basePath);
const patchedBytes = transform(baseBytes);
assert.equal(occurrences(patchedBytes.toString("utf8"), strictExpression), 1, "patched predicate cardinality");
const predicate = new Function(
  "result",
  "stdout",
  "expectedStdout",
  "stderr",
  `"use strict"; return (${strictExpression});`,
);

const rawBytes = await readFile(rawPath);
assert.deepEqual(identity(rawBytes), rawIdentity, "authenticated Raman raw table identity");
const raw = JSON.parse(rawBytes.toString("utf8"));
assert.deepEqual(raw.summary, { total: 16, matched: 13, mismatched: 3 }, "retain original native outcome");

const fixturePath = "/Users/kjopek/Workspace/safe-bash/tests/integration/du-v9-final-independent-20260827/lineage-overlay-0bd5a1f3/replay-once/work-PL0Rka/native/env-size-1500.bin";
const commonArgs = ["--apparent-size", "-B", "invalid-value", "--", fixturePath];
const commonEnv = { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C" };
const bindings = [
  {
    id: "du-block-size-explicit-invalid-strict",
    selected: "DU_BLOCK_SIZE",
    args: commonArgs,
    env: { ...commonEnv, DU_BLOCK_SIZE: "3072", BLOCK_SIZE: "512" },
  },
  {
    id: "block-size-explicit-invalid-strict",
    selected: "BLOCK_SIZE",
    args: commonArgs,
    env: { ...commonEnv, BLOCK_SIZE: "3072", BLOCKSIZE: "512" },
  },
  {
    id: "blocksize-explicit-invalid-strict",
    selected: "BLOCKSIZE",
    args: commonArgs,
    env: { ...commonEnv, BLOCKSIZE: "3072" },
  },
];

const triples = bindings.map(binding => {
  const record = raw.records.find(candidate => candidate.id === binding.id);
  assert.ok(record, `missing raw row ${binding.id}`);
  assert.deepEqual(
    { id: record.id, selected: record.selected, args: record.args, env: record.env },
    binding,
    `argv/env identity ${binding.id}`,
  );
  assert.deepEqual(record.expected, {
    statusClass: "failure",
    stdout: "",
    stderrClass: "invalid-block-size",
    filesystemCalls: 0,
  });
  assert.equal(record.expectedStdout, "");
  assert.deepEqual({
    status: record.observed.status,
    signal: record.observed.signal,
    stdout: record.observed.stdout,
    stdoutSha256: record.observed.stdoutSha256,
    stderrSha256: record.observed.stderrSha256,
    timedOut: record.observed.timedOut,
    spawnError: record.observed.spawnError ?? null,
  }, {
    status: 1,
    signal: null,
    stdout: "",
    stdoutSha256: emptySha256,
    stderrSha256: expectedDiagnosticSha256,
    timedOut: false,
    spawnError: null,
  });
  const diagnostic = Buffer.from(record.observed.stderr, "utf8");
  assert.deepEqual(diagnostic, expectedDiagnostic, `exact stderr bytes ${binding.id}`);
  assert.equal(diagnostic.length, 40);
  assert.equal(sha256(diagnostic), expectedDiagnosticSha256);
  return {
    id: binding.id,
    result: { timedOut: false, spawnError: null, status: record.observed.status },
    stdout: record.observed.stdout,
    expectedStdout: record.expectedStdout,
    stderr: record.observed.stderr,
  };
});
assert.equal(new Set(triples.map(triple => Buffer.from(triple.stderr).toString("hex"))).size, 1, "three rows share exact stderr bytes");

let passed = 0;
const accept = (name, triple) => {
  assert.equal(predicate(triple.result, triple.stdout, triple.expectedStdout, triple.stderr), true, name);
  passed += 1;
};
const reject = (name, triple) => {
  assert.equal(predicate(triple.result, triple.stdout, triple.expectedStdout, triple.stderr), false, name);
  passed += 1;
};
for (const triple of triples) accept(`positive:${triple.id}`, triple);

const exact = triples[0];
const mutate = changes => ({
  ...exact,
  ...changes,
  result: { ...exact.result, ...(changes.result ?? {}) },
});
reject("negative:wrong-status", mutate({ result: { status: 0 } }));
reject("negative:nonempty-stdout", mutate({ stdout: "x" }));
reject("negative:unrelated-diagnostic", mutate({ stderr: "du: invalid option -- '?'\n" }));
reject("negative:wrong-quoted-value", mutate({ stderr: "du: invalid -B argument 'other-value'\n" }));
reject("negative:wrong-argv0-prefix", mutate({ stderr: "gnu-du: invalid -B argument 'invalid-value'\n" }));
reject("negative:missing-lf", mutate({ stderr: "du: invalid -B argument 'invalid-value'" }));
reject("negative:extra-lf", mutate({ stderr: "du: invalid -B argument 'invalid-value'\n\n" }));
reject("negative:leading-whitespace", mutate({ stderr: " du: invalid -B argument 'invalid-value'\n" }));
reject("negative:timed-out", mutate({ result: { timedOut: true } }));
reject("negative:spawn-error", mutate({ result: { spawnError: "EACCES" } }));
assert.throws(() => transform(Buffer.concat([baseBytes, Buffer.from("\n")])), /refuse a native-env\.mjs/);
passed += 1;

const total = bindings.length + 11;
assert.equal(passed, total);
process.stdout.write(`${JSON.stringify({
  schema: 1,
  scope: "V9-native-strict-rejection-predicate-only",
  passed,
  total,
  positiveRawRows: bindings.map(binding => binding.id),
  negativeControls: total - bindings.length,
  diagnosticBytes: expectedDiagnostic.length,
  diagnosticSha256: expectedDiagnosticSha256,
  baseSha256: baseIdentity.sha256,
  patchedSha256: patchedIdentity.sha256,
  nativeOracleExecuted: false,
  fullRecipeExecuted: false,
})}\n`);
