import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { author, repository, hash } from './authenticate.mjs';

export function adapted() {
  const original = readFileSync(join(repository, author, 'recipe/coordinator.mjs'), 'utf8');
  let text = original;
  const changes = [];
  function replace(before, after, reason) {
    assert.equal(text.split(before).length, 2, before);
    text = text.replace(before, after);
    changes.push({ before, after, reason });
  }
  for (const name of ['authenticate', 'telemetry', 'terminal-predicate', 'bindings', 'aggregation']) replace(`from "./${name}.mjs"`, `from "../../html-public-independent-20260827/admission-v3.2/recipe/${name}.mjs"`, 'Import exact authenticated original module, not a copied/adapted hash.');
  replace('import { runSyntheticControls } from "./synthetic-controls.mjs";\n', '', '28 synthetic controls remain static-only; authorized execution is five real cases only.');
  replace('import { runForwardingControls } from "./forwarding-controls.mjs";\n', '', 'Six forwarding cohorts and eight ordered synthetic predicates remain static-only.');
  replace('const owned = resolve(here, "..");', 'const owned = resolve(repository, "tests/integration/html-public-admission-resource-v32-independent-20260827");', 'Relocate only output authority into reviewer-owned scope.');
  replace('const synthetic = runSyntheticControls(output, policy);\nconst forwarding = await runForwardingControls(output, policy, () => intactBindings(freeze, manifestSha));\n', '', 'Do not execute unauthorized precontrol families or fabricate their passes.');
  replace('runIndependent(forwarding.safe ? policy.controls : [],', 'runIndependent(policy.controls,', 'Select exactly the unchanged five real cases, preserving runIndependent safety/aggregation.');
  replace('summary.synthetic = synthetic;\nsummary.forwarding = forwarding;', 'summary.independentScope = { synthetic: "not executed; static-only", forwarding: "not executed; static-only", orderedSynthetic: "not executed; static-only" };', 'Explicitly qualify omitted cohorts rather than representing them as passes.');
  replace(' || !synthetic.allExpected || !forwarding.allExpected || !forwarding.safe', '', 'Remove only results of unexecuted out-of-scope cohorts from final aggregate expression.');
  const body = source => source.slice(source.indexOf('function groupMembers('), source.indexOf('const cohort = await'));
  assert.equal(body(text), body(original));
  return { text, changes, originalSha256: hash(original), adaptedSha256: hash(text), unchangedCaseRunnerSha256: hash(body(original)) };
}

if (process.argv[2] === 'patch') {
  const result = adapted();
  const files = { 'coordinator.mjs': result.text, 'ADAPTATION.json': `${JSON.stringify({ ...result, text: undefined }, null, 2)}\n` };
  console.log('*** Begin Patch');
  for (const [name, text] of Object.entries(files)) {
    console.log(`*** Add File: tests/integration/html-public-admission-resource-v32-independent-20260827/recipe/${name}`);
    console.log(text.trimEnd().split('\n').map(line => `+${line}`).join('\n'));
  }
  console.log('*** End Patch');
}
