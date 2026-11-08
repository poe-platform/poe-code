import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { git, inventory, location, owned, readJson, repository, save, sha, status } from "./common.mjs";

const work = readFileSync(location, "utf8").trim();
const manifest = readJson(join(work, "manifest.json"));
const result = readJson(join(repository, owned, "RESULT.json"));
const validation = readJson(join(repository, owned, "VALIDATION.json"));
const archiveBytes = readFileSync(join(repository, owned, "EVIDENCE.json"));
assert.equal(sha(archiveBytes), readJson(join(repository, owned, "ARCHIVE-CHECK.json")).sha256);
for (const member of Object.values(JSON.parse(archiveBytes).files)) {
  const bytes = gunzipSync(Buffer.from(member.gzipBase64, "base64"));
  assert.equal(bytes.length, member.bytes);
  assert.equal(sha(bytes), member.sha256);
}
const evidencePaths = Object.keys(manifest.inputs).filter(path => !path.startsWith("src/"));
assert.deepEqual(inventory(repository, evidencePaths), Object.fromEntries(Object.entries(manifest.inputs).filter(([path]) => evidencePaths.includes(path))));
for (const [path, record] of Object.entries(manifest.accepted)) assert.equal(sha(readFileSync(join(repository, path))), record.expected, `accepted source changed: ${path}`);
const unownedIndex = () => git("ls-files", "--stage", "-z").toString().split("\0").filter(record => record && !record.slice(record.indexOf("\t") + 1).startsWith(`${owned}/`)).sort();
const before = unownedIndex();
const auditPath = join(repository, owned, "FINAL-AUDIT.json");
const scripts = readdirSync(join(repository, owned)).filter(name => name.endsWith(".mjs")).sort();
for (const script of scripts) execFileSync(process.execPath, ["--check", join(repository, owned, script)], { cwd: repository });
const audit = { at: new Date().toISOString(), headBefore: git("rev-parse", "HEAD").toString().trim(), exactAcceptedSourceStillMatches: true, originalFixturesAndHelpersStillUnchanged: true, archiveMembersRechecked: Object.keys(JSON.parse(archiveBytes).files).length, syntaxCheckedScripts: Object.fromEntries(scripts.map(name => [name, sha(readFileSync(join(repository, owned, name)))])), unownedIndexBeforeSha256: sha(JSON.stringify(before)), sourceAtClosure: inventory(repository, ["src"]), liveStatusBeforeCommit: git("status", "--short").toString(), fullRevised: result.full.cohorts[0].totals, fullOriginalCurrentReplay: result.full.cohorts[1].totals, correctedFive: result.five.results[0], originalCurrentFive: result.five.results[1], noEmit: validation.scoped.status, isolatedBuild: validation.build.status };
save(auditPath, audit);
const paths = readdirSync(join(repository, owned)).sort().map(name => {
  const path = `${owned}/${name}`;
  assert(lstatSync(join(repository, path)).isFile(), `non-file owned artifact ${path}`);
  return path;
});
save(join(work, "commit-before.json"), { paths, unownedIndex: before, audit });
git("add", "--", ...paths);
git("diff", "--cached", "--check", "--", ...paths);
const commitOutput = git("commit", "--only", "-m", "test(diff-patch): verify quiet corrected profile and full regression gate", "--", ...paths).toString();
const commit = git("rev-parse", "HEAD").toString().trim();
assert.deepEqual(git("diff-tree", "--no-commit-id", "--name-only", "-r", commit).toString().trim().split("\n").sort(), paths);
const after = unownedIndex(), indexPreserved = JSON.stringify(before) === JSON.stringify(after);
const ownedStatus = git("status", "--porcelain=v1", "--", owned).toString();
save(join(work, "commit-closure.json"), { commit, command: ["git", "commit", "--only", "-m", "test(diff-patch): verify quiet corrected profile and full regression gate", "--", ...paths], commitOutput, paths, indexPreserved, beforeSha256: sha(JSON.stringify(before)), afterSha256: sha(JSON.stringify(after)), ownedStatus });
assert(indexPreserved, "unowned index changed across commit; inspect concurrent worker activity");
assert.equal(ownedStatus, "");
const finalText = [
  "CLOSED: independent quiet-postfix leaf verifier; no delegated agents or owned running workers.",
  `Evidence commit: ${commit}`,
  `Report: ${owned}/REPORT.md`,
  "CURRENT corrected five: 5/5 exact. CURRENT old-profile replay: 4/5 exact. Historical original five4/5 remains unchanged.",
  "Both five-row native recaptures match their respective frozen native rows5/5. Sole old-profile difference: native dry-run /fixture/tmp directory. No product workaround.",
  "CURRENT revised full: 3758/3758, exit0. CURRENT unchanged original: 3750/3758, exit1, exact same eight original conflicts.",
  "Each completed full run:70 files/17 suites; no skips/cancellations/todos or changed names. 7516 completed full-cohort executions, separately counted.",
  "Retained first capture failure:3 events (2 native pass,1 loader failure); omitted benchmarks/session.js resolved by adding7 unchanged helper bytes, all equal5ce557d, to a fresh snapshot. Not a product failure or silent helper substitution.",
  `Accepted patch: ${manifest.commits["96564fe"]}; patch.ts SHA256 ${manifest.accepted["src/commands/diff-patch/patch.ts"].expected}`,
  `Accepted stat: ${manifest.commits["386196b"]}; stat.ts SHA256 ${manifest.accepted["src/commands/metadata/stat.ts"].expected}`,
  `Corrected profile: ${manifest.commits.d1b10a3}; exact helpers and native hashes in INPUT-MANIFEST/FIVE/EVIDENCE.`,
  `Frozen actual current source aggregate: ${manifest.sourceAggregate}; source bytes in EVIDENCE. Moving live tree drift is separate in RESULT/FINAL-AUDIT.`,
  `Scoped noEmit exit0 command: ${validation.scoped.command.join(" ")}`,
  `Isolated build exit0 command: ${validation.build.command.join(" ")}`,
  `Validation cwd: ${validation.scoped.cwd}; no live source/tests/root-dist emissions, no whole-repository noEmit.`,
  `Exact cohort commands/environment/raw TAP/JSONL are in EVIDENCE complete-replay/logs; launcher commands in ${owned}/REPORT.md.`,
  `Archive SHA256: ${sha(archiveBytes)};788 members roundtrip/SHA checked. No native binaries or large fixture trees committed.`,
  `Commit includes only ${paths.length} explicit owned new paths. Owned git status clean; unrelated index preserved: ${indexPreserved}.`,
  "Production/existing tests/benchmarks/old evidence untouched; unrelated native artifacts untouched. No dependencies added, no table corpus, no new tools.",
  "All owned engine processes: IPC disconnect, exit0/signalnull. Suite/compiler processes signalnull. No SIGSTOP or verifier-sent signals.",
  "Original old-five4/5, frozen eighteen failures, historical3750/3758 and3758/3758, SGID non-resolution, unsupported remote and outside-contract overlay observations remain separate/unchanged.",
  `Temporary evidence and commit/index closure: ${work}`,
].join("\n") + "\n";
writeFileSync("/tmp/safe-bash-quiet-postfix-review-result.txt", finalText);
status(`CLOSED ${commit}\nCorrected CURRENT5/5; original-profile CURRENT4/5; historical old-five4/5 unchanged.\nRevised3758/3758; original-current3750/3758 with original8 conflicts. Scoped noEmit/build0.\nOwned paths clean; unowned index preserved; all workers closed normally; no product/existing-evidence changes.\nFull result /tmp/safe-bash-quiet-postfix-review-result.txt`);
console.log(commitOutput);
