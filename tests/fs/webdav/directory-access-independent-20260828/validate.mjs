import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import ts from "typescript";
import { schema, scenarios, invariants, defaults, requestBody } from "./cases.mjs";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const ownRelative = path.relative(repository, own);
const author = "tests/fs/webdav/directory-access-review-20260828";
const commits = {
  preseal: "603ba3371736373316e419c2327bc68c4d96dba9",
  proposal: "6bd3a0d98d3043c14ed0fa80dedb36b72b65d9e5",
  baseline: "5137a74ec855a32d8a8860eb66b62eb44d11e290",
  acceptance: "0a7e062806537c1bcca3bdeece47e357a302e4b0",
};
const members = ["DECLARED-CONTRACT.md", "MANIFEST.json", "PROTOCOL.md", "VALIDATION.json", "cases.mjs", "typed-inputs.ts", "validate.mjs"].sort();
const git = (...args) => execFileSync("git", args, { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const jsonHash = value => hash(JSON.stringify(value));
const fromGit = (commit, name) => git("show", `${commit}:${name}`);
const jsonFromGit = (commit, name) => JSON.parse(fromGit(commit, name));
const list = (commit, directory) => git("ls-tree", "-r", "--name-only", commit, "--", directory).toString().trim().split("\n").filter(Boolean);
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).flatMap(entry => {
  const filename = path.join(directory, entry.name);
  assert.ok(!entry.isSymbolicLink(), `symlink not admitted: ${filename}`);
  if (entry.isDirectory()) return walk(filename);
  assert.ok(entry.isFile(), `not regular: ${filename}`);
  return [filename];
});
const freeze = jsonFromGit(commits.preseal, `${author}/FREEZE.json`);
assert.equal(freeze.base, commits.baseline);
const protectedPaths = [...new Set([
  ...Object.keys(freeze.source), ...list(commits.baseline, "src/fs/webdav"),
  "src/contracts/errors.ts", "src/contracts/index.ts", "src/index.ts", "package.json",
  ...list(commits.proposal, author), `${author}/ROOT-ACCEPTANCE.md`, freeze.packageEvidence,
])].sort();
const readProtected = () => Object.fromEntries(protectedPaths.map(name => {
  const commit = name === `${author}/ROOT-ACCEPTANCE.md` ? commits.acceptance
    : name.startsWith("tests/") ? commits.proposal : commits.baseline;
  const expected = hash(fromGit(commit, name));
  const actual = hash(fs.readFileSync(path.join(repository, name)));
  assert.equal(actual, expected, `protected live bytes changed: ${name}`);
  assert.equal(hash(git("show", `:${name}`)), expected, `protected index changed: ${name}`);
  return [name, { commit, sha256: expected }];
}));
const checkMembership = () => {
  for (const [commit, directory] of [[commits.baseline, "src/fs/webdav"], [commits.acceptance, author]]) {
    assert.deepEqual(walk(path.join(repository, directory)).map(name => path.relative(repository, name)).sort(), list(commit, directory).sort(), `scope membership: ${directory}`);
  }
};
const protectedBefore = readProtected();
checkMembership();
const authenticatedCommits = Object.fromEntries(Object.entries(commits).map(([label, commit]) => {
  const bytes = git("cat-file", "commit", commit);
  assert.equal(createHash("sha1").update(`commit ${bytes.length}\0`).update(bytes).digest("hex"), commit);
  const tree = bytes.toString().match(/^tree ([a-f0-9]{40})$/m)?.[1];
  assert.equal(git("rev-parse", `${commit}^{tree}`).toString().trim(), tree);
  return [label, { commit, tree, rawCommitSha256: hash(bytes) }];
}));
assert.ok(git("cat-file", "commit", commits.proposal).toString().includes(`parent ${commits.preseal}\n`));
for (const [name, expected] of Object.entries(freeze.source)) assert.equal(protectedBefore[name].sha256, expected);
for (const [name, expected] of Object.entries(freeze.fixtures)) assert.equal(hash(fromGit(commits.preseal, `${author}/${name}`)), expected);
const observationsCompressed = Buffer.from(fromGit(commits.proposal, `${author}/observations-01.json.gz.base64`).toString(), "base64");
assert.equal(hash(observationsCompressed), "d6090214a7969816c339f4981c72b41b787686b36df9e115ec292b2a3435f283");
const observations = JSON.parse(gunzipSync(observationsCompressed));
assert.equal(observations.freezeCommit, commits.preseal);
assert.deepEqual(observations.liveSourceAfter, freeze.source);
const compressed = Buffer.from(fromGit(commits.proposal, freeze.packageEvidence).toString(), "base64");
assert.equal(hash(compressed), freeze.packageEvidenceSha256);
const evidence = JSON.parse(gunzipSync(compressed));
assert.equal(evidence.candidate, commits.baseline);
assert.equal(evidence.binding.tree, authenticatedCommits.baseline.tree);
assert.equal(hash(Buffer.from(evidence.binding.rawCommitBase64, "base64")), authenticatedCommits.baseline.rawCommitSha256);
const archive = Buffer.from(evidence.package.base64, "base64");
assert.equal(hash(archive), freeze.packageSha256);
const tar = gunzipSync(archive);
const packageFiles = new Map();
let offset = 0;
while (offset + 512 <= tar.length) {
  const header = tar.subarray(offset, offset + 512);
  if (header.every(byte => byte === 0)) break;
  const text = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/s, "");
  const octal = (start, end) => {
    const value = text(start, end).trim();
    assert.match(value, /^[0-7]+$/);
    return Number.parseInt(value, 8);
  };
  const size = octal(124, 136);
  assert.equal(octal(148, 156), header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0));
  assert.equal(text(156, 157), "0");
  const archiveName = [text(345, 500), text(0, 100)].filter(Boolean).join("/");
  assert.ok(archiveName.startsWith("package/"));
  const name = archiveName.slice("package/".length);
  assert.ok(!name.split("/").some(segment => segment === ".." || segment === ""));
  assert.ok(!packageFiles.has(name));
  assert.ok(offset + 512 + size <= tar.length);
  const bytes = tar.subarray(offset + 512, offset + 512 + size);
  assert.deepEqual({ sha256: hash(bytes), bytes: size, mode: octal(100, 108) & 0o777 }, evidence.packageInventory[name]);
  packageFiles.set(name, bytes);
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.ok(tar.subarray(offset).every(byte => byte === 0));
assert.equal(packageFiles.size, 846);
assert.deepEqual([...packageFiles.keys()].sort(), Object.keys(evidence.packageInventory).sort());
assert.deepEqual(observations.packageBefore, evidence.packageInventory);
assert.deepEqual(observations.packageAfter, evidence.packageInventory);
assert.equal(observations.publicImport.sha256, hash(packageFiles.get("dist/index.js")));
const packageManifest = JSON.parse(packageFiles.get("package.json").toString());
assert.equal(packageManifest.name, "virtual-bash");
assert.equal(packageManifest.exports["."].types, "./dist/index.d.ts");
assert.equal(packageManifest.exports["."].import, "./dist/index.js");

