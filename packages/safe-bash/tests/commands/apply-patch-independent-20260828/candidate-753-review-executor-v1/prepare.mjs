import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, inventory, sha, json } from './common.mjs';
import { referencePackage } from './package-data.mjs';
import { replaceOnce, variants } from './variants.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
const review = path.dirname(own); const repository = path.resolve(own, '../../../..');
const read = name => fs.readFileSync(path.join(review, name));
const binding = JSON.parse(read('remaining-harness-v7/BINDINGS.json'));
const profile = JSON.parse(read('candidate-753-review-profile-v1/PROFILE.json'));
assert.equal(sha(read('candidate-753-review-profile-v1/PROFILE.json')), '9d15f9e04875c2fa1255003fd91cc9f7192a698490ff2459103ee4f48392d86e');
const expectedPackage = JSON.parse(read('remaining-harness-v7/AUTHOR-PACKAGE-INVENTORY.json'));
const authorRoot = 'tests/commands/apply-patch-author-20260828';
const encodedPath = `${authorRoot}/s54-v2/captures/apply-patch-s54-v2-WB7vny.json.gz.base64`;
const reference = referencePackage(fs.readFileSync(path.join(repository, encodedPath)), binding.authorPackage, expectedPackage);
const ownWrite = (name, body) => fs.writeFileSync(path.join(own, name), typeof body === 'string' || Buffer.isBuffer(body) ? body : json(body), { flag: 'wx', mode: 0o644 });

