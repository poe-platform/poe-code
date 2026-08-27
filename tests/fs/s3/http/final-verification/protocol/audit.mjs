import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../../../..");
assert.equal(process.cwd(), repository);
const names = process.argv.slice(2);
assert.ok(names.length >= 1 && names.every(name => /^2026-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/.test(name)));
const successful = join(owned, "evidence", names[0]);
const read = filename => JSON.parse(readFileSync(filename, "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = (root, prefix) => Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
  const path = join(prefix, entry.name);
  return entry.isDirectory() ? Object.entries(manifest(root, path)) : [[path, hash(readFileSync(join(root, path)))]];
}));
const initial = read(join(successful, "inputs.json"));
for (const [path, expected] of Object.entries(read(join(successful, "sha256.json")))) assert.equal(hash(readFileSync(join(owned, path))), expected, path);
for (const [path, expected] of Object.entries(initial.originalInputs)) assert.equal(hash(readFileSync(join(repository, path))), expected, path);
for (const [path, expected] of Object.entries(initial.profile.verificationInputs)) assert.equal(hash(readFileSync(join(owned, path))), expected, path);
const captures = ["fixed-prepare-details", "baseline-prepare-details", "fixed-validation-details"].flatMap(name => read(join(successful, name + ".json")).phases);
captures.push(...read(join(successful, "fixed-mutants-details.json")));
captures.push(...["fixed-neighbors", "neighbor-strict-types", "baseline-unchanged129"].map(name => read(join(successful, name + ".json"))));
for (const capture of captures) {
  assert.equal(capture.error, undefined);
  assert.ok(capture.signal === null || capture.signal === undefined);
  assert.doesNotMatch(capture.stdout + capture.stderr, /unhandledRejection|uncaughtException|testTimeoutFailure|asynchronous activity after the test/i);
}
const cleaned = [];
for (const name of names.slice(1)) {
  const directory = join(owned, "evidence", name);
  const failure = read(join(directory, "failure.json"));
  const temporary = failure.retainedTemporary;
  assert.equal(dirname(temporary), join(owned, ".tmp"));
  assert.match(temporary, /\/protocol-[A-Za-z0-9]+$/);
  if (!existsSync(temporary)) { cleaned.push({ directory: temporary, alreadyAbsent: true }); continue; }
  assert.equal(lstatSync(temporary).isSymbolicLink(), false);
  const setup = read(join(directory, "fixed-prepare-details.json"));
  assert.ok(setup.source.startsWith(temporary + "/"));
  const mutated = readdirSync(setup.directory).find(entry => entry.startsWith("mutation-source-"));
  assert.ok(mutated);
  assert.deepEqual(manifest(setup.source, "src"), setup.sourceHashes);
  assert.deepEqual(manifest(join(setup.directory, mutated), "src"), setup.sourceHashes);
  rmSync(temporary, { recursive: true });
  assert.equal(existsSync(temporary), false);
  cleaned.push({ directory: temporary, sourceAndMutantsRestoredBeforeCleanup: true, removed: true });
}
const oraclePath = "tests/fs/s3/http-independent/oracle-signature.mjs";
const { oracleSign, verifyOracleVectors } = await import(pathToFileURL(join(repository, oraclePath)).href);
const historical = read(join(repository, "tests/fs/s3/http-independent/evidence/curl-prefix-headers.json"));
const oracleChecks = historical.checks.map(request => {
  const names = /SignedHeaders=([^,]+)/.exec(request.headers.authorization)[1].split(";");
  const headers = Object.fromEntries(names.map(name => [name, request.headers[name]]));
  const signed = oracleSign({ method: request.method, path: request.url, headers, date: request.headers["x-amz-date"], credentials: { accessKeyId: "independent-s3-review", secretAccessKey: "independent-review-secret-fixture-only" }, includePayloadHeader: names.includes("x-amz-content-sha256") });
  return { names, expectedNames: [...names].sort(), validSignature: request.headers.authorization.endsWith("Signature=" + signed.signature) };
});
assert.deepEqual(oracleChecks.map(check => check.validSignature), [true, false]);
const productPaths = ["src/commands/network/curl.ts", "src/commands/network/transport.ts", "src/commands/network/args.ts", "src/fs/s3/http/signature.ts"];
const productHashes = Object.fromEntries(productPaths.map(path => [path, hash(execFileSync("git", ["show", `${initial.profile.baseline}:${path}`], { cwd: repository }))]));
const current = manifest(repository, "src");
const frozen = read(join(successful, "source-acceptance.json")).frozenSourceHashes;
const currentDifferences = Object.keys({ ...current, ...frozen }).sort().filter(path => current[path] !== frozen[path]).map(path => ({ path, current: current[path] ?? null, frozen: frozen[path] ?? null }));
const evidenceHashes = Object.fromEntries(names.flatMap(name => Object.entries(manifest(owned, join("evidence", name)))));
const result = {
  auditedAt: new Date().toISOString(), command: [process.execPath, relative(repository, fileURLToPath(import.meta.url)), ...names],
  auditorSha256: hash(readFileSync(fileURLToPath(import.meta.url))), originalInputsUnchanged: true,
  sourceSnapshots: { start: initial.profile.currentSources, finish: current, frozen, currentDifferences, httpMatches: currentDifferences.every(row => !row.path.startsWith("src/fs/s3/http/")) },
  childOutputAudit: { phaseCount: captures.length, processTimeouts: 0, unhandledRejections: 0, asynchronousTestWarnings: 0 },
  cleanup: { completedRun: read(join(successful, "summary.json")).cleanup, earlierAttempts: cleaned, remainingOwnedTemporary: readdirSync(join(owned, ".tmp")) },
  nativeCurlOracle: { historicalOnlyNoNativeOrServiceExecution: true, curl: historical.curl, binarySha256: historical.binarySha256, fixtureSha256: hash(readFileSync(join(repository, "tests/fs/s3/http-independent/evidence/curl-prefix-headers.json"))), signerSha256: initial.originalInputs[oraclePath], vectors: verifyOracleVectors(), checks: oracleChecks, productBaselineHashes: productHashes, attribution: "The preserved fixture explicitly spawned /usr/bin/curl with --aws-sigv4. Product createCurlCommand uses injected HttpTransport or createNodeHttpTransport (node:http/node:https), not that native binary. Recomputed historical signatures confirm the paired-header native oracle defect; not a new product curl defect or a service enforcement result." },
  activeOwnedChildren: 0, externalServiceExecutions: 0, evidenceHashes,
};
const destination = join(owned, "evidence", `audit-${Date.now()}.json`);
assert.equal(existsSync(destination), false);
const content = JSON.stringify(result, null, 2);
execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${destination}\n${content.split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`, maxBuffer: 32 * 1024 * 1024 });
console.log(JSON.stringify({ destination, cleaned, sourceDifferences: currentDifferences.length, httpMatches: result.sourceSnapshots.httpMatches, phaseCount: captures.length, oracleValidSignatures: oracleChecks.map(check => check.validSignature), remainingOwnedTemporary: result.cleanup.remainingOwnedTemporary }, null, 2));
