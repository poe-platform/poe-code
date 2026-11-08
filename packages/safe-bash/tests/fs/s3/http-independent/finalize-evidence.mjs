import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { join, resolve } from "node:path";

const [baseline, initial, final] = process.argv.slice(2).map(value => resolve(value));
const read = (directory, file) => JSON.parse(readFileSync(join(directory, file), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const setup = read(final, "prepare.json");
assert.equal(setup.overlay, "f65038e0d3e62b7fe4c05b47c1ab9d3ee364abbb");
const evidence = {
  "baseline-prepare.json": read(baseline, "prepare.json"),
  "official-download.json": read(baseline, "download.json"),
  "baseline-protocol37.json": read(baseline, "protocol-original.json"),
  "baseline-protocol38.json": read(baseline, "protocol-baseline38.json"),
  "baseline-lifecycle22.json": read(baseline, "lifecycle-original.json"),
  "baseline-author-service.json": read(baseline, "author-service-replay.json"),
  "initial-fixed-validation.json": read(baseline, "fixed-validation.json"),
  "initial-public-prepare.json": read(initial, "prepare.json"),
  "initial-public-types.json": read(initial, "public-types.json"),
  "initial-public-service.json": read(initial, "independent-minio/report.json"),
  "curl-prefix-headers.json": read(initial, "curl-prefix-headers.json"),
  "final-prepare.json": setup,
  "final-validation.json": read(final, "validation.json"),
  "final-author-service.json": read(final, "author-service-replay.json"),
  "final-public-service.json": read(final, "independent-minio/report.json"),
  "mutants-initial-selector-error.json": read(final, "mutants-initial-selector-error.json"),
  "mutants.json": read(final, "mutants.json"),
};
const authorInputs = {};
const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", setup.revision, "tests/fs/s3/http"], { encoding: "utf8" }).trim().split("\n");
for (const path of paths) {
  const frozen = execFileSync("git", ["show", `${setup.revision}:${path}`]);
  for (const directory of [baseline, final]) assert.equal(sha(readFileSync(join(directory, "source", path))), sha(frozen), path);
  authorInputs[path] = sha(frozen);
}
for (const [path, expected] of Object.entries(setup.sourceHashes)) assert.equal(sha(readFileSync(join(setup.source, path))), expected, path);
const ownedInputs = {};
for (const name of readdirSync("tests/fs/s3/http-independent")) {
  if (!/\.(?:ts|mts|mjs)$/.test(name)) continue;
  const path = "tests/fs/s3/http-independent/" + name;
  ownedInputs[path] = sha(readFileSync(path));
}
const initialInputs = {};
for (const name of ["public-workflow.mts", "minio-service.mjs"]) {
  const path = join(initial, "source/tests/fs/s3/http-independent", name), bytes = readFileSync(path);
  initialInputs[name] = { sha256: sha(bytes), text: bytes.toString() };
}
evidence["initial-harness-inputs.json"] = initialInputs;
const services = [];
for (const cohort of ["baseline-author-service.json", "final-author-service.json"]) {
  for (const result of evidence[cohort].results) {
    const launch = result.evidence["launch.json"], shutdown = result.evidence["shutdown.json"];
    services.push({ cohort, suite: result.suite, pid: launch.pid, shutdown, data: launch.args.at(-1), home: launch.environment.HOME });
  }
}
for (const cohort of ["initial-public-service.json", "final-public-service.json"]) {
  const report = evidence[cohort]; services.push({ cohort, pid: report.launch.pid, shutdown: report.shutdown, data: report.launch.args.at(-1), home: report.launch.environment.HOME });
}
for (const service of services) {
  try { process.kill(service.pid, 0); service.pidAbsent = false; } catch (error) { assert.equal(error.code, "ESRCH"); service.pidAbsent = true; }
  service.dataAbsent = !existsSync(service.data); service.homeAbsent = !existsSync(service.home);
  assert.ok(service.pidAbsent && service.dataAbsent && service.homeAbsent, JSON.stringify(service));
}
const binary = join(baseline, "minio");
assert.equal(sha(readFileSync(binary)), setup.serviceLock.sha256);
unlinkSync(binary);
evidence["freeze-and-cleanup.json"] = { capturedAt: new Date().toISOString(), host: { platform: platform(), arch: arch(), release: release(), node: process.version }, baselineRevision: setup.revision, httpOverlayRevision: setup.overlay,
  liveHeadAtAudit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), authorInputs, ownedInputs, services,
  binary: { path: binary, sha256: setup.serviceLock.sha256, removed: !existsSync(binary) },
  workingHttpMatchesOverlay: execFileSync("git", ["diff", setup.overlay, "--", "src/fs/s3/http"], { encoding: "utf8" }) === "",
  scope: "Full source baseline plus HTTP-only committed overlay, not a current whole-repository gate; only owned service data/home and downloaded binary removed." };
for (const [name, value] of Object.entries(evidence)) {
  const filename = "tests/fs/s3/http-independent/evidence/" + name;
  const bytes = JSON.stringify(value, null, 2) + "\n";
  execFileSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${filename}\n${bytes.trimEnd().split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
}
console.log(JSON.stringify({ evidence: Object.keys(evidence), stoppedServices: services.length, binaryRemoved: !existsSync(binary) }, null, 2));
