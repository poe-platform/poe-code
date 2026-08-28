import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../../..");
const owner = "tests/integration/expr-public-independent-20260827";
const author = "tests/plugins/expr-public-author";
const refs = {
  freeze: "f8b982f09e51b9a0a073b0b7bb393cb54796dd62",
  source: "a1c95fc52ddeef2d753950b09dd2a26b44b4ab6e",
  candidate: "44f00bf84278e3361b52106478d59c707ab7b2bc",
  author: "8d07bd6e7549aaa9a1096c3e9278b231692bc699",
  selectedDU75: "0895de2dc63014989f23912c3d48f7c4d0d35a47",
  engine: "c3e40f8bd721da5e496f3b3abfd51aee45db5a84",
};
const gitExecutable = realpathSync("/usr/bin/git");
const git = (...args) => execFileSync(gitExecutable, ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const blob = (ref, path) => git("show", `${ref}:${path}`);
const bind = (ref, path) => {
  const bytes = blob(ref, path);
  return { path, commit: ref, gitBlob: git("rev-parse", `${ref}:${path}`).toString().trim(), bytes: bytes.length, sha256: digest(bytes) };
};
const sorted = values => [...values].sort();
assert.equal(git("rev-parse", "--show-toplevel").toString().trim(), repository);
const indexBefore = git("ls-files", "--stage", "-z");
const statusBefore = git("status", "--short", "--untracked-files=normal").toString();
const objects = Object.fromEntries(Object.entries(refs).map(([name, ref]) => {
  assert.equal(git("rev-parse", `${ref}^{commit}`).toString().trim(), ref);
  return [name, { commit: ref, tree: git("rev-parse", `${ref}^{tree}`).toString().trim(), dates: git("show", "-s", "--format=%aI%n%cI", ref).toString().trim().split("\n") }];
}));
const fixtureNames = ["cases.json", "consumer.mjs", "positive.ts.fixture", "negative.ts.fixture", "README.md", "PROTOCOL.md", "self-check.mjs", "provenance.json", "FREEZE-CHECKS.json"];
assert.deepEqual(sorted(git("ls-tree", "--name-only", `${refs.freeze}:${owner}`).toString().trim().split("\n")), sorted(fixtureNames));
const fixtures = fixtureNames.map(name => {
  const path = `${owner}/${name}`;
  const binding = bind(refs.freeze, path);
  assert.equal(digest(readFileSync(resolve(repository, path))), binding.sha256, path);
  return binding;
});
const cases = JSON.parse(blob(refs.freeze, `${owner}/cases.json`));
const handoffPath = `${author}/evidence-v1/REVIEW-HANDOFF.json`;
const handoff = JSON.parse(blob(refs.author, handoffPath));
assert.equal(handoff.candidateCommit, refs.candidate);
assert.equal(handoff.candidateTree, objects.candidate.tree);
assert.equal(handoff.integrationSourceCommit, refs.source);
assert.equal(handoff.independentFreeze, refs.freeze);
assert.equal(handoff.baselineDU75, refs.selectedDU75);
assert.equal(handoff.acceptedEngineCommit, refs.engine);
assert.deepEqual(sorted(handoff.declared76Inventory.baseline75Names), sorted(cases.baselineNames));
assert.deepEqual(sorted(handoff.declared76Inventory.names), sorted([...cases.baselineNames, "expr"]));
assert.equal(new Set(handoff.declared76Inventory.names).size, 76);
assert.deepEqual(cases.runtimeCases.map(fixture => fixture.id), Array.from({ length: 26 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`));
const observerBindings = [...handoff.observerBindings, handoff.sourcePathsAndPolicy].map(expected => {
  const actual = bind(refs.author, expected.path);
  assert.equal(actual.sha256, expected.sha256);
  return actual;
});
const selected = ["src", "scripts", "package.json", "package-lock.json", "README.md", "tsconfig.json", "tsconfig.build.json", author,
  "tests/plugins/agent-commands.test.ts", "tests/plugins/stream-five-fixture-migration", "tests/plugins/du-public-author/lifecycle.test.ts", "tests/commands/du/helpers.ts",
  "tests/plugins/html-to-markdown-public-author/lifecycle.test.ts", "tests/commands/html-to-markdown/helpers.ts", "tests/plugins/qualified-current-release", "tests/plugins/stream-five-public", "tests/integration/stream-inspection-public-author/consumer.mts"];
const selectedTree = git("ls-tree", "-rz", refs.candidate, "--", ...selected).toString().split("\0").filter(Boolean).map(line => {
  const [metadata, path] = line.split("\t");
  const [mode, type, gitBlob] = metadata.split(" ");
  return { path, mode, type, gitBlob, sha256: digest(blob(refs.candidate, path)) };
});
assert.deepEqual(selectedTree, handoff.sourceInventory);
const engineBindings = handoff.engineBindings.map(expected => {
  const actual = bind(refs.candidate, expected.path);
  assert.equal(actual.sha256, expected.sha256);
  assert.equal(actual.gitBlob, expected.gitBlob);
  assert.equal(digest(blob(refs.engine, expected.path)), expected.sha256);
  return actual;
});
const publicPaths = ["src/index.ts", "src/plugins/index.ts", "package.json"];
const publicBindings = publicPaths.map(path => {
  assert.equal(digest(blob(refs.source, path)), digest(blob(refs.candidate, path)));
  return bind(refs.candidate, path);
});
const tarball = readFileSync(handoff.package.authorTarballLocation);
assert.equal(digest(tarball), "c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd");
assert.equal(digest(tarball), handoff.package.tarballSha256);
const tar = gunzipSync(tarball, { maxOutputLength: 64 * 1024 * 1024 });
const members = new Map();
const text = (header, start, end) => header.toString("utf8", start, end).replace(/\0.*$/u, "");
let offset = 0;
while (offset + 512 <= tar.length) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every(byte => byte === 0)) break;
  const checksum = [...header].reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0);
  assert.equal(checksum, Number.parseInt(text(header, 148, 156).trim(), 8));
  assert.equal(text(header, 156, 157), "0", "only the observed regular-file tar profile is admitted");
  const prefix = text(header, 345, 500);
  const path = `${prefix ? `${prefix}/` : ""}${text(header, 0, 100)}`;
  assert.ok(path.startsWith("package/") && !path.split("/").includes(".."));
  assert.ok(!members.has(path.slice(8)), `duplicate member: ${path}`);
  const size = Number.parseInt(text(header, 124, 136).trim(), 8);
  assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
  members.set(path.slice(8), tar.subarray(offset + 512, offset + 512 + size));
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.ok(tar.subarray(offset).length >= 1024 && tar.subarray(offset).every(byte => byte === 0));
assert.deepEqual(sorted(members.keys()), sorted(Object.keys(handoff.packageFiles)));
for (const [path, bytes] of members) assert.equal(digest(bytes), handoff.packageFiles[path], path);
const metadata = JSON.parse(members.get("package.json"));
assert.equal(digest(members.get("package.json")), handoff.package.metadataSha256);
assert.equal(digest(members.get("package.json")), digest(blob(refs.candidate, "package.json")));
assert.equal(metadata.name, "virtual-bash");
assert.deepEqual(metadata.dependencies ?? {}, {});
assert.deepEqual(metadata.exports["./commands/expr"], { types: "./dist/commands/expr/index.d.ts", import: "./dist/commands/expr/index.js" });
const manifestPath = `${author}/evidence-v1/MANIFEST.json`;
const rawPath = `${author}/evidence-v1/RAW.json.gz.base64`;
const manifest = JSON.parse(blob(refs.author, manifestPath));
const compressed = Buffer.from(blob(refs.author, rawPath).toString().trim(), "base64");
assert.equal(digest(compressed), manifest.compressedSha256);
const payload = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
assert.equal(payload.length, manifest.payloadBytes);
assert.equal(digest(payload), manifest.payloadSha256);
const authorReportEntry = JSON.parse(payload).entries.find(entry => entry.name === "final/REPORT.json");
const authorReportBytes = Buffer.from(authorReportEntry.base64, "base64");
const reportManifestEntry = manifest.entries.find(entry => entry.name === authorReportEntry.name);
assert.equal(digest(authorReportBytes), reportManifestEntry.sha256);
assert.equal(authorReportBytes.length, reportManifestEntry.bytes);
const authorReport = JSON.parse(authorReportBytes);
assert.equal(authorReport.candidate, refs.candidate);
assert.equal(authorReport.tree, objects.candidate.tree);
const candidateArchive = readFileSync(resolve(authorReport.directory, "candidate.tar"));
assert.equal(digest(candidateArchive), authorReport.archiveSha256);
const runtimeTools = handoff.runtimeIdentities.map(expected => {
  const executable = realpathSync(expected.executable);
  const sha256 = digest(readFileSync(executable));
  assert.equal(sha256, expected.sha256);
  return { ...expected, executable, observedSha256: sha256, productExecuted: false };
});
const ancestry = [["freeze", "source"], ["source", "candidate"], ["candidate", "author"], ["selectedDU75", "candidate"]].map(([ancestor, descendant]) => {
  git("merge-base", "--is-ancestor", refs[ancestor], refs[descendant]);
  return { ancestor: refs[ancestor], descendant: refs[descendant], isAncestor: true };
});
for (const fixture of fixtures) assert.equal(digest(readFileSync(resolve(repository, fixture.path))), fixture.sha256);
assert.deepEqual(git("ls-files", "--stage", "-z"), indexBefore, "index changed during read-only inspection");
const receipt = {
  schema: "expr-public-component-admission-v1",
  capturedAt: new Date().toISOString(),
  authorizationDateLabel: "2026-08-28; supplied instruction date, not a rewrite of fixture chronology",
  status: "ADDENDUM_CHECKPOINT_NO_CANDIDATE_EXECUTION",
  scope: "Read-only immutable Git/artifact authentication; no rebuild, install, product import, runtime, types, workers, native oracle or gate",
  objects, ancestry, fixtures,
  handoff: bind(refs.author, handoffPath),
  selectedSourceInventory: { count: selectedTree.length, selection: selected, exactGitTreeMatchesHandoff: true, sha256: digest(Buffer.from(JSON.stringify(selectedTree))), qualification: "Complete immutable selected Git tree, including names; not all repository tests or a canonical/full gate" },
  engineBindings, publicBindings, observerBindings,
  artifact: { location: handoff.package.authorTarballLocation, bytes: tarball.length, sha256: digest(tarball), regularFileCount: members.size, allMemberNamesAndHashesMatch: true, memberInventorySha256: digest(Buffer.from(JSON.stringify(handoff.packageFiles))), rootExport: metadata.exports["."], exprExport: metadata.exports["./commands/expr"], runtimeDependencies: metadata.dependencies ?? {}, provenance: "Actual tarball bytes independently authenticated; source-to-pack build derivation remains author evidence, not an independent rebuild" },
  authorArchive: { location: resolve(authorReport.directory, "candidate.tar"), bytes: candidateArchive.length, sha256: digest(candidateArchive), qualification: "Read-only author archive hash; no extraction/materializer/build duplicated" },
  authorRawBinding: { manifest: bind(refs.author, manifestPath), raw: bind(refs.author, rawPath), payloadSha256: digest(payload), reportSha256: digest(authorReportBytes), use: "Observer generator provenance only; author runtime results are not independent passes" },
  generatedAuthorGuards: authorReport.guards.map(({ phase, mainSha256, workerSha256, qualification }) => ({ phase, mainSha256, workerSha256, qualification })),
  runtimeTools,
  inspectionTools: [{ executable: realpathSync(process.execPath), version: process.version, sha256: digest(readFileSync(process.execPath)) }, { executable: gitExecutable, version: git("--version").toString().trim(), sha256: digest(readFileSync(gitExecutable)) }],
  checkpointFiles: ["ADDENDUM.md", "inspect.mjs"].map(name => ({ path: `${owner}/component-admission-v1/${name}`, sha256: digest(readFileSync(resolve(directory, name))) })),
  membership: { exactFrozen75MatchesDeclaredBase: true, exactDeclared76EqualsFrozen75PlusExpr: true, acceptanceImplied: false, names: handoff.declared76Inventory.names },
  holds: ["accepted DU75 prerequisite", "HTML admission", "actual HTML34", "original acceptance-gated consumer", "independent P01 build reproduction", "independent observer/control qualification", "R25 EXEC-ONLY settlement", "R26 both boundaries and sibling isolation", "whole76/public acceptance"],
  outcomes: { productRuntimeExecuted: 0, productTypeChecksExecuted: 0, productBuilds: 0, productInstalls: 0, productWorkers: 0, nativeOracles: 0, runtimeCaseIds: 26, consumerBackedIds: 24, lifecycleProtocolIds: 2, packageProtocolIds: 8, independentPasses: 0 },
  worktree: { statusBefore, indexSha256Before: digest(indexBefore), indexSha256After: digest(git("ls-files", "--stage", "-z")), originalNineMatchBeforeAndAfter: true, scopeQualification: "No original-fixture additions check claimed for live tree; new owned addendum paths are intentional. Future execution requires full input-tree addition detection." },
};
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
