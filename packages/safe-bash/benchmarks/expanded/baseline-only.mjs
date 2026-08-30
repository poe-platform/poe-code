import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { hash } from "./common.mjs";

const root = resolve("benchmarks/reports/expanded-20260827");
const reportBytes = await readFile(join(root, "corrected-bd2cacb/report.json"));
const functionalBytes = await readFile(join(root, "corrected-bd2cacb/functional.json"));
const report = JSON.parse(reportBytes), functional = JSON.parse(functionalBytes);
const aliases = new Map([[".", "dot"]]);
const rows = report.inventory.baselineOnlyNames.map(name => {
  const targets = functional.filter(row => row.command === name || row.command === aliases.get(name));
  return {
    name,
    baselineRegistered: report.inventory.baseline.registered.includes(name),
    baselineKernel: report.inventory.baseline.kernel.includes(name),
    declaredInFrozenVirtualInventory: report.inventory.virtual.union.includes(name),
    coverage: targets.length ? "bounded-primary-recipe" : "not-measured",
    recipes: targets.map(row => ({
      id: row.id,
      optionFamily: row.optionFamily,
      oracleValid: row.expected.oracleValid,
      recipeHash: row.expected.recipeHash,
      virtual: row["virtual-bash"].status,
      baseline: row["just-bash"].status,
    })),
  };
});
assert.equal(rows.length, 53);
assert.deepEqual(rows.filter(row => row.recipes.length).map(row => row.name), [".", "eval", "source"]);
assert.ok(rows.every(row => !row.declaredInFrozenVirtualInventory));
const covered = rows.flatMap(row => row.recipes);
assert.equal(covered.length, 3);
assert.ok(covered.every(row => row.oracleValid && row.virtual === "fail" && row.baseline === "pass"));
const output = resolve(process.argv[2] ?? join(root, "baseline-only-frozen"));
await mkdir(output);
const matrix = {
  capturedAt: new Date().toISOString(),
  scope: "Frozen expanded224 coverage ledger, not a new execution or current-runtime claim",
  revision: report.revision,
  harnessRevision: report.harnessRevision,
  baseline: report.baseline,
  evidence: { reportSha256: hash(reportBytes), functionalSha256: hash(functionalBytes) },
  totals: { names: rows.length, namesWithPrimaryRecipes: 3, unmeasuredNames: 50, recipes: 3, virtualPass: 0, virtualFail: 3, baselinePass: 3, baselineFail: 0 },
  limitations: [
    "Only explicitly targeted primary recipes count; incidental token appearances are not coverage.",
    "The dot recipe is explicitly mapped to the '.' dispatch name, not treated as an absent command.",
    "Fifty unmeasured names are neither passes nor failures and remain outside the224 recipe denominator.",
    "A passing recipe does not establish complete flags, aliases, limits or command semantics.",
    "Later source/dot/eval implementation and dirty author tests do not rewrite this frozen cohort.",
    "A separate native-backed baseline-led functional expansion and distinct fairness review remain required.",
  ],
  rows,
};
await writeFile(join(output, "matrix.json"), `${JSON.stringify(matrix, null, 2)}\n`, { flag: "wx" });
const table = rows.map(row => `| ${row.name} | ${[row.baselineRegistered && "registry", row.baselineKernel && "kernel"].filter(Boolean).join("+")} | ${row.recipes.map(recipe => recipe.id).join(", ") || "not measured"} | ${row.recipes.length ? "0/1" : "—"} | ${row.recipes.length ? "1/1" : "—"} |`).join("\n");
await writeFile(join(output, "README.md"), `# Distinct baseline-only coverage matrix\n\nFrozen source ${report.revision}; just-bash3.4.2. This is an extraction of\nexisting observations, **not** a new comparison or current implementation claim.\n\n53 names are baseline-only in that frozen inventory. Three have one native-backed\nprimary recipe each: ours0/3, baseline3/3. The remaining50 names are unmeasured,\nnot passing, unsupported-by-test or removed from the full product goal.\nThe224 denominator and all original scores remain unchanged.\n\n| Name | Baseline dispatch | Primary recipe | Ours passes | Baseline passes |\n|---|---|---|---|---|\n${table}\n\nNo option-completeness claim follows from any name. Dot maps explicitly to '.'.\nLater source/dot/eval work requires its own accepted cohort. Incidental script\ntokens are not treated as tested workflows. Baseline-led native recipe expansion\nand different-agent fairness review remain pending; this matrix makes the\nselection gap explicit rather than manufacturing observations for missing rows.\n\nReproduce into a new directory with node benchmarks/expanded/baseline-only.mjs PATH.\nMachine-readable evidence includes hashes of the two immutable input reports.\n`, { flag: "wx" });
console.log(JSON.stringify({ output, ...matrix.totals }, null, 2));
