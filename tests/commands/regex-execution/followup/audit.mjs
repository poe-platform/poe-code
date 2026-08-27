import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const base = fileURLToPath(new URL("./", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root });
const sourceCommit = "c467e8a7bdd78048985f97539bc76e38ff786b09";
const expectationCommit = "beaeeeaaaadc57729ccdb6ff9f51c1e38c393c9f";
const priorEvidenceCommit = "35249954c1994940a8a89bad295ab34e4285bbee";
const sourcePaths = ["src/commands/regex-execution/client.ts", "src/commands/regex-execution/README.md", "src/commands/regex-execution/worker.ts", "src/commands/regex-execution/protocol.ts", "src/commands/regex-execution/matching.ts", "src/commands/grep.ts", "src/commands/search/rg.ts", "src/commands/search/matcher.ts", "src/commands/search/glob.ts", "src/commands/search/walk.ts", "src/shell/runtime.ts", "src/shell/shell.ts", "src/contracts/command.ts", "src/contracts/plugin.ts", "src/plugins/index.ts", "src/commands/index.ts", "src/index.ts", "package.json"];
const sources = Object.fromEntries(sourcePaths.map(path => {
  const sha256 = hash(readFileSync(root + path));
  assert.equal(sha256, hash(git("show", `${sourceCommit}:${path}`)), path);
  return [path, sha256];
}));
const frozenTest = "tests/commands/regex-execution/followup/messageerror.test.ts";
assert.equal(hash(readFileSync(root + frozenTest)), hash(git("show", `${expectationCommit}:${frozenTest}`)));
assert.deepEqual(readFileSync(base + "prior-author-ready.txt"), readFileSync("/tmp/regex-production-author-ready.txt"));
const priorAuthor = git("ls-tree", "-r", "--name-only", priorEvidenceCommit, "tests/commands/regex-execution").toString().trim().split("\n");
for (const path of priorAuthor) assert.equal(hash(readFileSync(root + path)), hash(git("show", `${priorEvidenceCommit}:${path}`)), path);
const baseline = JSON.parse(readFileSync(root + "tests/stress/regex-execution/production-review/evidence/baseline-freeze.json"));
for (const entry of baseline.historical) assert.equal(hash(readFileSync(root + entry.path)), entry.sha256, entry.path);
const evidenceFiles = Object.fromEntries(readdirSync(base).filter(name => /\.(json|txt|ts|mts|mjs|md)$/u.test(name)).map(name => [name, hash(readFileSync(base + name))]));
const packageEvidence = JSON.parse(readFileSync(base + "package-evidence.json"));
assert.equal(hash(readFileSync(packageEvidence.archive.path)), packageEvidence.archive.sha256);
for (const [path, expected] of Object.entries(packageEvidence.assets)) assert.equal(hash(readFileSync(root + path)), expected, path);
const emittedF1 = Object.fromEntries(["shell/runtime", "shell/shell", "contracts/command", "contracts/plugin", "plugins/index", "commands/grep", "commands/index"].map(name => {
  const path = `dist/${name}.js`;
  const sha256 = hash(readFileSync(root + path));
  assert.equal(sha256, hash(readFileSync(base + `artifacts/product/moved/node_modules/virtual-bash/${path}`)));
  return [path, sha256];
}));
const audit = { sourceCommit, expectationCommit, priorEvidenceCommit, date: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, sources, emittedF1, emittedWorkerAssets: packageEvidence.assets, evidenceFiles, originalAuthorFilesPreserved: priorAuthor.length, historicalArtifactsPreserved: baseline.historical.length, archiveSha256: packageEvidence.archive.sha256, followupPathologicalProbes: 0, f1StillBlocked: true, acceptance: false };
writeFileSync(base + "audit.json", JSON.stringify(audit, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ originalAuthorFilesPreserved: priorAuthor.length, historicalArtifactsPreserved: baseline.historical.length, sourceCommit, clientSha256: sources[sourcePaths[0]], f1StillBlocked: true }));