if (process.argv[2] === 'generate') {
  let legacy = read('capture-membership-v3/future-v3/worker.mjs').toString();
  const importsEnd = legacy.indexOf('const job = globalThis.reviewJob;'); assert.ok(importsEnd > 0);
  const imports = legacy.slice(0, importsEnd); legacy = legacy.slice(importsEnd);
  legacy = replaceOnce(legacy, 'const job = globalThis.reviewJob;', '');
  legacy = replaceOnce(legacy, 'const call = { method: key, path: filename, occurrence, signalMatches: options?.signal === selectedSignal };', 'const call = { method: key, path: filename, occurrence, signalMatches: options?.signal === selectedSignal };\n      if (job.versioned && key === "access") call.mode = args[1];');
  legacy = replaceOnce(legacy, 'if (expected.stderr.utf8 !== undefined || expected.stderr.hex !== undefined)', 'if (job.versioned && expected.stderr.exactUtf8Alternatives) assert.ok(expected.stderr.exactUtf8Alternatives.some(value => errors.equals(Buffer.from(value))), "exact adjudicated diagnostic branch set");\n    else if (expected.stderr.utf8 !== undefined || expected.stderr.hex !== undefined)');
  legacy = replaceOnce(legacy, "if (stdinSpec.acquire === 'THROW_IF_ACQUIRED') assert.equal(acquired, 0);", "if (stdinSpec.acquire === 'THROW_IF_ACQUIRED') assert.equal(acquired, 0);\n    if (job.versioned && expected.stdinPulls !== undefined) assert.equal(pulls, expected.stdinPulls);");
  legacy = replaceOnce(legacy, "const selected = job.cap ? [capCase(job.cap, job.endpoint)] : [...originals, ...supplements].filter(row => job.ids.includes(row.id));", "const selected = job.rows ?? (job.cap ? [capCase(job.cap, job.endpoint)] : [...originals, ...supplements].filter(row => job.ids.includes(row.id)));\nfor (const row of selected) if (job.versioned) { row.versionedId = row.id; row.id = row.executionId; }");
  legacy = replaceOnce(legacy, 'results.push(result);', 'if (row.versionedId) result.id = row.versionedId;\n    results.push(result);');
  const finalStart = legacy.indexOf("console.log(JSON.stringify({ kind: 'final'"); assert.ok(finalStart > 0);
  legacy = legacy.slice(0, finalStart) + `process.removeListener('unhandledRejection', unhandled);\nreturn { kind: 'legacy', job: job.id, invocations, shells, disposed, complete: !results.some(row => row.status === 'HARNESS_ERROR'), cases: results.map(({ raw, ...row }) => row), markers: [...globalThis.reviewMarkers] };\n`;
  const generated = imports + 'export async function legacy(job) {\n' + legacy + '}\n';
  const copies = { 'legacy.mjs': generated, 'path-bytes.mjs': read('capture-membership-v3/future-v3/path-bytes.mjs').toString() };
  ownWrite('GENERATED-SOURCE.patch', '*** Begin Patch\n' + Object.entries(copies).map(([name, body]) => `*** Add File: ${path.relative(repository, path.join(own, name))}\n` + body.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n').join('') + '*** End Patch\n');
  ownWrite('BINDINGS.json', binding); ownWrite('PACKAGE-INVENTORY.json', expectedPackage);
  const fixtures = JSON.parse(read('remaining-harness-v9/recipe/FIXTURES-v6.json'));
  ownWrite('VERSIONED-ROWS.json', fixtures.cases.map(entry => ({ ...entry.row, executionId: entry.original.id })));
  const mutations = variants(reference.files); ownWrite('VARIANTS.json', mutations);
  const originals = JSON.parse(read('matrix/ORIGINAL32-v1.json')).cases;
  const supplements = JSON.parse(read('matrix/SUPPLEMENT-v1.json')).cases;
  const jobs = profile.jobs.map(job => ({ ...job, timeoutMs: job.role === 'build' ? 120000 : 30000, maxBytes: job.role === 'metadata' ? 16 * 1024 * 1024 : ['instrumented-s54', 'regression'].includes(job.role) ? 8 * 1024 * 1024 : 2 * 1024 * 1024,
    ...(job.role === 'regression' ? { ids: [...originals, ...supplements].map(row => row.id), authorCases: 63 } : {}),
    ...(job.role === 'original-mutant' ? { ids: mutations.find(entry => entry.family === job.mutant).caseId === 'L10' ? [] : [mutations.find(entry => entry.family === job.mutant).caseId], ...(job.mutant === 'M18' ? { cap: 'L10', endpoint: 'over' } : {}) } : {}),
    ...(job.originalJob ?? {}) }));
  for (const job of jobs) { job.role = profile.jobs.find(row => row.id === job.id).role; job.timeoutMs = job.role === 'build' ? 120000 : 30000; }
  assert.equal(jobs.length, 54); assert.equal(new Set(jobs.map(job => job.id)).size, 54);
  ownWrite('JOBS.json', jobs);
  console.log('DATA generated patch, bindings, 54 jobs and 30 finite mutation graphs; no product loads');
} else if (process.argv[2] === 'seal') {
  const sourceBindings = {};
  const inherited = JSON.parse(read('remaining-harness-v9/recipe/DISCOVERY-PRESEAL.json')).sourceBindings;
  for (const [name, expected] of Object.entries(inherited)) assert.deepEqual(describe(path.join(repository, name)), expected, name);
  const inputs = [
    ...Object.keys(JSON.parse(read('remaining-harness-v9/recipe/DISCOVERY-PRESEAL.json')).sourceBindings),
    encodedPath, `${authorRoot}/probe.mjs`, `${authorRoot}/CASES-v1.json`,
    'tests/fs/webdav/mock.ts',
    ...['ORIGINAL32-v1.json', 'SUPPLEMENT-v1.json', 'LIMITS-v1.json', 'PROTOCOL-v1.json', 'POLICY-v1.json'].map(name => path.relative(repository, path.join(review, 'matrix', name))),
    path.relative(repository, path.join(review, 'remaining-harness-v9/recipe/DISCOVERY-PRESEAL.json')),
  ];
  for (const name of new Set(inputs)) sourceBindings[name] = describe(path.join(repository, name));
  assert.equal(sourceBindings[`${authorRoot}/probe.mjs`].sha256, 'b98034e3a3b9e55558fd401ae53ab78bbb3fc2534c51fced281c5b96ea47f786');
  assert.equal(sourceBindings['tests/fs/webdav/mock.ts'].sha256, '177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36');
  const oldTools = JSON.parse(read('capture-membership-v3/future-v3/METADATA.json')).tools.filter(tool => tool.directory);
  for (const tool of oldTools) for (const entry of tool.entries) {
    if (entry.type === 'directory') continue;
    const { path: filename, ...expected } = entry; assert.deepEqual(describe(path.join(repository, filename)), expected, filename);
  }
  const tools = oldTools.map(tool => ({ directory: tool.directory, entries: inventory(path.join(repository, tool.directory), 128 * 1024 * 1024) }));
  const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node'; const git = '/Library/Developer/CommandLineTools/usr/bin/git';
  assert.equal(describe(node).sha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  assert.equal(describe(git).sha256, 'be4afb2b003904725826250de9fb76567bbacf82323457b5a1ec26706b66bcae');
  const files = Object.fromEntries(Object.entries(inventory(own)).filter(([name, entry]) => entry.kind === 'file').map(([name, { kind, ...entry }]) => [name, entry]));
  const seal = { schema: 'AP753-complete-preseal-v1', phase: 'before any candidate build or runtime load', date: '2026-08-28', candidate: binding.candidate, selectedTree: binding.newSelectedDerivedTree,
    packageSha256: binding.authorPackage.tarballClaim.sha256, files, sourceBindings, tools,
    node: { path: node, ...describe(node) }, git: { path: git, ...describe(git) },
    finitePlatformEnvironment: { __CF_USER_TEXT_ENCODING: '0x1F5:0x0:0x0' },
    jobs: JSON.parse(fs.readFileSync(path.join(own, 'JOBS.json'))),
    bounds: { elapsedMs: 6600000, cleanupReserveMs: 30000, maximumAllOwnedProcesses: 70, plannedOwnerAndChildren: 61, peakTotal: 4, targetFlatPeak: 2, combinedCaptureBytes: 134217728, workingBytes: 536870912, perCaseMs: 30000, perBuildMs: 120000 },
    administrativeGit: ['preseal-tree: exact committed own subtree NUL membership', 'candidate-module-tree: exact six committed module inputs NUL membership', 'runtime-add', 'runtime-commit', 'runtime-tree', 'runtime-objects'],
    runtimeSealPaths: ['BUILD-RECEIPT.json', 'RUNTIME-SEAL.json'], runtimeSealGit: ['add -- exact two paths', 'commit --only -- exact two paths', 'ls-tree -rz exact receipt commit and two owned paths', 'cat-file --batch exact receipt commit and two payload object IDs'],
    grant: { authorization: 'ROOT AP753 ONE REVIEW', attempt: 1, candidate: binding.candidate, sealSha256: 'SHA256 of this PRESEAL.json', command: 'literal pinned Node controller.mjs with preseal commit and SHA arguments; login:false' },
    observerCapture: 'All child stdout/stderr, loader observations and raw case records share the same parent persisted-byte ledger; stdout observer bytes are not an unaccounted channel. Parent summaries/archive/index also charged.',
    packageMechanism: 'fresh strict compile equals exact full882 reference member bytes; deterministic scripts-disabled offline assembly from authenticated tar regular members; physical moved consumer, origin absent. Not npm lifecycle execution.',
    qualification: 'old 58be results are never inherited; original S54 static row remains historical not current dynamic proof; new U/I evidence separate; root/default78 unchanged; module internal',
  };
  ownWrite('PRESEAL.json', seal);
  console.log(JSON.stringify({ sealSha256: sha(json(seal)), files: Object.keys(files).length, sourceBindings: Object.keys(sourceBindings).length, jobs: seal.jobs.length }));
} else throw new Error('prepare requires generate or seal');
