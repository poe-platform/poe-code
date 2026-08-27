import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { baseValues, boundedCases, commandCases, scriptBody, shebangCases } from './cases.mjs';
import { helperProof, owned, root, runChild, save, sha256, snapshot, transport } from './support.mjs';

const output = 'native-frozen.json';
assert.equal(existsSync(resolve(owned, output)), false);
const profiles = [
  { id: 'gnu97-darwin-primary', env: '/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/env', envHash: '1026eb36ffd2fdca6d064c0ffd6dd99ceb7bb3f49ec5e804df2c53bef372dbf0', bash: '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash', bashHash: '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c' },
  { id: 'apple-env-bash32-historical', env: '/usr/bin/env', envHash: '9eb7c5aed7f3c7fe07b77d9a84d0a7c6a8c68c17a15aa3dace0d8ff02d352776', bash: '/bin/bash', bashHash: '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3' },
];
const paths = [...new Set([...profiles.flatMap(profile => [profile.env, profile.bash]), '/usr/bin/cc', '/usr/bin/sw_vers', '/usr/bin/uname', process.execPath])];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, { realpath: await realpath(path), sha256: sha256(await readFile(path)) }])));
const toolsBefore = await hashes();
for (const profile of profiles) { assert.equal(toolsBefore[profile.env].sha256, profile.envHash); assert.equal(toolsBefore[profile.bash].sha256, profile.bashHash); }
const inputNames = ['cases.mjs', 'recorder.c', 'support.mjs', 'native.mjs'];
const inputs = async () => Object.fromEntries(await Promise.all(inputNames.map(async name => [name, sha256(await readFile(resolve(owned, name)))])));
const inputsBefore = await inputs();
save('native-inputs.json', { frozenAt: new Date().toISOString(), sourceAuthorInputsInspected: false, files: inputsBefore, helperProof, commandCases, shebangCases, scriptBody, boundedCases, baseValues, profiles });
const parent = await realpath(await mkdtemp(resolve(tmpdir(), 'safe-bash-env-hidden-')));
const bin = resolve(parent, 'bin'); await mkdir(bin);
const recorder = resolve(bin, 'argvprobe');
const controlEnv = { PATH: '/usr/bin:/bin', HOME: parent, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
const results = [];
let compile, recorderHash, controls, failure = null;
const startedAt = new Date().toISOString();
const run = (program, args, cwd, env, stdinHex = '0041ff0a', deadline = 3000, argv0 = 'env') => runChild(program, args, { cwd, env, argv0, stdin: Buffer.from(stdinHex, 'hex'), deadline });
async function setup(profile, id) {
  const base = resolve(parent, profile.id, id), cwd = resolve(base, 'work'); await mkdir(cwd, { recursive: true });
  await writeFile(resolve(cwd, 'effect'), 'original'); await chmod(resolve(cwd, 'effect'), 0o644);
  return { base, cwd, env: { PATH: `${resolve(parent, profile.id, 'bin')}:${bin}`, HOME: cwd, TMPDIR: cwd, PWD: cwd, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', ...baseValues } };
}
async function capture(profile, specimen, category, extras = {}) {
  const state = await setup(profile, `${category}-${specimen.id}`);
  let program = profile.env, args = specimen.args, argv0 = 'env', fixture = null;
  if (specimen.nonexec) { await writeFile(resolve(state.cwd, 'nonexec'), 'not executable\n'); await chmod(resolve(state.cwd, 'nonexec'), 0o644); }
  if (category === 'single-optional' || category === 'kernel') {
    const path = resolve(state.base, 'entry.sh');
    const source = `#!${profile.env} ${specimen.optional}\n${scriptBody}`;
    await writeFile(path, source); await chmod(path, 0o755);
    fixture = { path, source, sha256: sha256(source), mode: 0o755, virtualSource: `#!/usr/bin/env ${specimen.optional}\n${scriptBody}`, role: 'harness interpreter fixture outside effect cwd; native env path is explicitly rendered' };
    args = [specimen.optional, path, 'argument with spaces', ''];
    if (category === 'kernel') { program = path; args = ['argument with spaces', '']; argv0 = path; }
  }
  const env = { ...state.env, ...specimen.env };
  const before = await snapshot(state.cwd);
  const result = await run(program, args, state.cwd, env, '0041ff0a', specimen.deadlineMs ?? 3000, argv0);
  const after = await snapshot(state.cwd);
  if (category !== 'bounded') assert.ok(transport(result), `${profile.id}/${category}/${specimen.id}`);
  let recorderOutput = null;
  try { recorderOutput = JSON.parse(Buffer.from(result.stdout, 'base64').toString()); } catch {}
  const record = { id: specimen.id, category, executable: program, argv0, args, cwd: state.cwd, env, stdinHex: '0041ff0a', fixture, before, result, after, recorderOutput, boundedObservationIsNotNativePass: category === 'bounded' };
  await rm(state.base, { recursive: true });
  return record;
}
try {
  compile = await runChild('/usr/bin/cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', resolve(owned, 'recorder.c'), '-o', recorder], { cwd: parent, env: controlEnv, deadline: 20000 });
  assert.ok(transport(compile)); assert.equal(compile.status, 0);
  recorderHash = sha256(await readFile(recorder));
  for (const profile of profiles) {
    const roleBin = resolve(parent, profile.id, 'bin'); await mkdir(roleBin, { recursive: true }); await symlink(profile.bash, resolve(roleBin, 'bash'));
    const version = await run(profile.env, ['--version'], parent, controlEnv, '');
    const bashVersion = await run(profile.bash, ['--version'], parent, controlEnv, '', 3000, 'bash');
    assert.ok(transport(version)); assert.ok(transport(bashVersion));
    const rows = [];
    for (const specimen of commandCases) rows.push(await capture(profile, specimen, 'command'));
    for (const category of ['single-optional', 'kernel']) for (const specimen of shebangCases) rows.push(await capture(profile, specimen, category));
    for (const specimen of boundedCases) rows.push(await capture(profile, specimen, 'bounded'));
    results.push({ ...profile, version, bashVersion, rows });
  }
  const script = resolve(parent, 'kernel-argv.sh');
  const source = `#!${recorder} alpha beta\nunused\n`; await writeFile(script, source); await chmod(script, 0o755);
  const env = { PATH: bin, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
  const kernel = await run(script, ['tail'], parent, env, '', 3000, script);
  const literal = await run(recorder, ['alpha beta', script, 'tail'], parent, env, '', 3000, recorder);
  assert.ok(transport(kernel)); assert.ok(transport(literal));
  controls = { script: { path: script, source, mode: 0o755 }, cwd: parent, env, kernel: { executable: script, args: ['tail'], result: kernel }, literalSingleOptional: { executable: recorder, args: ['alpha beta', script, 'tail'], result: literal }, swVers: await run('/usr/bin/sw_vers', [], parent, controlEnv, ''), uname: await run('/usr/bin/uname', ['-a'], parent, controlEnv, ''), compilerVersion: await run('/usr/bin/cc', ['--version'], parent, controlEnv, '') };
} catch (error) { failure = { name: error.name, message: error.message, stack: error.stack }; }
const toolsAfter = await hashes(), inputsAfter = await inputs();
assert.deepEqual(toolsBefore, toolsAfter); assert.deepEqual(inputsBefore, inputsAfter);
assert.equal(sha256(await readFile(resolve(root, helperProof.path))), helperProof.sha256);
save(output, { startedAt, finishedAt: new Date().toISOString(), parent, toolsBefore, toolsAfter, inputsBefore, inputsAfter, helperProof, compile, recorderHash, controls, profiles: results, failure, commandRowsPerProfile: commandCases.length, singleOptionalRowsPerProfile: shebangCases.length, kernelRowsPerProfile: shebangCases.length, boundedRowsPerProfile: boundedCases.length, futureProductPrimaryRows: commandCases.length + shebangCases.length, nativePassesClaimed: false, boundary: 'single-optional is the uniform virtual shebang contract; actual Darwin kernel route is independent protocol evidence, never substituted per case. GNU9.7/Darwin primary versus Apple env/Bash3.2 whole historical profile.', productExecutions: 0 });
await rm(parent, { recursive: true, force: true });
const groups = [...results.flatMap(profile => profile.rows.map(row => row.result)), compile, ...(controls ? [controls.kernel.result, controls.literalSingleOptional.result] : [])].filter(Boolean);
save('native-cleanup.json', { parent, directoryRemoved: !existsSync(parent), allRecordedGroupsAbsent: groups.every(result => !result.groupAlive), rawSha256: sha256(await readFile(resolve(owned, output))) });
if (failure) throw new Error(failure.message);
console.log(JSON.stringify({ wholeProfiles: results.length, commandRowsEach: commandCases.length, singleOptionalEach: shebangCases.length, kernelEach: shebangCases.length, boundedEach: boundedCases.length, kernelArgvControls: 2, productExecutions: 0 }));