assert.equal(schema, "webdav-directory-access-independent/v1");
assert.equal(new Set(scenarios.map(scenario => scenario.id)).size, scenarios.length);
assert.equal(invariants.length, 8);
const allowedGroups = ["navigation-freshness", "metadata-namespace", "file-type", "ordering", "mode5-races", "input-bounds", "response-limits", "lookup-races", "cancellation-cleanup", "compatibility"];
const groups = Object.fromEntries(allowedGroups.map(group => [group, scenarios.filter(scenario => scenario.group === group).length]));
const outcomes = new Set(["OK", "directory", "EINVAL", "ECANCELED", "EROFS", "ENOTSUP", "EACCES", "EIO", "ENOTDIR", "ENAMETOOLONG", "EFBIG", "ENOENT", "ETIMEDOUT", "EBUSY", "EAGAIN"]);
const cleanupProfiles = new Set(["finite-eof", "zero-work", "redirect-once", "redirect-once-per-pair", "bounded-body-cancel", "active-body-once", "late-body-once", "observed-rejection", "unconsumed-get-once"]);
for (const scenario of scenarios) {
  assert.match(scenario.id, /^[A-Z][A-Za-z0-9-]+$/);
  assert.ok(allowedGroups.includes(scenario.group));
  assert.equal(scenario.qualification, "injected-mock-only");
  assert.ok(cleanupProfiles.has(scenario.cleanup));
  assert.ok(scenario.calls.length > 0);
  assert.ok(scenario.wrapper === undefined || ["plain", "readonly"].includes(scenario.wrapper));
  assert.ok(scenario.requests.length <= 512);
  if (scenario.cleanup === "zero-work") assert.equal(scenario.requests.length, 0);
  for (const call of scenario.calls) {
    assert.ok(["access", "stat", "readdir"].includes(call.method));
    assert.equal(typeof call.path, "string");
    assert.ok(outcomes.has(call.outcome));
    if (call.method === "access") assert.ok(typeof call.mode === "number" || ["NaN", "Infinity", "string:1", "null"].includes(call.mode));
    assert.ok(call.signal === undefined || ["active", "preaborted", "omitted"].includes(call.signal));
  }
  if (scenario.inputBytes !== undefined) {
    assert.equal(scenario.inputBytes, Buffer.byteLength(scenario.calls[0].path));
    assert.equal(scenario.inputComponents, scenario.calls[0].path.split("/").filter(Boolean).length);
    const allowed = scenario.inputBytes <= 65536 && scenario.inputComponents <= 256;
    assert.equal(scenario.calls[0].outcome, allowed ? "OK" : "ENAMETOOLONG");
  }
  for (const request of scenario.requests) {
    const url = new URL(request.url);
    assert.equal(url.origin, new URL(defaults.baseUrl).origin);
    assert.ok(url.pathname.startsWith("/dav/"));
    assert.ok(["PROPFIND", "GET"].includes(request.method));
    assert.ok(request.method === "GET" ? request.depth === null : ["0", "1"].includes(request.depth));
    assert.ok(Number.isInteger(request.response.status) && request.response.status >= 200 && request.response.status <= 599);
    assert.ok(request.response.body === null || typeof request.response.body === "string");
    for (const key of ["responses", "pulls", "underlyingCancels"]) assert.ok(Number.isInteger(request.resources[key]) && request.resources[key] >= 0);
    assert.equal(request.resources.releasedLocks, true);
  }
}
assert.equal(scenarios.find(scenario => scenario.id === "Q-maximal-lookup").requests.length, 512);

