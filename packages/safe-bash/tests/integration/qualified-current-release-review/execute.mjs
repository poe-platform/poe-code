import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chownSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const repository = "/Users/kjopek/Workspace/safe-bash";
const owner = join(repository, "tests/integration/qualified-current-release-review");
const source = "02a78bf64c29dedcd69071551ed5848b0765c107";
const tree = "4ccfddf7f7e521c29aa675cf09ca95f39870718b";
const work = join(owner, ".execution-work");
const launcher = join(work, "launcher");
const evidence = join(owner, "execution-evidence");
const patch = execFileSync("/usr/bin/which", ["apply_patch"], { encoding: "utf8" }).trim();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("/usr/bin/git", ["--no-replace-objects", ...args], { cwd: repository, maxBuffer: 96 * 1024 * 1024 });
const readAt = path => git("show", `${source}:${path}`);
const saveText = (path, text) => {
  assert.equal(existsSync(path), false, `preserve first evidence: ${path}`);
  execFileSync(patch, [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${path}\n${text.replace(/\n$/u, "").split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`, maxBuffer: 4 * 1024 * 1024 });
};
const save = (name, value) => saveText(join(evidence, name), JSON.stringify(value, null, 2) + "\n");
const environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LC_ALL: "C", LANG: "C", TZ: "UTC", npm_config_cache: join(work, "npm-cache"), npm_config_userconfig: join(work, "npmrc"), npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" };
const execute = (command, args, cwd = launcher, extra = {}) => {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { cwd, env: environment, encoding: "utf8", timeout: 900_000, maxBuffer: 48 * 1024 * 1024, ...extra });
  return { command: [command, ...args], cwd, environment: extra.env ?? environment, startedAt, finishedAt: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
};
const successful = result => { assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, JSON.stringify(result)); return result; };
const exactCommand = `LC_ALL=C LANG=C TZ=UTC npm run verify:release:qualified -- --source-commit ${source} --native-assets-from "$PWD/tests/commands/metadata-stress/.oracle/coreutils-9.7" --archive-tar-from "$PWD/tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar"`;

assert.equal(git("rev-parse", `${source}^{tree}`).toString().trim(), tree);
const ready = readFileSync("/tmp/safe-bash-qualified-current-release-review.ready", "utf8");
assert.ok(ready.includes("ROOT-OBSERVED actual CLOSED/code0: releaseauthor42631"));
assert.ok(ready.includes(source) && ready.includes(tree) && ready.includes(exactCommand));
assert.equal(existsSync(work), false, "single execution only; never overwrite prior run");
mkdirSync(work, { mode: 0o700 });
assert.equal(lstatSync(work).uid, process.getuid());
assert.ok(process.getgroups().includes(process.getgid()));
if (!process.getgroups().includes(lstatSync(work).gid)) chownSync(work, process.getuid(), process.getgid());
mkdirSync(launcher);
saveText(join(work, "npmrc"), "");
saveText(join(launcher, ".git"), `gitdir: ${repository}/.git\n`);
const archivePaths = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "scripts/verify-qualified-release.mjs", "scripts/verify-current-consumers.mjs", "tests/plugins/qualified-current-release", "tests/plugins/stream-five-public"];
git("archive", "--format=tar", `--output=${join(work, "launcher.tar")}`, source, ...archivePaths);
successful(execute("/usr/bin/tar", ["-xf", join(work, "launcher.tar"), "-C", launcher], repository));
symlinkSync(join(repository, "node_modules"), join(launcher, "node_modules"), "dir");
const frozen = JSON.parse(readFileSync(join(owner, "inputs.json")));
assert.equal(digest(readFileSync(join(owner, "FREEZE.md"))), frozen.controlDocumentSha256);
const inventory = JSON.parse(readAt("tests/plugins/qualified-current-release/inventory.json"));
const candidatePaths = git("ls-tree", "-r", "--name-only", source, "src", "tests", "scripts").toString().trim().split("\n").filter(path => !path.startsWith("tests/integration/stream-five-public/"));
const original = new Map(frozen.original30.map(entry => [entry.path, entry]));
const prepared = new Map(frozen.standalone.map(entry => [entry.path, entry]));
const census = candidatePaths.filter(path => path.endsWith(".mts")).map(path => {
  const entry = inventory.entries.find(item => item.path === path);
  assert.ok(entry, `unclassified ${path}`);
  const sha256 = digest(readAt(path));
  assert.equal(sha256, entry.sha256, `candidate inventory hash ${path}`);
  if (prepared.has(path)) assert.equal(entry.classification === "current", prepared.get(path).disposition === "maintained-strict-compile");
  else if (!path.endsWith(".d.mts")) assert.equal(entry.classification, "frozen-oracle");
  return { ...entry, sha256, original30: original.has(path), original30Sha256: original.get(path)?.sha256, preparationSha256: prepared.get(path)?.sha256, changedSincePreparation: prepared.has(path) ? prepared.get(path).sha256 !== sha256 : null };
});
assert.equal(census.filter(entry => entry.original30).length, 30);
assert.deepEqual(census.map(entry => entry.path).sort(), inventory.entries.map(entry => entry.path).sort());
save("candidate-census.json", { source, tree, original30: census.filter(entry => entry.original30), census, preparationCounts: frozen.counts, counts: inventory.counts, explicitNewPath: census.filter(entry => !prepared.has(entry.path) && !entry.path.endsWith(".d.mts")), sourceDeltaSinceAuthor545: git("diff", "--name-status", "5456730f1307f8c7fd3e8fcad342dc2eb6db2c27", source, "src").toString() });
const sourceFiles = candidatePaths.filter(path => path.startsWith("src/")).map(path => ({ path, sha256: digest(readAt(path)) }));
save("binding.json", { source, tree, readySha256: digest(ready), exactCommand, inputFreezeSha256: digest(readFileSync(join(owner, "inputs.json"))), harnessSha256: digest(readFileSync(new URL(import.meta.url))), sourceFiles, sourceFilesSha256: digest(JSON.stringify(sourceFiles)), sourceAndSupportDelta: frozen.sourceAndSupport.flatMap(entry => { const sha256 = digest(readAt(entry.path)); return sha256 === entry.sha256 ? [] : [{ path: entry.path, preparationSha256: entry.sha256, candidateSha256: sha256 }]; }), initialGitStatus: git("status", "--short").toString(), initialIndex: git("diff", "--cached", "--name-only").toString(), nativeProfile: { uid: process.getuid(), gid: process.getgid(), groups: process.getgroups(), umask: process.umask().toString(8), staging: { uid: lstatSync(work).uid, gid: lstatSync(work).gid, mode: (lstatSync(work).mode & 0o7777).toString(8) }, acl: execute("/bin/ls", ["-lde", work, launcher], repository), scope: "unsandboxed native reference; product emitted Node permission guards unchanged; C/UTC/offline; no OS network isolation claim" } });
for (const [label, path] of Object.entries({ authorization: "/tmp/safe-bash-qualified-current-release-review.ready", coordination: "/tmp/safe-bash-qualified-current-release-coordination.txt", "preparation-result": "/tmp/safe-bash-qualified-current-release-review-result.txt", "author-result": "/tmp/safe-bash-qualified-current-release-result.txt", "other-agent-webdav-result": "/tmp/safe-bash-current-webdav-consumer-blocker-result.txt" })) saveText(join(evidence, `${label}.txt`), readFileSync(path, "utf8"));
const canonical = await import(pathToFileURL(join(repository, "tests/commands/metadata-stress/canonical-env/runner.mjs")));
assert.equal(digest(readFileSync(join(repository, "tests/commands/metadata-stress/canonical-env/runner.mjs"))), digest(readAt("tests/commands/metadata-stress/canonical-env/runner.mjs")));
const primary = join(repository, "tests/commands/metadata-stress/.oracle/coreutils-9.7");
const stagedPrimary = join(launcher, "tests/commands/metadata-stress/.oracle/coreutils-9.7");
const nativeAssets = canonical.assets(primary);
for (const asset of nativeAssets) {
  assert.equal(digest(readFileSync(asset.path)), asset.sha256);
  if (asset.path.startsWith(primary)) {
    const destination = asset.path.replace(primary, stagedPrimary);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(asset.path, destination);
    assert.equal(digest(readFileSync(destination)), asset.sha256);
  }
}
const tarRelative = "tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar";
const tarSource = join(repository, tarRelative);
const tar = join(launcher, tarRelative);
assert.equal(digest(readFileSync(tarSource)), "49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66");
mkdirSync(dirname(tar), { recursive: true });
copyFileSync(tarSource, tar);
const wrong = join(work, "wrong-gnu-tar");
saveText(wrong, "independent wrong GNU tar pin\n");
chmodSync(wrong, 0o755);
const outerArgs = ["run", "verify:release:qualified", "--", "--source-commit", source, "--native-assets-from", stagedPrimary];
const negatives = [];
for (const [name, tail, extra] of [["env-only", [], { GNU_TAR: tar }], ["missing", ["--archive-tar-from", join(work, "nonexistent-gnu-tar")], {}], ["wrong", ["--archive-tar-from", wrong], {}]]) {
  const record = execute("npm", [...outerArgs, ...tail], launcher, { env: { ...environment, ...extra } });
  save(`${name}-outer.json`, record);
  const location = record.stdout.split("\n").filter(line => line.startsWith("{")).map(line => { try { return JSON.parse(line); } catch { return {}; } }).find(entry => entry.directory)?.directory;
  assert.ok(location, "outer must report snapshot location");
  const report = JSON.parse(readFileSync(join(location, "result.json")));
  save(`${name}-result.json`, report);
  negatives.push({ name, status: record.status, executedTests: report.setup?.executedTests, steps: report.steps.length, issues: report.setup?.issues });
  assert.equal(record.status, 78);
  assert.equal(report.setup.executedTests, 0);
  assert.equal(report.steps.length, 0);
  assert.equal(report.archiveSetup.assets.find(asset => asset.name === "gnu")?.execution, undefined);
}
save("tar-negative-summary.json", negatives);
console.log("Three outer prerequisite controls rejected before tests; starting exact positive outer npm job.");
const positive = execute("npm", [...outerArgs, "--archive-tar-from", tar]);
save("positive-outer.json", positive);
const positiveLocation = positive.stdout.split("\n").filter(line => line.startsWith("{")).map(line => { try { return JSON.parse(line); } catch { return {}; } }).find(entry => entry.directory)?.directory;
assert.ok(positiveLocation, "positive outer must report location");
const report = JSON.parse(readFileSync(join(positiveLocation, "result.json")));
for (const name of readdirSync(positiveLocation).filter(name => name.endsWith(".json"))) saveText(join(evidence, "positive", name), readFileSync(join(positiveLocation, name), "utf8"));
save("execution-summary.json", { source, tree, startedAt: positive.startedAt, finishedAt: positive.finishedAt, status: positive.status, signal: positive.signal, reportExit: report.exitCode, location: positiveLocation, negatives, sourceTreeSha256: report.sourceTreeSha256, testTreeSha256: report.testTreeSha256, harnessSha256: report.harnessSha256, archiveSha256: report.archiveSha256, nativeAssetsUnchanged: nativeAssets.every(asset => digest(readFileSync(asset.path)) === asset.sha256), tarUnchanged: digest(readFileSync(tarSource)) === digest(readFileSync(tar)), sourceUnchanged: report.sourceUnchanged, testsUnchanged: report.testsUnchanged, rootDistUnchanged: report.rootDistUnchanged });
console.log(JSON.stringify({ positiveStatus: positive.status, location: positiveLocation, evidence }));
