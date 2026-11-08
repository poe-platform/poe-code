import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { baseline, acceptedModule, publicPaths } from '../public-integration-freeze-v1/cases.mjs';
import { assertComposition, assertExports, assertSafeInput } from '../public-integration-freeze-v1/predicates.mjs';
import { repository, git, recipe, sha, safe, write, save, fileHash, read, inventory, sameInventory } from './common.mjs';

export function requireAuthorization(args, request, expectedHash) {
  assert.deepEqual(args, ['--execute-declared-candidate', request.candidate, expectedHash], 'EXPLICIT_CANDIDATE_AUTHORIZATION_REQUIRED');
  assert.equal(request.schema, 'timeout-public-candidate-binding/1', 'CANDIDATE_SCHEMA');
  assert.match(request.candidate ?? '', /^[a-f0-9]{40}$/u, 'EXACT_CANDIDATE_REQUIRED');
  assert.equal(request.baseline, baseline, 'BASELINE_REQUIRED');
  assert.equal(request.module, acceptedModule, 'ACCEPTED_MODULE_REQUIRED');
  assert.match(request.preparationSha256 ?? '', /^[a-f0-9]{64}$/u, 'PREPARATION_PIN_REQUIRED');
  assert.match(request.pack?.sha256 ?? '', /^[a-f0-9]{64}$/u, 'NEW_PACK_REQUIRED');
  assert.ok(Array.isArray(request.packageFiles) && request.packageFiles.length > 0, 'FULL_PACK_INVENTORY_REQUIRED');
  assert.deepEqual(request.public?.map(row => row.path).sort(), [...publicPaths].sort(), 'EXPLICIT_PUBLIC_BLOBS_REQUIRED');
  assert.ok(Array.isArray(request.mutants) && request.mutants.length === 8, 'SEALED_EIGHT_MUTANTS_REQUIRED');
  assert.deepEqual(request.mutants.map(row => row.id), ['M01','M02','M03','M04','M05','M06','M07','M08'], 'MUTANT_IDS');
  const cases = [['R01'],['R03','R04'],['R09','R14'],['R07'],['R15','R27'],['R13'],['R23'],['R25']];
  for (const [index, mutation] of request.mutants.entries()) { assert.ok(cases[index].includes(mutation.caseId), 'DESIGNATED_MUTANT_CASE'); assert.ok(typeof mutation.failure === 'string' && mutation.failure.length > 0, 'DESIGNATED_MUTANT_FAILURE_REQUIRED'); }
  assert.deepEqual(request.runtimeCases, Array.from({ length: 30 }, (_, index) => `R${String(index + 1).padStart(2, '0')}`), 'UNCHANGED_RUNTIME_CASES');
  assert.equal(request.publicAuthorization, 'root-exact-candidate-handoff', 'ROOT_HANDOFF_REQUIRED');
  for (const row of request.packageFiles) { safe(row.path); assert.ok(row.mode === 420 || row.mode === 493, 'PACK_MEMBER_MODE'); assert.match(row.sha256, /^[a-f0-9]{64}$/u); }
  safe(request.runName); assert.ok(!request.runName.includes('/'), 'SINGLE_RUN_NAME');
}

export function gitReader(receipts) {
  return args => {
    const bytes = execFileSync(git, ['--no-replace-objects','--no-optional-locks','-C',repository,...args], { timeout: 10000, maxBuffer: 16 * 1024 ** 2, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } });
    receipts.push({ args, bytes: bytes.length, sha256: sha(bytes), natural: true, status: 0 }); return bytes;
  };
}

