import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { execute, historical, inventory, location, readJson, save, sha, status } from "./common.mjs";

const work = readFileSync(location, "utf8").trim(), manifest = readJson(join(work, "manifest.json"));
const { snapshot, original237, original70, groups } = manifest;
const revised = join(work, "snapshot-revised");
cpSync(snapshot, revised, { recursive: true, verbatimSymlinks: true });
const { applyDelta, changes } = await import(pathToFileURL(join(snapshot, "tests/commands/diff-patch-stress/gnu-revised-full/delta-v1.mjs")).href);
const preparation = readJson(join(snapshot, "tests/commands/diff-patch-stress/gnu-revised-full-review/native-preparation.json"));
const proof = { exact: preparation.observations.filter(item => item.dialect === "gnu").slice(0, 8).map(item => ({ name: item.fixture.name, ...item })) };
const delta = applyDelta(revised, original237, proof);
save(join(work, "applied-unchanged-delta.json"), delta);
const revisedInputs = inventory(revised, Object.keys(manifest.inputs));
assert.deepEqual(Object.keys(manifest.inputs).filter(path => manifest.inputs[path].sha256 !== revisedInputs[path].sha256).sort(), changes.map(change => change.file).sort());
save(join(work, "revised-inputs.json"), revisedInputs);
const parseEvents = path => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const census = (events, root) => events.filter(event => ["test:pass", "test:fail"].includes(event.type)).map(event => ({ name: event.data.name, file: relative(root, event.data.file ?? ""), nesting: event.data.nesting })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
const boundaries = [];
function boundary(name, root, expected) {
  assert.deepEqual(inventory(root, Object.keys(expected)), expected, `${name}: input mutation`);
  assert.deepEqual(inventory(root, ["node_modules"]), manifest.dependencies, `${name}: dependency mutation`);
  boundaries.push({ name, at: new Date().toISOString(), inputs: sha(JSON.stringify(expected)), source: manifest.sourceAggregate, dependencies: sha(JSON.stringify(manifest.dependencies)) });
  save(join(work, "full-boundaries.json"), boundaries);
}
const pinArgs = ["--import", "tsx", "--input-type=module", "-e", "import {oracleIdentity} from './tests/commands/diff-patch-stress/gnu-target/oracle.ts';console.log(JSON.stringify(['gnu','apple-calibration'].flatMap(profile=>['diff','patch'].map(tool=>({profile,tool,...oracleIdentity(tool,profile)})))));"];
const pinsBefore = execute(work, snapshot, "full-pins-before", pinArgs);
assert.equal(pinsBefore.status, 0);
const pins = readJson(pinsBefore.stdout.path);
save(join(work, "full-native-pins.json"), pins);
const cohorts = [];
for (const profile of [{ name: "revised", root: revised, expected: revisedInputs }, { name: "original-current-replay", root: snapshot, expected: manifest.inputs }]) {
  const suites = [];
  status(`Running ${profile.name}: unchanged full3758, 70 files / 17 suites, existing GNU pins and local backends. No filtering/skips. Corrected-five results retained separately.`);
  for (const [name, files] of Object.entries(groups)) {
    boundary(`${profile.name}-${name}:before`, profile.root, profile.expected);
    const eventPath = join(work, "logs", `${profile.name}-${name}.events.jsonl`);
    const execution = execute(work, profile.root, `${profile.name}-${name}`, ["--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", "--test-reporter-destination=stdout", `--test-reporter=./${historical}/reporter.mjs`, `--test-reporter-destination=${eventPath}`, ...files]);
    boundary(`${profile.name}-${name}:after`, profile.root, profile.expected);
    const tap = readFileSync(execution.stdout.path, "utf8");
    const counts = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(key => {
      const matches = [...tap.matchAll(new RegExp(`^# ${key} (\\d+)$`, "gmu"))];
      assert.equal(matches.length, 1, `${profile.name}/${name} TAP total ${key}`);
      return [key, Number(matches[0][1])];
    }));
    const events = parseEvents(eventPath), names = census(events, profile.root);
    const oldNames = census(parseEvents(join(work, "historical", `${name}.events.jsonl`)), manifest.historicalResult.snapshot);
    const failures = events.filter(event => event.type === "test:fail").map(event => ({ name: event.data.name, file: relative(profile.root, event.data.file), details: event.data.details }));
    const result = { name, files, ...counts, failures, censusSha256: sha(JSON.stringify(names)), historicalCensusSha256: sha(JSON.stringify(oldNames)), execution };
    suites.push(result);
    save(join(work, `${profile.name}-suites.json`), suites);
    if ((profile.name === "revised" && counts.fail > 0) || counts.tests !== manifest.historicalResult.suites.find(suite => suite.suite === name).tests) status(`MEANINGFUL FAILURE: ${profile.name}/${name}, ${counts.pass}/${counts.tests}, failures ${counts.fail}. Exact raw logs: ${execution.stdout.path} and ${execution.stderr.path}. No changes or helper substitutions made.`);
    assert.equal(events.filter(event => event.type === "test:pass").length, counts.pass);
    assert.equal(failures.length, counts.fail);
    assert.equal(counts.tests, counts.pass + counts.fail);
    assert.equal(counts.skipped + counts.cancelled + counts.todo, 0);
    assert.deepEqual(names, oldNames, `case census/loader issue in ${profile.name}/${name}; request narrow matching-helper replay, do not substitute`);
    assert.equal(execution.status, counts.fail ? 1 : 0);
    console.log(JSON.stringify({ profile: profile.name, suite: name, ...counts }));
  }
  const totals = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(key => [key, suites.reduce((sum, suite) => sum + suite[key], 0)]));
  assert.equal(totals.tests, 3758);
  const cohort = { name: profile.name, snapshot: profile.root, totals, suites, actualTestFiles: Object.keys(original70).length, actualSuites: suites.length, rawAggregateExitCode: suites.some(suite => suite.execution.status !== 0) ? 1 : 0 };
  cohorts.push(cohort);
  save(join(work, `${profile.name}-full.json`), cohort);
}
const pinsAfter = execute(work, snapshot, "full-pins-after", pinArgs);
assert.equal(pinsAfter.status, 0);
assert.deepEqual(readJson(pinsAfter.stdout.path), pins);
const summary = { cohorts: cohorts.map(({ name, totals, rawAggregateExitCode }) => ({ name, totals, rawAggregateExitCode })), unchangedTestNames: true, original70HashesUnchanged: true, original237HashesUnchanged: true, revisedDelta: delta, pinsStable: true, historicalOriginal: { tests: 3758, pass: 3750, fail: 8 }, historicalRevised: { tests: 3758, pass: 3758, fail: 0 }, sgidResolution: false, unsupportedRemoteUnchanged: "S3/WebDAV ENOTSUP remains safe refusal, not support", overlayOutsideContractUnchanged: { pass: 0, fail: 3, rerun: false } };
save(join(work, "full-summary.json"), summary);
status(`Full revised: ${cohorts[0].totals.pass}/3758; separate original-current replay: ${cohorts[1].totals.pass}/3758. No skips, filters, cancellations, expectation changes beyond unchanged accepted delta. Native pins/input boundaries stable. noEmit/build pending.`);
