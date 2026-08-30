import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const recipePrefix = "tests/integration/owned-output-production-rebase/author-public";
const recipeCommit = "7204b9e01752c700dd791afd332e7f1b5fd8ba73";
const sourceOrigin = "fd1daa123298568546d9ea4e95f8c81dde9c52ff";
const reviewCommit = "7ca45f2decea9faab958b15577a55aac2be1c40c";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("/usr/bin/git", ["--no-replace-objects", "-C", repository, "-c", "core.fsmonitor=false", ...args],
    { env: { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
};
const output = path.join(own, "actual-01.json.gz.base64");
assert.equal(fs.existsSync(output), false, "Once-only replay; no overwrite or automatic retry");
const readRecipe = name => git("show", `${recipeCommit}:${recipePrefix}/${name}`);
const frozen = JSON.parse(readRecipe("safejs-execution-v1/EXECUTION-INPUTS.json"));
const recipeNames = ["harness/common.mjs", "harness/safejs-binding.mjs", "profiles/REFERENCES.json", "profiles/SAFEJS.json", "profiles/TOOLING.json", "safejs-execution-v1/EXECUTION-INPUTS.json",
  ...frozen.files.map(entry => `safejs-execution-v1/${entry.path}`)];
const recipeInputs = [...new Set(recipeNames)].map(name => {
  const bytes = readRecipe(name);
  const filename = path.join(repository, recipePrefix, name);
  assert.equal(hash(fs.readFileSync(filename)), hash(bytes), name);
  return { name, filename, bytes: bytes.length, sha256: hash(bytes) };
});
for (const entry of frozen.files) assert.equal(hash(readRecipe(`safejs-execution-v1/${entry.path}`)), entry.sha256);
const sourceCaptureBytes = git("show", `${reviewCommit}:tests/shell/cancellation-stage2-independent-20260827/review-fd1/focused-02.json.gz.base64`);
const sourceCaptureCompressed = Buffer.from(sourceCaptureBytes.toString(), "base64");
assert.equal(hash(sourceCaptureCompressed), "0b8d23c455983c196f95d44334aca0300570150faf28e8cd361c24a44ef06cd1");
const sourceCapture = JSON.parse(gunzipSync(sourceCaptureCompressed));
assert.equal(sourceCapture.candidate, sourceOrigin);
const archive = Buffer.from(sourceCapture.archiveBase64, "base64");
const tarball = Buffer.from(sourceCapture.package.base64, "base64");
assert.equal(hash(archive), "51b9013eb0ac70849059403cddf22d5f8f0fab360da7a41e308ae0ca88595e87");
assert.equal(hash(tarball), "87c200daf413d9f1ab835b4d1738a1a93946fd3e350427b01accde4e0b23b1af");
const { inventory, copyTree, writeNew, regular, verifyTooling } = await import(pathToFileURL(path.join(repository, recipePrefix, "harness/common.mjs")).href);
const tooling = verifyTooling();
const root = fs.realpathSync(fs.mkdtempSync("/tmp/safe-bash-fd1-safejs-binding-"));
const cohortRoots = [];
const result = { capturedAt: new Date().toISOString(), sourceOrigin, reviewedReconstruction: reviewCommit, recipeCommit,
  recipeInputs, sourceArchiveSha256: hash(archive), packageSha256: hash(tarball), root, cohorts: [],
  qualification: "Existing actual SafeJS25 qualified regression on fd1; not a new guest invoke-signal feature proof",
  harness: Object.fromEntries(["replay.mjs", "bridge.mjs"].map(name => [name, fs.readFileSync(path.join(own, name)).toString("base64")])) };
const snapshotData = directory => {
  const entries = inventory(directory);
  return Object.fromEntries(entries.filter(entry => entry.kind === "file").map(entry => [entry.path, {
    sha256: entry.sha256, bytes: entry.bytes, base64: fs.readFileSync(path.join(directory, entry.path)).toString("base64"),
  }]));
};
try {
  const productRoot = path.join(root, "selected-product");
  const packageRoot = path.join(root, "package");
  fs.mkdirSync(productRoot);
  fs.mkdirSync(packageRoot);
  writeNew(path.join(root, "selected-source.tar.gz"), archive);
  writeNew(path.join(root, "virtual-bash-0.0.0.tgz"), tarball);
  const extractSource = spawnSync("tar", ["-xz", "-C", productRoot], { input: archive });
  assert.equal(extractSource.status, 0, extractSource.stderr.toString());
  const extractPackage = spawnSync("tar", ["-xz", "--strip-components=1", "-C", packageRoot], { input: tarball });
  assert.equal(extractPackage.status, 0, extractPackage.stderr.toString());
  const productEntries = inventory(productRoot);
  const sourceFiles = productEntries.filter(entry => entry.kind === "file");
  assert.equal(sourceFiles.length, 254);
  assert.deepEqual(sourceFiles.map(entry => entry.path).sort(), Object.keys(sourceCapture.sourceInventory).sort());
  for (const entry of sourceFiles) assert.equal(entry.sha256, sourceCapture.sourceInventory[entry.path].sha256);
  const packageEntries = inventory(packageRoot);
  for (const entry of packageEntries.filter(entry => entry.kind === "file" && entry.path.startsWith("dist/"))) {
    assert.equal(entry.sha256, sourceCapture.emittedInventory[entry.path.slice(5)].sha256);
  }
  assert.equal(packageEntries.filter(entry => entry.kind === "file").length, 834);
  assert.equal(fs.existsSync(path.join(packageRoot, "src")), false);
  const compilerRoot = path.join(root, "compiler");
  const compilerSource = fs.realpathSync(path.join(repository, "node_modules/typescript"));
  const compilerEntries = inventory(compilerSource);
  const historicalBinding = JSON.parse(readRecipe("safejs-execution-v1/PUBLIC-BINDING.json"));
  assert.deepEqual(compilerEntries, historicalBinding.compilerEntries);
  copyTree(compilerSource, compilerRoot, compilerEntries);
  const nodeBytes = regular(fs.realpathSync(process.execPath));
  assert.equal(hash(nodeBytes), historicalBinding.nodeSha256);
  const nodePath = path.join(root, "tools/node");
  writeNew(nodePath, nodeBytes, 0o755);
  const objects = [];
  const gitObject = (kind, bytes) => {
    const encoded = Buffer.concat([Buffer.from(`${kind} ${bytes.length}\0`), bytes]);
    const sha1 = createHash("sha1").update(encoded).digest("hex");
    const measured = spawnSync("/usr/bin/git", ["hash-object", "-t", kind, "--stdin"], { cwd: repository, input: bytes,
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 1024 * 1024 });
    assert.equal(measured.status, 0, measured.stderr.toString());
    assert.equal(measured.stdout.toString().trim(), sha1);
    objects.push({ kind, sha1, bytes: bytes.toString("base64") });
    return sha1;
  };
  const tree = directory => {
    const names = fs.readdirSync(directory).map(name => ({ name, directory: fs.lstatSync(path.join(directory, name)).isDirectory() }))
      .sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.directory ? "/" : "")), Buffer.from(right.name + (right.directory ? "/" : ""))));
    const entries = names.map(entry => {
      const filename = path.join(directory, entry.name);
      const mode = entry.directory ? "40000" : (fs.statSync(filename).mode & 0o111) ? "100755" : "100644";
      const digest = entry.directory ? tree(filename) : gitObject("blob", fs.readFileSync(filename));
      return Buffer.concat([Buffer.from(`${mode} ${entry.name}\0`), Buffer.from(digest, "hex")]);
    });
    return gitObject("tree", Buffer.concat(entries));
  };
  const candidateTree = tree(productRoot);
  const commitBody = Buffer.from(`tree ${candidateTree}\nauthor Independent fd1 fixture <fixture@invalid> 1787875200 +0000\ncommitter Independent fd1 fixture <fixture@invalid> 1787875200 +0000\n\nSelected product inputs for fd1 reconstruction; origin ${sourceOrigin}\n`);
  const candidateCommit = gitObject("commit", commitBody);
  result.selectedGitSnapshot = { commit: candidateCommit, tree: candidateTree, commitBody: commitBody.toString("base64"),
    qualification: "Real Git object identities for selected input tree only; no branch, worktree, or object writes. Not whole fd1 HEAD.",
    treeObjects: objects.filter(entry => entry.kind === "tree") };
  const binding = {
    candidateCommit, candidateTree, sourceOrigin, sourceManifestSha256: hash(JSON.stringify(sourceCapture.sourceInventory)),
    productRoot, packageRoot, packageEntries, compilerRoot, compilerEntries, nodePath, nodeSha256: hash(nodeBytes),
    archivePath: path.join(root, "selected-source.tar.gz"), archiveSha256: hash(archive),
    tarballPath: path.join(root, "virtual-bash-0.0.0.tgz"), tarballSha256: hash(tarball),
  };
  result.binding = binding;
  const driver = path.join(root, "driver");
  fs.mkdirSync(driver);
  const commonUrl = pathToFileURL(path.join(repository, recipePrefix, "harness/common.mjs")).href;
  let supervisor = readRecipe("safejs-execution-v1/supervisor.mjs").toString();
  const originalSupervisor = supervisor;
  const replacements = [];
  const replace = (before, after) => {
    assert.equal(supervisor.split(before).length, 2, before);
    supervisor = supervisor.replace(before, after);
    replacements.push({ before, after });
  };
  replace('from "../harness/common.mjs"', `from ${JSON.stringify(commonUrl)}`);
  replace('from "../harness/safejs-binding.mjs"', `from ${JSON.stringify(pathToFileURL(path.join(repository, recipePrefix, "harness/safejs-binding.mjs")).href)}`);
  replace('import { executionFreeze, hashFile, snapshot } from "../execution-v1/archive-binding.mjs";', 'import { verifyBoundRecipe, verifyPublicBinding } from "./bridge.mjs";');
  replace('from "./private-guard.mjs"', `from ${JSON.stringify(pathToFileURL(path.join(repository, recipePrefix, "safejs-execution-v1/private-guard.mjs")).href)}`);
  replace('from "./surface-assessment.mjs"', `from ${JSON.stringify(pathToFileURL(path.join(repository, recipePrefix, "safejs-execution-v1/surface-assessment.mjs")).href)}`);
  const verifyStart = supervisor.indexOf("export function verifySafeJsFreeze()");
  const auditStart = supervisor.indexOf("function auditImports(");
  assert.ok(verifyStart > 0 && auditStart > verifyStart);
  replace(supervisor.slice(verifyStart, auditStart), "export function verifySafeJsFreeze() { return verifyBoundRecipe(); }\nfunction publicGuards(binding) { return verifyPublicBinding(binding); }\n");
  replace("/tmp/safe-bash-author-current-safejs-${family}-", "/tmp/safe-bash-fd1-current-safejs-${family}-");
  const unchangedSection = text => text.slice(text.indexOf("function auditImports("), text.indexOf("export async function runCohort("));
  assert.equal(unchangedSection(supervisor), unchangedSection(originalSupervisor));
  result.supervisorBinding = { originalSha256: hash(originalSupervisor), effectiveSha256: hash(supervisor), replacements,
    auditAndChildExecutionSha256: hash(unchangedSection(supervisor)), assertionChanges: 0 };
  writeNew(path.join(driver, "supervisor.mjs"), supervisor);
  writeNew(path.join(driver, "loader.mjs"), readRecipe("safejs-execution-v1/loader.mjs"));
  const bridge = fs.readFileSync(path.join(own, "bridge.mjs"), "utf8").replace('"../../../integration/owned-output-production-rebase/author-public/harness/common.mjs"', JSON.stringify(commonUrl));
  writeNew(path.join(driver, "bridge.mjs"), bridge);
  writeNew(path.join(driver, "PUBLIC-BINDING.json"), JSON.stringify(binding, null, 2) + "\n");
  const generatedInputs = ["supervisor.mjs", "loader.mjs", "bridge.mjs", "PUBLIC-BINDING.json"].map(name => ({ name, sha256: hash(regular(path.join(driver, name))) }));
  const configuration = { recipeInputs, generatedInputs, recipeCommit, recipeManifestSha256: hash(readRecipe("safejs-execution-v1/EXECUTION-INPUTS.json")), sourceOrigin, binding, productEntries };
  writeNew(path.join(driver, "FD1-INPUTS.json"), JSON.stringify(configuration, null, 2) + "\n");
  result.preparedDriver = snapshotData(driver);
  result.tooling = tooling;
  const { verifyPublicBinding } = await import(pathToFileURL(path.join(driver, "bridge.mjs")).href);
  result.publicBefore = verifyPublicBinding(binding);
  const { runCohort } = await import(pathToFileURL(path.join(driver, "supervisor.mjs")).href);
  for (const family of ["surface", "lifecycle", "controls"]) {
    const report = await runCohort(family);
    cohortRoots.push(report.root);
    const evidence = snapshotData(path.join(report.root, "evidence"));
    const logs = snapshotData(path.join(report.root, "logs"));
    for (const child of report.knownChildren) {
      assert.equal(child.closed, true);
      if (child.pid) assert.throws(() => process.kill(child.pid, 0), error => error.code === "ESRCH");
    }
    result.cohorts.push({ family, report, evidence, logs });
    fs.rmSync(report.root, { recursive: true, force: true });
    result.cohorts.at(-1).temporaryRemoved = !fs.existsSync(report.root);
    if (report.status !== "AUTHOR_COHORT_PASS") {
      result.stoppedAfter = family;
      break;
    }
  }
  result.publicAfter = verifyPublicBinding(binding);
  assert.deepEqual(result.publicAfter, result.publicBefore);
  result.completed = result.cohorts.length === 3 && result.cohorts.every(entry => entry.report.status === "AUTHOR_COHORT_PASS");
  result.counts = { intended: 25, pass: result.cohorts.reduce((total, entry) => total + entry.report.counts.pass, 0),
    engineRuns: result.cohorts.reduce((total, entry) => total + entry.report.counts.engineRuns, 0),
    nonpass: result.cohorts.reduce((total, entry) => total + entry.report.counts.nonpass, 0) };
} catch (error) {
  result.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  for (const directory of cohortRoots) if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
  result.temporaryRemoved = !fs.existsSync(root) && cohortRoots.every(directory => !fs.existsSync(directory));
  result.cohortRoots = cohortRoots;
  const bytes = gzipSync(JSON.stringify(result), { level: 9 });
  fs.writeFileSync(output, bytes.toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, sha256: hash(bytes), completed: result.completed ?? false, counts: result.counts,
    failure: result.failure, temporaryRemoved: result.temporaryRemoved }, null, 2));
  if (!result.completed) process.exitCode = 1;
}