export function materializeInputs(binding, request, destination, receipts) {
  const get = gitReader(receipts), bodies = new Map();
  const selectedNames = get(['ls-tree','-r','--name-only',baseline,'--','src','package.json','package-lock.json','tsconfig.json','tsconfig.build.json']).toString().trim().split('\n').sort();
  assert.deepEqual(selectedNames, binding.selectedInputs.filter(row => !row.path.startsWith('src/commands/timeout/')).map(row => row.path).sort(), 'COMPLETE_BASELINE_SELECTION');
  for (const row of binding.selectedInputs) {
    assertSafeInput(row);
    const commit = row.path.startsWith('src/commands/timeout/') ? acceptedModule : baseline;
    assert.equal(get(['ls-tree',commit,'--',row.path]).toString().trim(), `${row.mode} blob ${row.blob}\t${row.path}`, 'PRISTINE_TREE_BINDING');
    const bytes = get(['cat-file','blob',row.blob]); assert.equal(sha(bytes), row.sha256, 'PRISTINE_HASH'); assert.equal(bytes.length, row.bytes); bodies.set(row.path, bytes);
  }
  const resulting = binding.selectedInputs.map(row => ({ ...row }));
  for (const row of request.public) {
    assertSafeInput(row); assert.equal(row.commit, request.candidate);
    assert.equal(get(['ls-tree',request.candidate,'--',row.path]).toString().trim(), `${row.mode} blob ${row.blob}\t${row.path}`, 'PUBLIC_TREE_BINDING');
    const bytes = get(['cat-file','blob',row.blob]); assert.equal(sha(bytes), row.sha256, 'PATCHED_HASH'); assert.equal(bytes.length, row.bytes);
    resulting[resulting.findIndex(input => input.path === row.path)] = row; bodies.set(row.path, bytes);
  }
  assertComposition(resulting, binding.selectedInputs, request);
  assertExports(JSON.parse(bodies.get('package.json')), binding.originalPackage);
  assert.equal(fs.existsSync(destination), false, 'FRESH_VIEW_REQUIRED'); fs.mkdirSync(destination, { recursive: true });
  for (const row of resulting) { const filename = resolve(destination, safe(row.path)); write(filename, bodies.get(row.path)); fs.chmodSync(filename, parseInt(row.mode, 8) & 511); }
  sameInventory(inventory(destination), resulting);
  return { inputs: resulting, bodies, proof: { profile: 'scoped-committed-Git-blob-composition', pristineInputs: binding.selectedInputs.length, patchedInputs: request.public.length, materializedInputs: resulting.length, fullHistoryArchiveProof: false, noLiveSourceFallback: true } };
}

export function materializeTools(binding, work) {
  const closurePath = resolve(repository, binding.toolClosure.path), closure = read(closurePath), toolMap = {}, aliases = [];
  assert.equal(fileHash(closurePath), 'b4263e32e6b2ea91a7f8eccceb1133a04ef09d614adca2c8021737572dbd0ad7');
  let regular = 0;
  for (const group of closure.packages) {
    const target = resolve(work, group.name === 'npm' ? 'tools/npm' : group.name === 'typescript' ? 'tools/typescript' : `dependencies/node_modules/${group.name}`);
    for (const row of group.records) {
      safe(row.path); const source = resolve(group.root, row.path), stat = fs.lstatSync(source);
      if (row.type === 'directory') { assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); continue; }
      if (row.type === 'symlink') { assert.ok(stat.isSymbolicLink()); assert.equal(fs.readlinkSync(source), row.link); aliases.push({ source, link: row.link, followed: false, materialized: false }); continue; }
      assert.equal(row.type, 'file'); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.mode & 511, row.mode);
      const bytes = fs.readFileSync(source); assert.equal(bytes.length, row.bytes); assert.equal(sha(bytes), row.sha256);
      const filename = resolve(target, row.path); write(filename, bytes); fs.chmodSync(filename, row.mode); toolMap[filename] = row.sha256; regular++;
    }
  }
  assert.equal(regular, 2274); assert.equal(aliases.length, 12);
  save(resolve(work, 'tool-map.json'), toolMap);
  return { toolMap, aliases, regular, closurePath, compiler: resolve(work,'tools/typescript/bin/tsc'), npm: resolve(work,'tools/npm/bin/npm-cli.js') };
}

export function applyMutant(source, mutation) {
  safe(mutation.path); assert.match(mutation.beforeSha256, /^[a-f0-9]{64}$/u); assert.match(mutation.afterSha256, /^[a-f0-9]{64}$/u);
  assert.equal(sha(source), mutation.beforeSha256, 'MUTANT_ORIGINAL_HASH');
  assert.ok(mutation.before.length > 0 && mutation.before !== mutation.after, 'MEANINGFUL_MUTANT');
  const text = source.toString(); assert.equal(text.split(mutation.before).length - 1, 1, 'UNIQUE_MUTANT_DELTA');
  const bytes = Buffer.from(text.replace(mutation.before, mutation.after)); assert.equal(sha(bytes), mutation.afterSha256, 'MUTANT_RESULT_HASH'); return bytes;
}
