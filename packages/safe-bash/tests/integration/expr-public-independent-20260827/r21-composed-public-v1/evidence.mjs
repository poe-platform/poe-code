import assert from "node:assert/strict";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { directory, repository, owner, read, json, digest, put, putJson } from "./common.mjs";
import { auditArchive, fileHash } from "./archive.mjs";

export async function seal(commit, outer) {
  const optional = name => existsSync(join(directory, name)) ? json(join(directory, name)) : undefined;
  const report = optional("REPORT.json"), bindings = json(join(directory, "BINDINGS.json"));
  let audit, error, channels = 0, moduleLoads = 0;
  try {
    audit = await auditArchive(directory);
    const manifest = optional("MANIFEST.json");
    const entry = name => { const row = manifest.entries.find(row => row.path === name); assert.ok(row, name); return row; };
    const raw = name => { const bytes = read(join(directory, "work/run-001/raw", name)); assert.equal(bytes.length, entry(name).bytes); assert.equal(digest(bytes), entry(name).sha256); return bytes; };
    for (const child of report.children) {
      assert.equal(child.closed, true); assert.equal(child.naturalSettlement, true);
      assert.deepEqual(JSON.parse(raw(`${child.name}.json`)), child);
      for (const channel of ["stdout", "stderr"]) { const output = child.output[channel], row = entry(`${child.name}.${channel}.raw`); assert.equal(output.bytes, row.bytes); assert.equal(output.sha256, row.sha256); channels++; }
      const loads = raw(`${child.name}.stderr.raw`).toString().split("\n").filter(line => line.startsWith("EXPR_MAIN_LOAD ")).map(line => JSON.parse(line.slice(15)));
      const binding = JSON.parse(raw(`binding-${child.name.startsWith("moved-") ? "moved" : "installed"}.json`));
      for (const load of loads) { assert.equal(load.sha256, binding.expected[load.path]); moduleLoads++; }
    }
    for (const row of [...report.targets, ...report.controls].filter(row => row.record)) {
      const actual = JSON.parse(raw(`${row.record.receipt}.stdout.raw`));
      const { actualLoads, receipt, label, ...record } = row.record;
      assert.deepEqual(actual, record);
      const loads = raw(`${receipt}.stderr.raw`).toString().split("\n").filter(line => line.startsWith("EXPR_MAIN_LOAD ")).map(line => JSON.parse(line.slice(15)));
      assert.deepEqual(actualLoads, loads);
    }
  } catch (caught) { error = caught.stack; }
  const qualified = !error && outer.exitCode === 0 && report?.status === "TARGETS_QUALIFIED" && optional("POST-BINDINGS.json")?.status === "pass";
  const obligation = (id, count, evidence, scope, exclusions) => ({ id, count, evidence, scope, exclusions });
  const oldSeal = json(join(repository, owner, "component-execution-v5/EVIDENCE-SEAL.json"));
  const oldManifest = json(join(repository, owner, "component-execution-v5/MANIFEST.json"));
  const targetedSeal = json(join(repository, owner, "r21-n04-reconciliation-v1/EVIDENCE-SEAL.json"));
  const matrix = {
    schema: "expr-composed-public-qualification/1", authorizationDate: "2026-08-28", status: qualified ? "COMPOSED_PUBLIC_QUALIFIED" : "HELD", recipeCommit: commit,
    recipeManifestSha256: digest(read(join(directory, "RECIPE-SEAL.json"))), bindingsSha256: digest(read(join(directory, "BINDINGS.json"))),
    scope: "Exact Expr candidate/full package public integration release prerequisite only", sourceAndPackageBindings: bindings,
    counts: report?.counts, composed: qualified ? { runtimeCaseGroups: { retained: 100, amended: 4, covered: 104, amendedBoundaryOutcomes: 16 }, typeOutcomes: { retained: 32, separatelyAcceptedTargeted: 8, covered: 40 }, packageControlsRetained: 36 } : null,
    obligations: [
      obligation("R01-R20,R22-R26", 100, bindings.refs.v5, "Four actual layouts; retained success IDs enumerated in bindings.retained", "No replay; original4 R21 failures unchanged"),
      obligation("R21 versioned split", qualified ? 4 : 0, { recipe: commit, manifest: digest(read(join(directory, "MANIFEST.json"))), records: "REPORT.json targets; raw channels/receipts" }, "16 independently executed outcomes across4 layouts", "Not old R21 rescore; no native-NUL parity"),
      obligation("Retained public types", 32, bindings.refs.v5, "Original successful positive/negative/exact-code declaration outcomes", "Original N04/combined8 failures unchanged"),
      obligation("Accepted N04/combined amendment", 8, bindings.refs.targeted, "Exact TS2561 at11:32 with field/type/suggestion and all other diagnostics, flags, source input unchanged; four actual layouts", "Distinct accepted target outcomes; no new types/no v5 all-green replay"),
      obligation("P01", 1, bindings.P01, "Accepted independent v4 build357 complete Git inputs,834 members727526 bytes", "Bound, not rebuilt/repacked; author archive not independent full-archive build"),
      obligation("R25/R26", 8, bindings.refs.v5, "Both cases all4 layouts; exec-only worker retirement BEFORE dispose; both cancellation boundaries+sibling", "No rerun; module engine not reaudited"),
      obligation("Package/public wiring", 36, bindings.refs.v5, "Root/subpath identity/types, exact76 membership, global regex/top replacement, optional curl/SafeJS excluded from defaults", "Membership is not all76 behavior"),
      obligation("Retained reader/repair/trace controls", { reader: 16, repair: 28, trace: 38 }, { reader: bindings.previous.reader, repair: bindings.previous.repair, trace: bindings.refs.v5 }, "Distinct previously qualified controls", "No new controls/replay inferred"),
      obligation("Retained targeted controls", 72, bindings.refs.targeted, "Observer/validator/TRACE/resolution/guard controls;8 accepted type outcomes;16 old observations not scored", "Not new R21 scoring or new execution"),
      obligation("Accepted DU75 prerequisite", 29, bindings.DU, "Root-accepted22+7;19 original runtime cases each source/moved;T03 TS2322 leaf,T04/T05 root;22 focused controls23 guards", "Not ancestry/membership as acceptance; old rejections unrescored; distinct DU pack"),
      obligation("New boundary/validator controls", report?.counts.controlsPass ?? 0, { recipe: commit, raw: "MANIFEST.json", report: "REPORT.json controls" }, "8 valid dispatch+4 loader guards+52 actual-receipt validator controls", "Harness mutations are not product outcomes"),
      obligation("Separate HTML74 acceptance", null, { rootConveyedCandidate: "aff9d849033", authority: "root delegation; not independently expanded or reverified here" }, "Separate accepted prerequisite retained by root", "No HTML build/rerun or newly claimed acceptance proof"),
    ],
    retainedClosure: { v5: { counts: oldSeal.counts, controls: oldSeal.controls, rawCounts: oldManifest.counts, observedWorkers: 80, rawEntries: oldManifest.entries.length }, targeted: targetedSeal.audit },
    audit: { ...audit, channels, moduleLoads, error }, outer,
    releasePrerequisiteProofsSatisfied: qualified, releaseExecuted: false, fullGate: false, original104or40Replay: false, historicalRescore: false,
    remaining: qualified ? ["Curie/Dirac coordinator acceptance and separate release/full-gate driver remain outside this qualification", "Separate shell/cancellation.ts lifecycle scope is not TEMP acceptance"] : ["New attempt failure or missing dependent proof; no retry or waiver"],
  };
  putJson(join(directory, "MATRIX.json"), matrix);
  put(join(directory, "CHECKPOINT.md"), `# ${matrix.status}\n\nAuthorization August 28, 2026. Recipe ${commit}; manifest ${matrix.recipeManifestSha256}.\n\nNew counts: ${JSON.stringify(report?.counts ?? {})}.\n\nComposed runtime100 retained+4 corrected R21 groups backed16 independent outcomes; types32 retained+8 separately accepted N04/combined outcomes. Package36 retained. This is NOT an original104/40 all-green replay. Old v5 outer1/HOLD, failures and original R21 remain unchanged. No new type/build/DU/HTML/R25/R26/full-cohort execution.\n\nP01 accepted independent357-input v4 build; exact candidate ${bindings.candidate}, tree ${bindings.tree}, source ${bindings.integrationSource}, engine ${bindings.acceptedEngine}. Pack ${bindings.P01.actualPackSha256},727526 bytes834 members. Author archive ${bindings.authorArchive.sha256},${bindings.authorArchive.bytes} bytes is bound admission-era author evidence, not independent full-archive build proof. Approved independent profile is complete357 selected Git objects/tool closure/mode/hash/new-entry guards.\n\nDU acceptance SATISFIED: root22+7=29, selected base ${bindings.DU.selectedBase}, freeze ${bindings.DU.freeze}, distinct pack ${bindings.DU.pack.sha256},726693 bytes834 members. Binding ${bindings.refs.du.commit}. All detailed source/archive/pack/recipe/seal bindings and obligation-level immutable evidence are in MATRIX.json and BINDINGS.json.\n\nNatural outer=${outer.naturalSettlement}; new raw audit=${audit?.status}; channels=${channels}; actual main-load hashes=${moduleLoads}. Actual time ${outer.startedAt} to ${outer.finishedAt}; no72-hour claim. New-entry checks are finite, not leases. Full raw and receipts preserved before assertions/exit.\n\nPublic release-prerequisite proof satisfied=${qualified}. No release/Dirac/fullgate executed; no76-command behavior, superiority, TEMP or engine reaudit claim. Root's separate HTML74 acceptance is retained, not reverified. ${error ? `Failure: ${error}` : "No remaining blocker within this composed public-integration scope."}\n`);
  const names = ["RECIPE-SEAL.json", "BINDINGS.json", "EXECUTION.raw.txt", "PRE-BINDINGS.json", "POST-BINDINGS.json", "REPORT.json", "OUTER.json", "MANIFEST.json", "RAW.jsonl.gz", "MATRIX.json", "CHECKPOINT.md"];
  const artifacts = [];
  for (const path of names) if (existsSync(join(directory, path))) artifacts.push({ path, mode: lstatSync(join(directory, path)).mode & 0o777, ...await fileHash(join(directory, path)) });
  const result = { schema: "expr-composed-evidence-seal/1", recipe: commit, recipeManifestSha256: matrix.recipeManifestSha256, qualified, counts: report?.counts, audit: matrix.audit, artifacts };
  putJson(join(directory, "EVIDENCE-SEAL.json"), result); return result;
}
