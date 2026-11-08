import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const own = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(own, '../../..');
const capture = JSON.parse(fs.readFileSync(path.join(own, 'PREPARATION-ROOT.json'))).root;
const records = [];
try {
  function read(name, digest) {
    const filename = path.join(repo, 'tests/compatibility/bash-redirection-author-20260829', name), stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 100000);
    const bytes = fs.readFileSync(filename); assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
    return bytes.toString();
  }
  function replace(text, before, after) { assert.equal(text.split(before).length, 2, before); return text.replace(before, after); }
  let prepare = read('prepare.mjs', '7d9afeeaed5df71be7faa6f269950803920c46d1f4bd080884b0cbf501684bc4');
  prepare = prepare.replaceAll('tests/integration/git-public-20260829/SOURCE.json', 'tests/compatibility/bash-redirection-author-20260829/SOURCE.json')
    .replaceAll('14a2a6a50d7748b677c4cc1261d6f69a411c1c21926c7acd884c86f2077e9450', 'd181f7d3b5acfcb5521dd5cc26be0aa4f2ac15b3fed1df4b8c729f25b5e34b17')
    .replaceAll('c83f352f057c64917f219eb938f54aa42cdab829', 'ed0e0d09cf71bed7f4aee075750b60a30df4ef52')
    .replaceAll('tests/integration/git-public-20260829/PRESEAL.json', 'tests/compatibility/bash-redirection-author-20260829/PRESEAL.json')
    .replaceAll('tests/integration/git-public-20260829/EXECUTOR.json', 'tests/compatibility/bash-redirection-author-20260829/EXECUTOR.json')
    .replaceAll('1e9b83d7', '928be5585f05c15867fbbb5f4b5debe153b0734e')
    .replaceAll('AUTHOR_REDIRECTION_ON_FIXED_PUBLIC80_NOT_PUBLIC_ACCEPTANCE', 'AUTHOR_RESOLVED_UNIT2_ON_C83_PLUS_PROVISIONAL_UNIT1');
  prepare = replace(prepare, '["src/shell/parser.ts", "src/shell/runtime.ts", "src/shell/display.ts"]', '["src/shell/parser.ts", "src/shell/runtime.ts"]');
  prepare = replace(prepare, 'overlay.length, 3', 'overlay.length, 2');
  const sealStart = prepare.indexOf('    const seal = '), sealEnd = prepare.indexOf('    const oldExecutor', sealStart);
  assert.ok(sealStart > 0 && sealEnd > sealStart);
  prepare = prepare.slice(0, sealStart) + `    const seal = { ...oldSeal, role: source.role, base: source.base, baseSourceSha256: sha(baseBytes), sourceCommit: "928be5585f05c15867fbbb5f4b5debe153b0734e", bounds: { ...oldSeal.bounds, totalSeconds: 2700, children: 96, loaderAdmissions: 32, regexWorkers: 8 }, cohorts: { strict: 50, redirections: 48, gitPublic: 45, apply: 28, arrays: 12, coherence: 18 }, plannedChildren: { direct: 36, loaders: 26, regexWorkersMax: 8, outerAndDevelopmentReserve: 26 }, resources: "Serial admitted consumers; one fixed loader per consumer, at most two exact RegexWorkers at once; no generic Worker or kernel census claim", exclusions: "No native/oracle/private/network/engine/Node-command/XAN/fullgate; default80 unchanged. Eleven OPEN/OUTSIDE design identities unexecuted; arithmetic/member-length/invalid-tail/diagnostic GNU qualification absent.", executionsAtPreseal: 0 };
` + prepare.slice(sealEnd);
  prepare = replace(prepare, 'const ownNames = ["prepare.mjs", "derive.mjs", "run.mjs", "redirections.mjs", "CASES.json", "close-observer.mjs", "RECIPE.md"];', 'const ownNames = ["prepare.mjs", "derive.mjs", "run.mjs", "launch.mjs", "strict.mjs", "CONTRACT.md", "ROLES.json"];');
  prepare = replace(prepare, '...ownNames.map(name => path.relative(repo, path.join(own, name)))', '...ownNames.map(name => path.relative(repo, path.join(own, name))), "tests/compatibility/bash-strict-mode-design-20260829/CASES.json", "tests/compatibility/bash-redirection-author-20260829/redirections-v2.mjs"');

  let runner = read('run.mjs', 'af978dc4cbec5e84d3650d34defe000fe520648e9355f6f168ae50c633564501');
  runner = runner.replaceAll('redirection-author-', 'strict-mode-author-').replaceAll("loaderReservations <= 24", "loaderReservations <= seal.bounds.loaderAdmissions");
  runner = replace(runner, "'close-observer.mjs'])", "'close-observer.mjs', 'strict.mjs', 'strict-design.json'])");
  const mapStart = runner.indexOf("  harnessMap.push(['redirections.mjs'"), mapEnd = runner.indexOf('  for (const [destination, from]', mapStart);
  assert.ok(mapStart > 0 && mapEnd > mapStart);
  runner = runner.slice(0, mapStart) + `  harnessMap.push(['redirections.mjs', 'tests/compatibility/bash-redirection-author-20260829/redirections-v2.mjs'], ['redirection-cases.json', 'tests/compatibility/bash-redirection-author-20260829/CASES.json'], ['close-observer.mjs', 'tests/compatibility/bash-redirection-author-20260829/close-observer.mjs'], ['strict.mjs', path.relative(repo, path.join(own, 'strict.mjs'))], ['strict-design.json', 'tests/compatibility/bash-strict-mode-design-20260829/CASES.json']);
` + runner.slice(mapEnd);
  runner = replace(runner, "await cohort(label + '-redirections', product, 'redirections.mjs', 48);", "await cohort(label + '-redirections-v2', product, 'redirections.mjs', 48); await cohort(label + '-strict', product, 'strict.mjs', 50);");
  runner = replace(runner, "await cohort('moved-redirections', movedRoot, 'redirections.mjs', 48);", "await cohort('moved-redirections-v2', movedRoot, 'redirections.mjs', 48); await cohort('moved-strict', movedRoot, 'strict.mjs', 50);");
  const mutationStart = runner.indexOf('  const mutations = ['), mutationEnd = runner.indexOf('  for (const mutation of mutations)', mutationStart);
  runner = runner.slice(0, mutationStart) + `  const mutations = [
    { id: 'omit-presence-check', file: 'shell/runtime.js', before: 'state.nounset && value === undefined', after: 'false', case: 'U10' },
    { id: 'lose-fatal-boundary', file: 'shell/runtime.js', section: true, before: 'throw new Flow("exit", 1);', after: 'return 1;', case: 'U39' },
    { id: 'ignore-u-flag', file: 'shell/runtime.js', before: 'state.nounset = enabled;', after: 'state.nounset = false;', case: 'U10' },
  ];
` + runner.slice(mutationEnd);
  runner = replace(runner, '    assert.equal(original.split(mutation.before).length, 2, mutation.id);\n    await fs.writeFile(filename, original.replace(mutation.before, mutation.after));', `    let changedSource;
    if (mutation.section) {
      const start = original.indexOf('if (error instanceof NounsetFailure)'), end = original.indexOf('if (error instanceof ArrayFailure)', start);
      assert.ok(start > 0 && end > start);
      const section = original.slice(start, end); assert.equal(section.split(mutation.before).length, 2);
      changedSource = original.slice(0, start) + section.replace(mutation.before, mutation.after) + original.slice(end);
    } else { assert.equal(original.split(mutation.before).length, 2, mutation.id); changedSource = original.replace(mutation.before, mutation.after); }
    await fs.writeFile(filename, changedSource);`);
  runner = runner.replaceAll("mutantRoot, 'redirections.mjs'", "mutantRoot, 'strict.mjs'").replaceAll('REDIRECTION_CASE: mutation.case', 'STRICT_CASE: mutation.case');
  runner = replace(runner, "movedRoot, 'redirections.mjs', {}, binding =>", "movedRoot, 'strict.mjs', {}, binding =>");
  const observedStart = runner.indexOf('  const observedFile = '), observedEnd = runner.indexOf("  assert.deepEqual(await inventory(path.join(source, 'src'))", observedStart);
  assert.ok(observedStart > 0 && observedEnd > observedStart);
  runner = runner.slice(0, observedStart) + "  assert.deepEqual(await inventory(mutantRoot), [...tarRows].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));\n" + runner.slice(observedEnd);
  runner = replace(runner, "Scoped redirection author on fixed public80; 36 literal +12 boundary rows, selected unchanged public regressions, no native/private/network/full gate or hard-preemption proof. Release counter is source-bound compiled instrumentation only. No old failure rescored.", "Resolved Unit2 only on c83 plus provisional unit1; 39 known design identities+11 author controls per layout. Eleven original design identities OPEN/OUTSIDE and UNRUN, no skipped-as-pass/native/private/network/fullgate/GNU exact diagnostic claim. Unit1-v2 is a versioned fixture, historical failures remain.");

  let launch = read('launch.mjs', '56fe558905cbe0333ae56cc77ce69cfc6f3f11e2a72e4b5069fcf6797815dd87');
  launch = launch.replaceAll('bash-redirection-unit1-launch-', 'bash-strict-unit2-launch-').replaceAll('bash-redirection-author-20260829/run.mjs', 'bash-strict-mode-author-20260829/run.mjs');
  const designBytes = fs.readFileSync(path.join(repo, 'tests/compatibility/bash-strict-mode-design-20260829/CASES.json'));
  assert.equal(createHash('sha256').update(designBytes).digest('hex'), '99468cfc96e56130fa65ce12835f4d8a3740002ec9519ea306d4e120cbe5adff');
  const open = new Set(['U06','U07','U17','U27','U28','U31','U32','U33','U34','U35','U36']);
  const roles = JSON.parse(designBytes).cases.map(row => ({ id: row.id, role: open.has(row.id) ? 'UNEXECUTED_OPEN_OR_OUTSIDE_NOT_A_PASS' : 'RESOLVED_PRODUCT_SELECTION_NOT_NATIVE_GOLDEN', nativeExpected: null, authorExecutedAtSeal: false }));
  for (const [name, text] of [['prepare.mjs', prepare], ['run.mjs', runner], ['launch.mjs', launch], ['ROLES.json', JSON.stringify({ originalDesignSha256: createHash('sha256').update(designBytes).digest('hex'), roles, additional: 'E01-E11:11 separately named author controls', implementation: 'resolved subset only' }, null, 2) + '\n']]) {
    const patch = `*** Begin Patch\n*** Add File: ${path.join(own, name)}\n${text.split('\n').map(line => '+' + line).join('\n')}\n*** End Patch`;
    const result = spawnSync('apply_patch', [patch], { encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 });
    records.push({ name, code: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, sha256: createHash('sha256').update(text).digest('hex') });
    assert.equal(result.status, 0); assert.equal(result.signal, null);
  }
  fs.writeFileSync(path.join(capture, 'DERIVE.json'), JSON.stringify(records, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(records));
} catch (error) { fs.writeFileSync(path.join(capture, `DERIVE-ERROR-${Date.now()}.json`), JSON.stringify({ records, error: String(error), stack: error?.stack }), { flag: 'wx' }); throw error; }
