import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: owned, encoding: "utf8" }).trim();
const source = "246aa440c988d6c09464480956c4eff69009f7e4";
const designCommit = "47309c0be322f685431e2b6579edd86d56b79fdd";
const designRelative = "tests/commands/expr-stress/named-profile-design-20260827";
const design = join(root, designRelative);
assert.equal(process.argv.length, 3, "explicit new output basename required; no default evidence writes");
const basename = process.argv[2];
assert(/^[a-z0-9][a-z0-9-]+$/u.test(basename));
const output = resolve(owned, basename);
await mkdir(output);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (path, value) => writeFile(join(output, path), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function inventory(directory, prefix = "") {
  const entries = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) entries.push({ path, kind: "directory" }, ...await inventory(join(directory, entry.name), path));
    else {
      assert(entry.isFile(), `unexpected entry ${path}`);
      entries.push({ path, kind: "file", sha256: hash(await readFile(join(directory, entry.name))) });
    }
  }
  return entries;
}
const historyBytes = await readFile(join(design, "HISTORICAL10.json"));
await writeFile(join(output, "historical10.json"), historyBytes, { flag: "wx" });
const baselineReceipt = await readFile("/tmp/expr-named-profile-author-20260827-candidate.txt");
await writeFile(join(output, "blocked-baseline-receipt.txt"), baselineReceipt, { flag: "wx" });
const authenticatedDesign = await inventory(design);
execFileSync("git", ["diff", "--exit-code", designCommit, "--", designRelative], { cwd: root });
const verified = execFileSync(process.execPath, [join(design, "verify.mjs")], { cwd: root, encoding: "utf8", timeout: 60_000 });
await writeFile(join(output, "design-authentication.json"), verified, { flag: "wx" });
const shared = ["tests/commands/regex-execution/executor.test.ts", "tests/commands/regex-execution/commands.test.ts",
  "tests/commands/regex-execution/cleanup-registration/controls.test.ts"];
const paths = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "tests/commands/expr",
  "tests/commands/expr-author/regex-audit-cases.ts", ...shared];
