import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve(process.argv[2]);
assert.equal(root, '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-pipestatus-native-reference-20260829');
assert(Date.now() < Date.parse('2026-08-29T12:51:43Z'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (relative, maximum = 4 * 1024 * 1024) => {
  const filename = path.join(root, relative); const stat = fs.lstatSync(filename);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  const bytes = fs.readFileSync(filename); assert.equal(bytes.length, stat.size); return bytes;
};
const write = (relative, bytes) => fs.writeFileSync(path.join(root, relative), bytes, { flag: 'wx', mode: 0o600 });
const parse = relative => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read(relative)));
const admission = parse('SOURCE-ADMISSION.json');
for (const row of admission.inherited) {
  const bytes = read(row.relative); assert.equal(bytes.length, row.bytes); assert.equal(hash(bytes), row.sha256);
}
const requests = parse('REQUESTS.json');
const matrix = parse('inherited/PROOF-MATRIX.json.data');
const results = [];
const check = (id, work) => { work(); results.push({ id, role: 'DATA_ONLY_NO_TARGET_IMPORT', result: 'PASS' }); };
check('DATA01', () => { assert.equal(requests.requests.length, 26); assert.equal(new Set(requests.requests.map(row => row.id)).size, 26); });
check('DATA02', () => {
  for (const row of requests.requests) {
    const original = matrix.rows.find(item => item.id === row.id); const bytes = read(row.file);
    assert.equal(hash(bytes), original.programSha256); assert.equal(bytes.length, row.bytes);
    assert.equal(bytes.toString('utf8'), original.program); assert.equal(row.stdinBase64, '');
    assert.deepEqual(row.argv, ['--noprofile', '--norc', '-c', original.program, 'surface-function-pipestatus']);
  }
});
check('DATA03', () => assert.deepEqual(requests.requests.filter(row => row.disposition.startsWith('WITHHELD')).map(row => row.id), ['F06', 'P15']));
check('DATA04', () => { assert.deepEqual(requests.initialFixtures, []); assert.deepEqual(requests.requests.filter(row => row.effects.length).map(row => row.id), ['F05']); });
check('DATA05', () => assert.equal(requests.requests.reduce((sum, row) => sum + row.sourceForkReservation, 0), 17));
const oldTemplate = parse('inherited/APPROVAL-PROPOSAL.template.json.data');
const template = structuredClone(oldTemplate);
const oldEntry = '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-ere-native-reference-20260829/preflight-v2/materialized/';
const newEntry = root + '/materialized/';
const oldRoot = '/private/tmp/safe-bash-ere-native-observations-20260829-v1';
const newRoot = '/private/tmp/safe-bash-function-pipestatus-observations-20260829-v1';
template.schema = 'function-pipestatus-approval-proposal-v1';
template.status = 'PENDING_EXECUTABLE_ADAPTATION_INDEPENDENT_REVIEW_ROOT_GO';
assert.equal(template.parameters.cmd.split(oldEntry).length - 1, 2);
assert.equal(template.parameters.cmd.split(oldRoot).length - 1, 4);
template.parameters.cmd = template.parameters.cmd.replaceAll(oldEntry, newEntry).replaceAll(oldRoot, newRoot);
template.parameters.justification = 'Allow only the freshly reviewed 26 literal local Bash3.2.57 function/PIPESTATUS observations, including separately approved exact failed lookups and owned F05 output, outside the custom test sandbox; initial tool-shell startup is trusted host, not clean-env/capture or containment qualified?';
template.absoluteUtc = { issued: 'PENDING', expiry: 'PENDING', latestFull600sStart: 'PENDING' };
template.withheldUntilRootScope = ['F06:function', 'P15:__surface_missing_command__'];
check('DATA06', () => { assert.equal(template.parameters.cmd.split('ROOT_APPROVED_GRANT_SHA256').length, 2); assert.equal(template.parameters.login, false); assert.equal(template.parameters.sandbox_permissions, 'require_escalated'); assert.equal(Object.hasOwn(template.parameters, 'prefix_rule'), false); });
check('DATA07', () => { assert(!template.parameters.cmd.includes(oldRoot)); assert(!template.parameters.cmd.includes(oldEntry)); assert(template.parameters.cmd.includes('unsetopt MULTIOS')); assert(template.parameters.cmd.includes('1<>')); assert(template.parameters.cmd.includes('2<>')); });
check('DATA08', () => { const old = read('inherited/materialized/admission.mjs.data').toString(); assert(old.includes('operations.readSync(fd,Buffer.alloc(1),0,1,0)')); assert.equal(fs.existsSync(path.join(root, 'GO.json')), false); assert.equal(fs.existsSync(path.join(root, 'materialized/entry.mjs')), false); });
write('APPROVAL-PROPOSAL.template.json', JSON.stringify(template, null, 2) + '\n');
write('DATA-CONTROLS.json', JSON.stringify({ status: 'PREPARATION_DATA_ONLY', count: results.length, results, newExecutorControls: 'D01-D12 UNRUN', nativeStarts: 0, targetImports: 0, fixtureChildren: 0 }, null, 2) + '\n');
const binding = parse('inherited/SOURCE-BINDINGS.json.data');
const retainedRoot = '/tmp/safe-bash-reference-source-20260829-fn91Rw/bash-5.3';
const additions = [];
for (const filename of ['variables.c', 'subst.c', 'shell.c']) {
  const pin = binding.gnu.files.find(row => row.path === filename); const stat = fs.lstatSync(path.join(retainedRoot, filename));
  assert(stat.isFile() && stat.size === pin.bytes && stat.size < 524288);
  const bytes = fs.readFileSync(path.join(retainedRoot, filename)); assert.equal(hash(bytes), pin.sha256);
  const lines = bytes.toString('utf8').split('\n'); const selected = new Set();
  const needles = filename === 'variables.c' ? ['make_local_variable (', 'find_variable_internal (', 'set_pipestatus_array ('] : filename === 'shell.c' ? ['set_exit_status (', 'last_command_exit_value ='] : ['command_substitute (', 'function_substitute ('];
  for (let index = 0; index < lines.length; index++) if (needles.some(needle => lines[index].includes(needle))) {
    for (let line = Math.max(0, index - 5); line < Math.min(lines.length, index + 80); line++) selected.add(line);
  }
  const relative = 'gnu/' + filename + '.additional.data';
  write(relative, [...selected].sort((left, right) => left - right).map(index => `${index + 1}: ${lines[index]}`).join('\n') + '\n');
  additions.push({ path: filename, bytes: bytes.length, sha256: pin.sha256, hashBeforeDecode: true });
}
write('ADDITIONAL-SOURCE-ADMISSION.json', JSON.stringify(additions, null, 2) + '\n');
const files = []; let bytesTotal = 0;
function inventory(directory, prefix = '') {
  for (const name of fs.readdirSync(directory).sort()) {
    const filename = path.join(directory, name); const relative = prefix + name; const stat = fs.lstatSync(filename);
    assert(!stat.isSymbolicLink());
    if (stat.isDirectory()) inventory(filename, relative + '/');
    else {
      assert(stat.isFile() && stat.size <= 4 * 1024 * 1024 && files.length < 160);
      if (['raw/seal.stdout', 'raw/seal.stderr'].includes(relative)) continue;
      const bytes = fs.readFileSync(filename); bytesTotal += bytes.length;
      files.push({ path: relative, bytes: bytes.length, mode: stat.mode & 0o7777, sha256: hash(bytes) });
    }
  }
}
inventory(root); assert(bytesTotal < 256 * 1024 * 1024);
write('PREPARATION-SEAL.json', JSON.stringify({ schema: 'source-preparation-seal-v1', executableReady: false, actualAuthority: false, files, immutableSnapshotBytes: bytesTotal, excludes: ['PREPARATION-SEAL.json', 'raw/seal.stdout', 'raw/seal.stderr', 'later handoff/publication metadata'], programCount: 26, withheld: ['F06', 'P15'], dataControls: results.length, inheritedRuntimeModules: 9, changedExecutableControls: 'UNRUN' }, null, 2) + '\n');
console.log(JSON.stringify({ files: files.length, bytes: bytesTotal, dataControls: results.length, programs: 26, nativeStarts: 0, executableReady: false, preparationSealSha256: hash(read('PREPARATION-SEAL.json')), commandSha256: hash(Buffer.from(template.parameters.cmd)) }));
