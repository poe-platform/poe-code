import assert from 'node:assert/strict';
import { hash } from './conditional.mjs';

export function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `unique overlay anchor: ${before}`);
  return source.replace(before, after);
}

export function transformParent(source) {
  let changed = replaceOnce(source,
    "import { admitFinal } from '../actual-review-v1/a01.mjs';",
    "import { admitActualJob, aggregateExit } from '../../parent-gate.mjs';");
  changed = replaceOnce(changed, 'const final = await admitFinal({', 'const final = await admitActualJob({');
  changed = replaceOnce(changed,
    "      const records = (await readFile(path.join(evidence, id, 'stdout.raw'), 'utf8'))",
    "      phases.push(final.requiredChildPhase);\n      const records = (await readFile(path.join(evidence, id, 'stdout.raw'), 'utf8'))");
  changed = replaceOnce(changed,
    "const exitCode = stopped || phases.some(phase => phase.status !== 'PASS') || Object.values(perLayout).some(result => result.fail || result.blocked || result.missing.length) ? 1 : 0;",
    "const requiredPhases = ['build', 'write-denials', ...['SOURCE', 'INSTALLED_MOVED'].flatMap(layout => [`types-${layout}-positive`, `types-${layout}-negative`]), ...['SOURCE', 'INSTALLED_MOVED'].map(layout => `child:${layout}-000`)];\nconst exitCode = aggregateExit({ stopped, phases, perLayout, requiredPhases });");
  changed = replaceOnce(changed,
    "const evidence = path.join(ROOT, 'evidence'); await mkdir(evidence);",
    "assert.equal(seal.f11Checkpoint, 'ROOT_APPROVED_EXACT_DENIAL_REVIEW_AND_MATERIALIZED_GRAPH');\nconst f11ProfileBytes = await readFile(path.resolve(ROOT, '../../PROFILE.json'));\nassert.equal(hash(f11ProfileBytes), seal.f11ProfileSha256);\nconst f11Profile = JSON.parse(f11ProfileBytes);\nassert.equal(seal.source, f11Profile.candidate);\nassert.equal(seal.base, f11Profile.base);\nassert.deepEqual(seal.f11CandidateBinding, f11Profile.candidateBinding);\nassert.deepEqual(seal.cohort.jobs.map(job => job.id), f11Profile.cases.map(spec => spec.id));\nassert.equal(seal.cohort.jobs.length, 11);\nassert.ok(seal.cohort.jobs.every(job => job.kind === 'f11-reconciliation'));\nconst evidence = path.join(ROOT, 'evidence'); await mkdir(evidence);");
  changed = replaceOnce(changed,
    '[compiler, tools, ...readRoots], outDir ? [outDir] : []',
    '[compiler, tools, ...readRoots, ...(outDir ? [outDir] : [])], outDir ? [outDir] : []');
  changed = replaceOnce(changed,
    '        layout, root, entries, builtinMap, fallback:',
    "        f11Checkpoint: seal.f11Checkpoint, f11ProfileSha256: seal.f11ProfileSha256, f11CandidateBinding: seal.f11CandidateBinding, f11RawDirectory: path.join(evidence, `${id}-case-raw`),\n        layout, root, entries, builtinMap, fallback:");
  changed = replaceOnce(changed,
    "filename, root]);\n      const final = await admitActualJob",
    "filename, root], [path.join(evidence, `${id}-case-raw`)]);\n      const final = await admitActualJob");
  changed = replaceOnce(changed,
    "      const receipt = await child(id, [path.join(ROOT, 'worker.mjs')",
    "      await mkdir(path.join(evidence, `${id}-case-raw`));\n      const receipt = await child(id, [path.join(ROOT, 'worker.mjs')");
  changed = replaceOnce(changed, 'timeoutMs: 60000, rawBytes: 32 * 1024 * 1024', 'timeoutMs: 60000, rawBytes: id === \'build\' || id.startsWith(\'types-\') ? 32 * 1024 * 1024 : 65536');
  changed = replaceOnce(changed, 'requiredIds: jobs.map(job => job.id), rawBound: 32 * 1024 * 1024', 'requiredIds: jobs.map(job => job.id), rawBound: 65536');
  return { source: changed, beforeSha256: hash(source), afterSha256: hash(changed) };
}

export function transformAdapter(source, mechanical) {
  let changed = source;
  for (const change of mechanical.changes) changed = replaceOnce(changed, change.before, change.after);
  assert.equal(hash(changed), mechanical.afterSha256, 'exact previously qualified mechanical recipe');
  changed = replaceOnce(changed,
    "import assert from 'node:assert/strict';",
    "import assert from 'node:assert/strict';\nimport { runFuture } from '../../future-direct.mjs';");
  changed = replaceOnce(changed,
    "  const report = async observation =>",
    "  if (job.kind === 'f11-reconciliation') return runFuture({ job, module, contracts, api, emit, layout });\n  const report = async observation =>");
  return { source: changed, beforeSha256: hash(source), mechanicalSha256: mechanical.afterSha256, afterSha256: hash(changed) };
}

export function parentSection(source) {
  const begin = source.indexOf('      const final = await admitActualJob({');
  const end = source.indexOf('      const records = ', begin);
  assert.ok(begin >= 0 && end > begin);
  const section = source.slice(begin, end);
  return { section, sha256: hash(section), module:
    "import { admitActualJob } from './parent-gate.mjs';\nimport path from 'node:path';\nexport async function parentSection({job,receipt,evidence,id,seen,verify,durable,phases}) {\n" + section + '  return final;\n}\n' };
}