const archive = execFileSync("git", ["archive", source, ...paths], { cwd: root, maxBuffer: 32_000_000 });
const work = await mkdtemp(join(owned, ".work-"));
const commands = [];
function execute(name, command, args, expectedStatus = 0, env = process.env) {
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: work, encoding: "utf8", timeout: 120_000, maxBuffer: 16_000_000, env });
  const observation = { name, command, args, started, finished: new Date().toISOString(), status: result.status,
    signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
  commands.push(observation);
  assert.equal(result.error, undefined, name);
  assert.equal(result.status, expectedStatus, `${name}: ${result.stderr}\n${result.stdout?.slice(-2000)}`);
  return result.stdout;
}
const counts = text => Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
try {
  execFileSync("tar", ["-x", "-f", "-", "-C", work], { input: archive });
  const before = await inventory(work);
  const gitInputs = execFileSync("git", ["ls-tree", "-r", "--name-only", source, "--", ...paths], { cwd: root, encoding: "utf8" }).trim().split("\n");
  for (const path of gitInputs) assert.equal(hash(await readFile(join(work, path))), hash(execFileSync("git", ["show", `${source}:${path}`], { cwd: root, maxBuffer: 8_000_000 })), path);
  await save("setup.json", { source, paths, archiveSha256: hash(archive), inputs: before, designCommit,
    harness: await Promise.all(["capture.mjs", "runtime.mjs"].map(async path => ({ path, sha256: hash(await readFile(join(owned, path))) }))) });
  const tsc = join(root, "node_modules/.bin/tsc");
  execute("build", tsc, ["-p", "tsconfig.build.json"]);
  const distBefore = await inventory(join(work, "dist"));
  execute("expr-types", tsc, ["-p", "tests/commands/expr/tsconfig.json"]);
  execute("shared-types", tsc, ["--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--lib", "ES2023", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node", ...shared]);
  const named = execute("named-tests", process.execPath, ["--import", "tsx", "--test", "tests/commands/expr/named-profile.test.ts"]);
  const legacyFiles = (await readdir(join(work, "tests/commands/expr"))).filter(path => path.endsWith(".test.ts")
    && !["named-profile.test.ts", "native.test.ts", "regex-native.test.ts"].includes(path)).sort().map(path => `tests/commands/expr/${path}`);
  const legacy = execute("legacy-nonnative-tests", process.execPath, ["--import", "tsx", "--test", ...legacyFiles], 1);
  const failures = [...legacy.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(failures, ["unsupported locales and unrepresentable argv are explicit errors"]);
  assert.equal(counts(legacy).fail, 1);
  const sharedOutput = execute("shared-tests", process.execPath, ["--import", "tsx", "--test", ...shared]);
  const overlap = execute("overlap-tests", process.execPath, ["--import", "tsx", "--test", "tests/commands/expr/contracts.test.ts", "tests/commands/expr/regex-limits.test.ts", "tests/commands/expr/regex-lifecycle.test.ts"], 1);
  const runtime = [];
  for (const locale of ["C", "en_US.UTF-8"]) {
    const text = execute(`runtime-${locale}`, process.execPath, [join(owned, "runtime.mjs"), work, design], 0, { ...process.env, LC_ALL: locale, LANG: locale });
    const observed = JSON.parse(text);
    await save(`runtime-${locale === "C" ? "C" : "named"}.json`, observed);
    runtime.push({ locale, scalarSuccesses: observed.scalarSuccesses.length, continuedCollationRefusals: observed.continuedCollationRefusals.length,
      admissionControls: observed.admissionControls.length, defaultControls: observed.defaultControls.length, cleanup: observed.cleanup });
  }
  const after = (await inventory(work)).filter(entry => entry.path !== "dist" && !entry.path.startsWith("dist/"));
  assert.deepEqual(after, before, "complete archived input inventory detects edits, removals and added entries");
  assert.deepEqual(await inventory(join(work, "dist")), distBefore, "built output inventory remains unchanged");
  assert.deepEqual(await inventory(design), authenticatedDesign, "complete independent design pre/post inventory");
  const toolchain = { node: process.version, platform: process.platform, arch: process.arch,
    typescript: JSON.parse(await readFile(join(root, "node_modules/typescript/package.json"), "utf8")).version,
    tsx: JSON.parse(await readFile(join(root, "node_modules/tsx/package.json"), "utf8")).version };
  await save("inputs.json", { source, paths, archiveSha256: hash(archive), inputs: before, built: distBefore, designCommit,
    authenticatedDesign, historySha256: hash(historyBytes), blockedBaselineReceiptSha256: hash(baselineReceipt), toolchain,
    harness: await Promise.all(["capture.mjs", "runtime.mjs"].map(async path => ({ path, sha256: hash(await readFile(join(owned, path))) }))) });
  await save("summary.json", { source, designCommit, toolchain, named: counts(named), legacyNonnative: counts(legacy), shared: counts(sharedOutput),
    overlapSubsetNotAdditive: counts(overlap), expectedStaleFailure: { path: "tests/commands/expr/contracts.test.ts", line: 40, failures }, runtime,
    historical10: "Preserved separately unchanged; not relabeled as new passes.",
    native: "No native execution or recapture. native.test.ts and regex-native.test.ts are outside this explicitly nonnative scope, not skipped tests.",
    redOutputCap: "Separate unresolved contract at 0a86a4b43fc9173d0cd6bb49da93bf77f0d4bdd6; no cap or output-contract wording edits.",
    integrity: { archiveInputPrePostComplete: true, detectsAddedEntries: true, builtOutputPrePostComplete: true, designPrePostComplete: true,
      liveSourcesOverlaid: false, unrelatedLiveEditsVetoArchive: false }, independentFinalReview: "Pending separate reviewer" });
} finally {
  await save("commands.json", commands);
  await rm(work, { recursive: true, force: true });
}
console.log(JSON.stringify({ output, source, status: "captured; expected stale canonical assertion remains a failure" }));
