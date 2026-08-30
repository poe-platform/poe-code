import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
assert(process.argv[2]?.startsWith("/tmp/safe-bash-getopts-runtime."));
const output = realpathSync(process.argv[2]);
const candidate = "618d8967009117547ab476256bc6eb0a9463309a";
const owner = "tests/integration/owned-output-production-rebase/author-public";
const work = join(output, "safejs-replay-v2");
mkdirSync(work);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("/usr/bin/git", ["-C", repo, "-c", "core.fsmonitor=false", ...args], { env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" }, maxBuffer: 32 * 1024 * 1024 });
const write = (name, bytes) => { mkdirSync(dirname(join(work, name)), { recursive: true }); writeFileSync(join(work, name), bytes, { flag: "wx" }); };
const originals = {};
for (const name of ["harness/common.mjs", "harness/safejs-binding.mjs", "profiles/REFERENCES.json", "profiles/SAFEJS.json", "execution-v1/archive-binding.mjs", "safejs-execution-v1/loader.mjs", "safejs-execution-v1/private-guard.mjs", "safejs-execution-v1/surface-assessment.mjs"]) {
  const bytes = git("show", candidate + ":" + owner + "/" + name);
  originals[name] = hash(bytes);
  write(name, bytes);
}
const original = git("show", candidate + ":" + owner + "/safejs-execution-v1/supervisor.mjs").toString();
originals["safejs-execution-v1/supervisor.mjs"] = hash(original);
const start = original.indexOf("export function verifySafeJsFreeze()");
const end = original.indexOf("function auditImports(");
assert(start > 0 && end > start);
let adapted = original.slice(0, start) + `export function verifySafeJsFreeze() {
  const freeze = json(join(current, "ADAPTED-INPUTS.json"));
  for (const entry of freeze.files) assert.equal(sha256(regular(join(current, "..", entry.path))), entry.sha256, entry.path);
  return { commit: freeze.candidate, manifestSha256: sha256(regular(join(current, "ADAPTED-INPUTS.json"))), qualification: freeze.qualification };
}
function publicGuards(binding) {
  assert.equal(git("rev-parse", binding.candidateCommit + "^{tree}").toString().trim(), binding.candidateTree);
  assert.equal(hashFile(binding.nodePath), binding.nodeSha256);
  assert.equal(hashFile(binding.archivePath), binding.archiveSha256);
  assert.deepEqual(inventory(binding.sourceRoot), binding.sourceEntries);
  assert.deepEqual(inventory(binding.packageRoot), binding.packageEntries);
  assert.deepEqual(inventory(binding.compilerRoot), binding.compilerEntries);
  return { candidateCommit: binding.candidateCommit, candidateTree: binding.candidateTree, sourceManifestSha256: binding.sourceManifestSha256, selectedArchiveSourceAndMovedPackageUnchangedIncludingNewEntries: true };
}
` + original.slice(end);
const oldTemp = 'mkdtempSync(`/tmp/safe-bash-author-current-safejs-${family}-`)';
assert.equal(adapted.split(oldTemp).length, 2);
adapted = adapted.replace(oldTemp, 'mkdtempSync(join(binding.work, `cohort-${family}-`))');
write("safejs-execution-v1/supervisor.mjs", adapted);
const { inventory } = await import(pathToFileURL(join(work, "harness/common.mjs")));
const node = "/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node";
const sourceRoot = join(output, "archive/src"), packageRoot = join(output, "consumer/node_modules/virtual-bash"), compilerRoot = realpathSync(join(repo, "node_modules/typescript"));
const sourceEntries = inventory(sourceRoot);
const binding = { candidateCommit: candidate, candidateTree: git("rev-parse", candidate + "^{tree}").toString().trim(), sourceRoot, sourceEntries, sourceManifestSha256: hash(JSON.stringify(sourceEntries)), packageRoot, packageEntries: inventory(packageRoot), compilerRoot, compilerEntries: inventory(compilerRoot), nodePath: node, nodeSha256: hash(readFileSync(node)), archivePath: join(output, "candidate.tar"), archiveSha256: hash(readFileSync(join(output, "candidate.tar"))), work };
write("safejs-execution-v1/PUBLIC-BINDING.json", JSON.stringify(binding, null, 2) + "\n");
const files = inventory(work).filter(entry => entry.kind === "file").map(({ path, sha256 }) => ({ path, sha256 }));
write("safejs-execution-v1/ADAPTED-INPUTS.json", JSON.stringify({ candidate, qualification: "AUTHOR_REPLAY_ONLY_NEW_CANDIDATE_BINDING_NOT_INDEPENDENT_REVIEW", originalCommit: candidate, originalFiles: originals, adaptations: ["Replace historical author release/path guard with exact committed-candidate source/archive/moved-package/compiler inventory guard", "Authenticate adapted harness before/after each cohort", "Place all cohort temp roots below this task directory"], preserved: ["All private precondition and fresh before/after snapshots", "Actual engine hooks, 63-file closure, import guard", "Frozen 25 guest/case/revision/assessor/prerequisite bytes", "Watchdog/output/heap limits, stop-on-nonpass, awaited child close"], files }, null, 2) + "\n");
const reports = [];
for (const family of ["surface", "lifecycle", "controls"]) {
  const args = [join(work, "safejs-execution-v1/supervisor.mjs"), family];
  const child = spawnSync(node, args, { cwd: work, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", GIT_OPTIONAL_LOCKS: "0", TMPDIR: join(output, "tmp") }, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  write("supervisor-" + family + ".stdout", child.stdout ?? "");
  write("supervisor-" + family + ".stderr", child.stderr ?? "");
  reports.push({ family, command: [node, ...args], status: child.status, signal: child.signal, error: child.error?.message });
  console.log(family, child.status, child.stdout?.split("\n").filter(Boolean).at(-1), child.stderr?.slice(-500));
  if (child.status !== 0) break;
}
write("SUMMARY.json", JSON.stringify({ candidate, reports, childrenSettled: reports.every(row => row.signal === null && !row.error) }, null, 2) + "\n");
if (reports.length !== 3 || reports.some(row => row.status !== 0)) process.exitCode = 1;