const virtualRoot = path.join(own, ".in-memory-accepted-api");
const virtualFiles = new Map([...packageFiles].filter(([name]) => name.endsWith(".d.ts") || name === "package.json")
  .map(([name, bytes]) => [path.join(virtualRoot, name), bytes.toString()]));
const compilerOptions = {
  strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, noEmit: true, skipLibCheck: true,
  baseUrl: own, paths: { "virtual-bash": [path.join(virtualRoot, "dist/index.d.ts")] },
  types: ["node"],
};
const host = ts.createCompilerHost(compilerOptions);
const realRead = host.readFile.bind(host);
const realExists = host.fileExists.bind(host);
const realDirectoryExists = host.directoryExists.bind(host);
host.readFile = filename => virtualFiles.get(filename) ?? realRead(filename);
host.fileExists = filename => virtualFiles.has(filename) || realExists(filename);
host.directoryExists = filename => [...virtualFiles.keys()].some(name => name.startsWith(`${filename}${path.sep}`)) || realDirectoryExists(filename);
host.getSourceFile = (filename, languageVersion) => {
  const text = host.readFile(filename);
  return text === undefined ? undefined : ts.createSourceFile(filename, text, languageVersion, true);
};
const program = ts.createProgram([path.join(own, "typed-inputs.ts")], compilerOptions, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: filename => filename, getCurrentDirectory: () => repository, getNewLine: () => "\n",
}));
const declarations = program.getSourceFiles().filter(source => source.fileName.startsWith(`${virtualRoot}/`))
  .map(source => path.relative(virtualRoot, source.fileName)).sort();
assert.ok(declarations.includes("dist/fs/webdav/webdav.d.ts"));
assert.ok(declarations.includes("dist/fs/readonly/index.d.ts"));
for (const source of program.getSourceFiles()) assert.ok(!source.fileName.startsWith(path.join(repository, "src") + path.sep), "live-source fallback forbidden");
for (const filename of ["cases.mjs", "validate.mjs"]) execFileSync(process.execPath, ["--check", path.join(own, filename)]);

const inputs = Object.fromEntries(members.filter(name => !["MANIFEST.json", "VALIDATION.json"].includes(name))
  .map(name => [name, hash(fs.readFileSync(path.join(own, name)))]));
