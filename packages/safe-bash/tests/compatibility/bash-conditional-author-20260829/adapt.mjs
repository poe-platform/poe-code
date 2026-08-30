import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(own, '../../..');
const prior = 'tests/compatibility/bash-strict-mode-author-20260829/';
const current = 'tests/compatibility/bash-conditional-author-20260829/';
const root = JSON.parse(fs.readFileSync(path.join(own, 'PREP.json'))).root;
const log = { role: 'SOURCE_ONLY_HARNESS_DERIVATION', started: new Date().toISOString(), files: [] };
const save = () => fs.writeFileSync(path.join(root, 'adapt.json'), JSON.stringify(log, null, 2)); save();
try {
  const executor = JSON.parse(fs.readFileSync(path.join(repo, prior, 'EXECUTOR.json')));
  let patch = '*** Begin Patch\n';
  for (const name of ['prepare.mjs','run.mjs','launch.mjs']) {
    const original = fs.readFileSync(path.join(repo, prior, name)), row = executor.files.find(row => row.path === prior + name);
    assert.equal(createHash('sha256').update(original).digest('hex'), row.sha256);
    let text = original.toString();
    if (name === 'prepare.mjs') {
      text = text.replace('PREPARATION-ROOT.json', 'PREP.json').replace('seal-v2-', 'seal-conditional-');
      text = text.replace('tests/compatibility/bash-redirection-author-20260829/SOURCE.json', prior + 'SOURCE.json').replace('d181f7d3b5acfcb5521dd5cc26be0aa4f2ac15b3fed1df4b8c729f25b5e34b17','75ac56902fdce22f8292c17c14d48287063a5544c46ac8c526b5d4572143bde2').replace('ed0e0d09cf71bed7f4aee075750b60a30df4ef52','26215b99cb379a9f825f803454f758fab5a3c8e9');
      text = text.replace('tests/compatibility/bash-redirection-author-20260829/PRESEAL.json', prior + 'PRESEAL.json');
      text = text.replace('const paths = ["src/shell/parser.ts", "src/shell/runtime.ts"];', 'const sourceCommit = fs.readFileSync(path.join(own, "SOURCE-COMMIT.txt"), "utf8").trim();\n    const paths = ["src/shell/parser.ts", "src/shell/runtime.ts", "src/shell/display.ts", "src/shell/conditional.ts"];');
      text = text.replaceAll('"928be5585f05c15867fbbb5f4b5debe153b0734e"','sourceCommit').replace('overlay.length, 2','overlay.length, 4').replaceAll('AUTHOR_RESOLVED_UNIT2_ON_C83_PLUS_PROVISIONAL_UNIT1','AUTHOR_INITIAL_CONDITIONAL_ON_ACCEPTED_C83_UNIT1_UNIT2').replaceAll('inputs.length, 292','inputs.length, 293').replaceAll('inputs: 292','inputs: 293');
      text = text.replace('totalSeconds: 2700, children: 96, loaderAdmissions: 32, regexWorkers: 8','totalSeconds: 3600, children: 128, loaderAdmissions: 40, regexWorkers: 12, captureBytes: 268435456, scratchBytes: 1073741824').replace('cohorts: { strict: 50','expectedInputs: 293, expectedPackageMembers: 954, cohorts: { conditional: 50, strict: 50');
      text = text.replace('direct: 36, loaders: 26, regexWorkersMax: 8, outerAndDevelopmentReserve: 26','direct: 39, loaders: 29, regexWorkersMax: 12, outerAndDevelopmentReserve: 48');
      text = text.replace('tests/compatibility/bash-redirection-author-20260829/EXECUTOR.json', prior + 'EXECUTOR.json');
      text = text.replace('["prepare.mjs", "derive.mjs", "run.mjs", "launch.mjs", "strict.mjs", "CONTRACT.md", "ROLES.json"]','["prepare.mjs", "adapt.mjs", "run.mjs", "launch.mjs", "conditional.mjs", "PROFILE.md", "CAP-DECISION.md", "SOURCE-COMMIT.txt"]');
    }
    if (name === 'run.mjs') {
      text = text.replaceAll('strict-mode-author-', 'conditional-author-');
      text = text.replace("'strict.mjs', 'strict-design.json']", "'strict.mjs', 'strict-design.json', 'conditional.mjs']");
      text = text.replace("path.relative(repo, path.join(own, 'strict.mjs'))", "'" + prior + "strict.mjs'");
      text = text.replace('for (const [destination, from] of harnessMap)', "harnessMap.push(['conditional.mjs', '" + current + "conditional.mjs']);\n  for (const [destination, from] of harnessMap)");
      text = text.replace("await cohort(label + '-strict', product, 'strict.mjs', 50);", "await cohort(label + '-strict', product, 'strict.mjs', 50); await cohort(label + '-conditional', product, 'conditional.mjs', 50);");
      text = text.replace("await cohort('moved-strict', movedRoot, 'strict.mjs', 50);", "await cohort('moved-strict', movedRoot, 'strict.mjs', 50); await cohort('moved-conditional', movedRoot, 'conditional.mjs', 50);");
      text = text.replace("const original = await fs.readFile(path.join(harness, 'consumer.ts.fixture'), 'utf8');", `const original = await fs.readFile(path.join(harness, 'consumer.ts.fixture'), 'utf8') + '\\nimport { parseShell as parseConditionalSource } from "virtual-bash/shell";\\nconst conditionalNode = parseConditionalSource("[[ x ]]").lists[0]!.pipelines[0]!.commands[0]!;\\nif (conditionalNode.kind === "conditional") { const expression = conditionalNode.expression; void expression;\\n// @ts-expect-error\\nconst invalid: string = conditionalNode.expression;\\n// @ts-expect-error\\nconditionalNode.notAProperty;\\n}\\n';`);
      text = text.replace('errors.length === 6', 'errors.length === 8');
      const start = text.indexOf('  const mutations = ['), end = text.indexOf('  for (const mutation of mutations)', start);
      assert.ok(start > 0 && end > start);
      text = text.slice(0, start) + `  const mutations = [
    { id: 'lose-quoted-pattern', file: 'shell/runtime.js', before: 'glob ? value : value.replace', after: 'true ? value : value.replace', case: 'A07' },
    { id: 'eager-and-or', file: 'shell/conditional.js', before: 'node.kind === "and" ? result : !result', after: 'true', case: 'A16' },
    { id: 'erase-node-cap', file: 'shell/parser.js', before: 'nodes >= 4096', after: 'nodes >= 8192', case: 'H08' },
  ];\n` + text.slice(end);
      text = text.replaceAll("mutantRoot, 'strict.mjs'", "mutantRoot, 'conditional.mjs'").replaceAll('STRICT_CASE: mutation.case', 'CONDITIONAL_CASE: mutation.case');
      text = text.replace("receipt.qualification = 'Resolved Unit2", "receipt.qualification = 'Initial ratified conditional profile, native expectations UNRUN; inherited resolved Unit2");
    }
    if (name === 'launch.mjs') text = text.replace('bash-strict-unit2-launch-', 'bash-conditional-launch-').replace('bash-strict-mode-author-20260829/run.mjs','bash-conditional-author-20260829/run.mjs').replace('2700000','3600000');
    assert.notEqual(text, original.toString());
    patch += `*** Add File: ${path.join(own, name)}\n${text.split('\n').map(line => '+' + line).join('\n')}\n`;
    log.files.push({ name, from: row.sha256, to: createHash('sha256').update(text).digest('hex') });
  }
  patch += '*** End Patch\n'; save();
  const result = spawnSync('apply_patch', [patch], { cwd: repo, timeout: 10000, maxBuffer: 1024 * 1024 });
  fs.writeFileSync(path.join(root, 'adapt.stdout'), result.stdout ?? ''); fs.writeFileSync(path.join(root, 'adapt.stderr'), result.stderr ?? ''); log.status = result.status; log.signal = result.signal; save(); assert.equal(result.status, 0); assert.equal(result.signal, null); console.log(result.stdout.toString());
} catch (error) { log.error = String(error?.stack ?? error); save(); throw error; }
