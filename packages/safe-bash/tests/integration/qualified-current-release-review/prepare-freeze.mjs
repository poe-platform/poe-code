import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = "/Users/kjopek/Workspace/safe-bash";
const owner = "tests/integration/qualified-current-release-review";
const source = "90c1a3cb04a6a01e456544cbac747b327a8dfb1d";
const original = "0c8cf157971e8e8e6aa8bb0e70f97240c41bc609";
const git = (...args) => execFileSync("/usr/bin/git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(git("rev-parse", "--show-toplevel").toString().trim(), root);
const entries = revision => git("ls-tree", "-r", "-z", revision, "tests", "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "tsconfig.consumers.json").toString().split("\0").filter(Boolean).map(record => {
  const [metadata, path] = record.split("\t");
  const [mode, type, blob] = metadata.split(" ");
  return { path, mode, type, blob };
});
const identify = entry => {
  const bytes = git("cat-file", "blob", entry.blob);
  return { ...entry, bytes: bytes.length, sha256: sha256(bytes) };
};
const maintained = {
  "tests/commands/regex-execution/continuation/package-consumer.mts": "local top-level regex consumer",
  "tests/commands/regex-execution/followup/product-consumer.mts": "local top-level regex consumer",
  "tests/commands/regex-execution/package-consumer.mts": "local top-level regex consumer",
  "tests/fs/s3/constructor-comparison/consumer.mts": "local node:test memory/SDK alias consumer",
  "tests/fs/s3/http-independent/public-workflow.mts": "exported HTTP workflow; invoke only with explicit legitimate endpoint and credentials",
  "tests/fs/s3/http/author/public-consumer.mts": "exported HTTP workflow; import is not workflow execution",
  "tests/fs/s3/rmdir-independent/public-consumer.mts": "public optional-rmdir API compile probe; inspect before claiming runtime",
  "tests/fs/webdav/consumer/consumer.test.mts": "local node:test serialized loopback HTTP consumer; must run",
  "tests/fs/webdav/consumer/example.mts": "application helper executed by local consumer",
  "tests/fs/webdav/consumer/provider.mts": "local serialized backing provider executed by local consumer",
  "tests/fs/webdav/consumer/types.mts": "strict public type assertions; no runtime workflow",
  "tests/fs/webdav/real-service-independent/independent.mts": "strict with unchanged real-service example/https siblings; runtime needs actual configured provider",
  "tests/fs/webdav/real-service-independent/scope-neighbors.mts": "strict with unchanged real-service example/https siblings; runtime needs actual configured provider",
  "tests/fs/webdav/real-service/consumer.mts": "strict provider consumer; runtime needs actual configuration and certificate",
  "tests/fs/webdav/real-service/example.mts": "strict optional provider application API; runtime needs explicit configuration",
  "tests/fs/webdav/real-service/https.mts": "strict provider HTTPS helper; no standalone workflow",
  "tests/fs/webdav/real-service/phase2-consumer.mts": "strict provider consumer; runtime needs actual configured provider",
  "tests/fs/webdav/rmdir-real-service/feasibility.mts": "strict with unchanged real-service siblings; provider feasibility outcomes not assumed passes",
  "tests/integration/stream-inspection-public-author/consumer.mts": "local current public stream consumer; inspect for historical command-count assumptions",
  "tests/plugins/stream-five-fixture-migration/public-options.mts": "local public 65-tool options consumer",
  "tests/stress/regex-execution/production-continuation-review/package-consumer.mts": "local top-level regex consumer",
  "tests/stress/regex-execution/production-review/package-consumer.mts": "local top-level regex consumer"
};
const originalEntries = entries(original).filter(entry => entry.path.endsWith(".mts") && !entry.path.endsWith(".d.mts"));
assert.equal(originalEntries.length, 30);
const originalPaths = new Set(originalEntries.map(entry => entry.path));
const currentEntries = entries(source);
const standalone = currentEntries.filter(entry => entry.path.endsWith(".mts") && !entry.path.endsWith(".d.mts")).map(entry => {
  const intention = maintained[entry.path];
  assert.ok(intention || entry.path.includes("/evidence/") || entry.path.includes("/scope-fix-evidence/"), `unclassified standalone: ${entry.path}`);
  return { ...identify(entry), original30: originalPaths.has(entry.path), disposition: intention ? "maintained-strict-compile" : "retained-historical-evidence-copy", runtimeIntention: intention ?? "not current runtime evidence; retained attempt/provider input, never counted as a pass", provenance: intention ? "inspected standalone and existing harness imports" : entry.path.slice(0, entry.path.lastIndexOf("/")) };
});
for (const path of Object.keys(maintained)) assert.ok(standalone.some(entry => entry.path === path), path);
const supportPaths = [
  "tests/commands/archive/native.test.ts", "tests/commands/archive/helpers.ts",
  "tests/commands/archive-stress/pax-independent/controls.test.ts", "tests/commands/archive-stress/pax-independent/fixtures.ts",
  "tests/commands/archive-stress/native-prerequisite-review/runner.mjs",
  "tests/commands/metadata-stress/canonical-env/runner.mjs",
  "tests/commands/stream-next-stress/frozen/manifest.json", "tests/commands/stream-next-stress/frozen/native.json",
  "tests/commands/stream-next-stress/independent.review.ts", "tests/commands/stream-next-stress/strong-diagnostics.mjs",
  "tests/plugins/stream-five-public/current-profile.mjs", "tests/plugins/stream-five-public/harness.mjs", "tests/plugins/stream-five-public/public-checks.mjs",
  "tests/integration/full-gate-20260827/cold-typecheck-independent/README.md",
  "tests/fs/webdav/real-service-independent/run.mjs", "tests/fs/webdav/rmdir-real-service/run.mjs"
];
for (const path of supportPaths) assert.ok(currentEntries.some(entry => entry.path === path), path);
const report = {
  schema: 1,
  preparationSource: source,
  preparationTree: git("rev-parse", `${source}^{tree}`).toString().trim(),
  original30Source: original,
  finalCandidate: null,
  original30: originalEntries.map(identify),
  standalone,
  declarations: currentEntries.filter(entry => entry.path.endsWith(".d.mts")).map(identify),
  sourceAndSupport: currentEntries.filter(entry => entry.path.startsWith("src/") || supportPaths.includes(entry.path) || !entry.path.includes("/")).map(identify),
  controlDocumentSha256: sha256(readFileSync(`${root}/${owner}/FREEZE.md`)),
  preparationHarnessSha256: sha256(readFileSync(`${root}/${owner}/prepare-freeze.mjs`)),
  counts: { originalStandalone: originalEntries.length, standalone: standalone.length, maintained: Object.keys(maintained).length, historicalCopies: standalone.length - Object.keys(maintained).length },
  inspectionFaults: ["An initial read-only git ls-tree census exceeded Node default maxBuffer (ENOBUFS); repeated read-only with explicit 64MiB limit.", "A zsh read-only loop used reserved path variable, shadowing PATH; retried in Node without persistent environment changes."],
  execution: "No product, native oracle, build, pack, consumer or mandatory gate executed."
};
process.stdout.write(`*** Begin Patch\n*** Add File: ${owner}/inputs.json\n${JSON.stringify(report, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`);