const inputData = { schema, defaults, requestBody, invariants, scenarios };
const summary = {
  schema, scenarios: scenarios.length, groups, invariants: invariants.length,
  positiveTypeAssertions: 8, negativeTypeAssertions: 10, uncalledPublicCallExpressions: 5,
  expandedDataSha256: jsonHash(inputData), maximumRequestTrace: 512,
  declarationCount: declarations.length,
  declarationInventorySha256: jsonHash(declarations.map(name => [name, evidence.packageInventory[name].sha256])),
  archiveEntriesAuthenticated: packageFiles.size,
  implementationExecutions: 0, authorProfileExecutions: 0, serviceExecutions: 0,
};
assert.deepEqual(readProtected(), protectedBefore);
checkMembership();
const actualMembers = walk(own).map(filename => path.relative(own, filename)).sort();
const draft = process.argv[2] === "--draft";
assert.ok(draft || process.argv.length === 2, "only --draft or no arguments supported");
const fixtureMembers = members.filter(name => !["MANIFEST.json", "VALIDATION.json"].includes(name));
if (draft) {
  assert.equal(git("ls-files", "--", ownRelative).length, 0, "draft regeneration requires entirely untracked, uncommitted own inputs");
  assert.ok(JSON.stringify(actualMembers) === JSON.stringify(fixtureMembers)
    || JSON.stringify(actualMembers) === JSON.stringify(members), "draft owned membership including additions");
} else assert.deepEqual(actualMembers, members, "owned membership including additions");
const tooling = {
  node: process.version, nodeBinarySha256: hash(fs.readFileSync(process.execPath)),
  typescript: ts.version, typescriptCompilerSha256: hash(fs.readFileSync(path.join(repository, "node_modules/typescript/lib/typescript.js"))),
};
if (draft) {
  const manifest = {
    schema: "webdav-directory-access-seal/v1", sealedAt: new Date().toISOString(),
    headAtSeal: git("rev-parse", "HEAD").toString().trim(),
    ownership: ownRelative, allowedMembers: members, files: inputs,
    commits: authenticatedCommits, protectedInputs: protectedBefore,
    exposedBodies: ["src/fs/webdav/webdav.ts", "src/fs/readonly/index.ts"],
    exposedDocsAndTypes: ["src/fs/webdav/README.md", "src/contracts/filesystem.ts", "src/contracts/filesystem.md", "src/index.ts", "src/fs/webdav/index.ts", "package.json"],
    exposedFixtures: ["FREEZE.json", "README.md", "POLICY-PROPOSAL.md", "ROOT-ACCEPTANCE.md", "cases.json", "run.mjs"].map(name => `${author}/${name}`),
    package: {
      evidence: freeze.packageEvidence, compressedEvidenceSha256: freeze.packageEvidenceSha256,
      archiveSha256: freeze.packageSha256, entries: packageFiles.size,
      publicImportSpecifier: "virtual-bash", runtimeExport: packageManifest.exports["."].import,
      typesExport: packageManifest.exports["."].types,
      runtimeEntrySha256: hash(packageFiles.get("dist/index.js")),
      typesEntrySha256: hash(packageFiles.get("dist/index.d.ts")),
      historicalAuthorImport: observations.publicImport,
      runtimeImportedByThisFreeze: false,
      declarationHashAuthority: "packageInventory inside authenticated compressedEvidenceSha256",
      loadedDeclarations: declarations,
    },
    summary, tooling,
    chronology: {
      firstBaselineAuthentication: { notEarlierThan: "2026-08-28T03:21:39Z", order: "completed-before-accepted-body-inspection" },
      candidateRouted: false, providerInputsBeforeAndAfter: "accepted-baseline-unchanged",
      precodeQualification: "before any future routed candidate; no claim about unseen work elsewhere",
      originalForeignStaging: [],
    },
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const validation = {
    schema: "webdav-directory-access-static-validation/v1", checkedAt: new Date().toISOString(),
    command: `node ${ownRelative}/validate.mjs`, manifestSha256: hash(manifestText),
    status: "STATIC_ONLY_NO_IMPLEMENTATION_PASSES", summary, tooling,
    checks: ["Git commit content-addresses", "protected baseline/index/author bytes before-and-after",
      "author/provider exact scope membership including additions", "all accepted tar entries and checksums",
      "own module syntax and fixture schema", "strict accepted public declaration bindings no live-source fallback",
      "stable expanded input inventory", "owned payload membership; complete seal checked after record creation"],
    actualService: "unavailable/not-run", sourceApproval: false, cdRuntimeReview: "separate-held",
    preliminaryStaticFinding: {
      status: "membership-check-rejected-omitted-acceptance-document",
      path: `${author}/ROOT-ACCEPTANCE.md`,
      resolution: "authenticated existing initial-HEAD acceptance commit separately; original proposal bytes unchanged",
      implementationExecuted: false,
    },
    presealAuthoringCorrections: ["schema check rejected punctuation in numeric/token case IDs; normalized IDs without changing inputs or outcomes",
      "uncommitted document audit added explicit proposed/not-implemented metadata and validation matrix before final freeze commit"],
  };
  process.stdout.write(JSON.stringify({ manifest, validation }));
} else {
  const manifestBytes = fs.readFileSync(path.join(own, "MANIFEST.json"));
  const manifest = JSON.parse(manifestBytes);
  const validation = JSON.parse(fs.readFileSync(path.join(own, "VALIDATION.json")));
  assert.deepEqual(manifest.allowedMembers, members);
  assert.deepEqual(manifest.files, inputs);
  assert.deepEqual(manifest.commits, authenticatedCommits);
  assert.deepEqual(manifest.protectedInputs, protectedBefore);
  assert.deepEqual(manifest.summary, summary);
  assert.deepEqual(manifest.package.loadedDeclarations, declarations);
  assert.deepEqual(manifest.tooling, tooling);
  assert.equal(validation.manifestSha256, hash(manifestBytes));
  assert.deepEqual(validation.summary, summary);
  assert.deepEqual(validation.tooling, tooling);
  assert.equal(validation.status, "STATIC_ONLY_NO_IMPLEMENTATION_PASSES");
  process.stdout.write(`${JSON.stringify({ status: validation.status, checkedAt: new Date().toISOString(), summary, membershipIncludesAdditions: true })}\n`);
}
