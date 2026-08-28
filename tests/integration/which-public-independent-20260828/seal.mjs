import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { cwd: repository });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const revision = git("rev-parse", "HEAD").toString().trim();
const inspected = ["package.json", "package-lock.json", "src/index.ts", "src/plugins/index.ts", "tests/plugins/agent-commands.test.ts",
  "src/commands/which/index.ts", "src/commands/which/options.ts", "src/commands/which/which.ts", "src/contracts/command.ts", "src/contracts/io.ts"];
const sourceHashes = Object.fromEntries(inspected.map(filename => {
  const bytes = readFileSync(path.join(repository, filename));
  assert.deepEqual(bytes, git("show", `${revision}:${filename}`), `Dirty freeze binding: ${filename}`);
  return [filename, hash(bytes)];
}));
const metadata = JSON.parse(readFileSync(path.join(repository, "package.json"), "utf8"));
assert.equal(Object.hasOwn(metadata.exports, "./commands/which"), false, "Public subpath wiring already exists");
assert.equal(readFileSync(path.join(repository, "src/index.ts"), "utf8").includes("commands/which/"), false, "Root wiring already exists");
const plugins = readFileSync(path.join(repository, "src/plugins/index.ts"), "utf8");
assert.equal(plugins.includes("commands/which/"), false, "Aggregate wiring already exists");
assert.equal(/readonly\s+which\s*\??\s*:/.test(plugins), false, "Aggregate which option already exists");
const cases = JSON.parse(readFileSync(path.join(own, "cases.json"), "utf8"));
assert.equal(cases.expected76Provenance.sha256, sourceHashes[cases.expected76Provenance.file]);
assert.equal(cases.publicCandidate, null);
const files = ["cohort.mjs", "cases.json", "types.json", "negative-plan.json", "README.md", "seal.mjs", "verify.mjs"];
const fixtureHashes = Object.fromEntries(files.map(filename => [filename, hash(readFileSync(path.join(own, filename)))]));
const seal = { version: 1, classification: "Independent public77 pre-wiring freeze; NOT candidate execution or gate acceptance",
  sealedAt: new Date().toISOString(), inspectionRevision: revision, publicCandidate: null,
  rootBindingRequiredBeforeExecution: true, moduleCandidate: cases.moduleCandidate, moduleReview: cases.moduleReview,
  amendedB18Qualification: cases.amendedB18Qualification, families: cases.families,
  layouts: ["installed", "moved"], publicExecutionsAtSeal: 0, typeCompilationsAtSeal: 0, nativeWhichRuns: 0, executedNegativeControls: 0,
  expectedDefaultCount: 77, preservedPreviousCount: 76, excludedDefaults: ["getopts", "curl", "safejs"],
  timing: "After module implementation/review and approved selected B18 replay; before public root/subpath/aggregate wiring",
  absenceObserved: { rootReexport: true, packageSubpath: true, aggregateImport: true, aggregateOption: true },
  sourceHashes, fixtureHashes,
  limits: ["fixed76 gate unchanged", "original module25of26 unchanged", "no public/native/full-gate pass claim", "future candidate supplied only by root"] };
const filename = path.join(own, "FREEZE.json");
assert.equal(existsSync(filename), false, "Freeze is immutable");
execFileSync("apply_patch", [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${filename}\n${JSON.stringify(seal, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n` });
console.log(JSON.stringify({ inspectionRevision: revision, freezeSha256: hash(readFileSync(filename)), families: seal.families, publicCandidate: null, publicExecutions: 0 }));
