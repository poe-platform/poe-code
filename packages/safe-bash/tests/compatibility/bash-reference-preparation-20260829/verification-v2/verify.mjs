import { mkdir, lstat, readFile, writeFile, open, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const output = root + 'RUN-01/';
const started = performance.now();
await mkdir(output, { mode: 0o700 });
const save = (relative, value) => writeFile(output + relative, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
await save('STARTUP.json', { startedAt: new Date().toISOString(), authorizedChildren: 17, network: false });
let starts = 0;
let ownedClosed = true;
let totalCapture = 0;
const outcomes = [];
const children = [];
const planStat = await lstat(root + 'plan.json');
assert(planStat.isFile() && !planStat.isSymbolicLink() && planStat.size < 1048576);
const planBytes = await readFile(root + 'plan.json');
const plan = JSON.parse(planBytes.toString('utf8'));
const clock = () => assert(performance.now() - started < plan.controllerMs, 'CONTROLLER_DEADLINE');
const check = async identity => {
  clock();
  const before = await lstat(identity.path, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink(), 'REGULAR_INPUT');
  assert.equal(Number(before.size), identity.bytes, 'SIZE_CHANGED');
  assert.equal(Number(before.mode & 0o777n).toString(8), identity.mode, 'MODE_CHANGED');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(identity.path, { highWaterMark: 65536 })) { clock(); digest.update(chunk); }
  assert.equal(digest.digest('hex'), identity.sha256, 'HASH_CHANGED');
  const after = await lstat(identity.path, { bigint: true });
  assert(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs, 'INPUT_CHANGED_DURING_READ');
};
const generatedIdentity = async path => {
  const status = await lstat(path);
  assert(status.isFile() && !status.isSymbolicLink() && status.size > 0 && status.size <= 4194304);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) digest.update(chunk);
  return { path, bytes: status.size, mode: (status.mode & 0o777).toString(8), sha256: digest.digest('hex') };
};
const native = async (id, executable, argv) => {
  clock();
  assert(starts < plan.maxChildren);
  const directory = output + id + '/';
  await mkdir(directory, { mode: 0o700 });
  for (const name of ['home', 'gnupg', 'tmp', 'empty']) await mkdir(directory + name, { mode: 0o700 });
  const environment = { HOME: directory + 'home', GNUPGHOME: directory + 'gnupg', TMPDIR: directory + 'tmp', PATH: directory + 'empty', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', DYLD_PRINT_LIBRARIES: '1' };
  const stdout = await open(directory + 'stdout.raw', 'wx', 0o600);
  const stderr = await open(directory + 'stderr.raw', 'wx', 0o600);
  await save(id + '/ADMISSION.json', { executable, argv, environment, cwd: directory + 'home' });
  const bodyStarted = performance.now();
  const events = [];
  const lengths = { stdout: 0, stderr: 0 };
  let disposition;
  let failure;
  let timer;
  let closeTimer;
  try {
    starts++;
    ownedClosed = false;
    const child = spawn(executable, argv, { shell: false, detached: true, env: environment, cwd: directory + 'home', stdio: ['ignore', 'pipe', 'pipe'] });
    events.push({ type: 'spawn', pid: child.pid ?? null });
    const kill = reason => {
      failure ??= new Error(reason);
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') failure = error; } }
    };
    const capture = async (source, handle, name) => {
      try {
        for await (const chunk of source) {
          lengths[name] += chunk.length;
          totalCapture += chunk.length;
          assert(lengths[name] <= plan.streamBytes && totalCapture <= 16777216, 'CAPTURE_CAP');
          await handle.writeFile(chunk);
        }
      } catch (error) { failure ??= error; kill('CAPTURE_FAILURE'); }
    };
    const captured = Promise.all([capture(child.stdout, stdout, 'stdout'), capture(child.stderr, stderr, 'stderr')]);
    disposition = await new Promise((resolve, reject) => {
      child.once('error', error => { failure ??= error; events.push({ type: 'error', message: error.message }); });
      child.once('exit', (code, signal) => events.push({ type: 'exit', code, signal, elapsedMs: performance.now() - bodyStarted }));
      child.once('close', (code, signal) => { ownedClosed = true; events.push({ type: 'close', code, signal, elapsedMs: performance.now() - bodyStarted }); resolve({ code, signal }); });
      timer = setTimeout(() => kill('CASE_DEADLINE'), Math.min(plan.caseMs, plan.controllerMs - (performance.now() - started)));
      closeTimer = setTimeout(() => { kill('UNKNOWN_RETIREMENT'); reject(new Error('UNKNOWN_RETIREMENT')); }, Math.min(plan.caseMs + plan.closeGraceMs, plan.controllerMs - (performance.now() - started)));
    });
    await captured;
    if (failure) throw failure;
  } finally {
    clearTimeout(timer);
    clearTimeout(closeTimer);
    await stdout.close();
    await stderr.close();
    const result = { id, executable, argv, disposition, events, lengths, ownedClosed, failure: failure?.message ?? null, elapsedMs: performance.now() - bodyStarted };
    children.push(result);
    await save(id + '/CHILD.json', result);
  }
  const outputText = await readFile(directory + 'stdout.raw', 'utf8');
  const errorText = await readFile(directory + 'stderr.raw', 'utf8');
  const images = [];
  for (const line of errorText.split('\n')) {
    const match = /^dyld\[\d+\]: <([A-Fa-f0-9-]+)> (.+)$/.exec(line);
    if (!match) continue;
    const path = match[2];
    const bound = plan.closure.some(row => row.path === path || row.resolved === path);
    assert(bound || path.startsWith('/usr/lib/') || path.startsWith('/System/Library/'), 'UNEXPECTED_EXTERNAL_LOADER_IMAGE');
    images.push({ uuid: match[1], path, role: bound ? 'PINNED_IMAGE' : 'PLATFORM_CACHE_IMAGE' });
  }
  const homeEntries = await readdir(directory + 'gnupg');
  for (const name of homeEntries) {
    const status = await lstat(directory + 'gnupg/' + name);
    assert(status.isFile() && !status.isSymbolicLink() && name === 'trustdb.gpg', 'UNEXPECTED_KEY_HOME_OBJECT');
  }
  await save(id + '/LOADER-HOME.json', { images, homeEntries });
  return { disposition, outputText, images: images.length, homeEntries };
};
try {
  assert.equal(plan.pairs.length, 16);
  assert.equal(plan.acquiredArtifacts.length, 33);
  assert.equal(plan.authoritativePrimary, '7C0135FB088AAF6C66C650B9BB5869F064EA74AB');
  assert.equal(plan.globalKeyringUsedForVerification, false);
  assert.equal(process.execPath, plan.node.path);
  const checked = [...plan.acquiredArtifacts, ...plan.authorityArtifacts, ...plan.closure, plan.node];
  for (const identity of checked) await check(identity);
  await save('INPUT-ADMISSION.json', { planSha256: createHash('sha256').update(planBytes).digest('hex'), checkedIdentities: checked, sourceCommits: plan.sourceCommits, stage: 'BEFORE_CRYPTO_CHILDREN' });
  await mkdir(output + 'keyring', { mode: 0o700 });
  const keyringResult = await native('KEYRING', plan.gpg.path, plan.dearmorArgs);
  assert.equal(keyringResult.disposition.code, 0, 'KEYRING_PREPARATION_REFUSED');
  const keyring = await generatedIdentity(plan.keyringPath);
  assert.equal(keyring.mode, '600');
  await save('KEYRING-BINDING.json', { source: plan.key, generated: keyring, conversion: 'PINNED_GPG_DEARMOR_NO_IMPORT', attributedPrimary: plan.authoritativePrimary });
  for (const pair of plan.pairs) {
    for (const identity of [plan.gpgv, keyring, pair.payload, pair.signature]) await check(identity);
    const result = await native(pair.id, plan.gpgv.path, pair.argv);
    for (const identity of [plan.gpgv, keyring, pair.payload, pair.signature]) await check(identity);
    const machine = result.outputText.split('\n').filter(line => line.length).map(line => {
      assert(line.startsWith('[GNUPG:] '), 'UNRECOGNIZED_MACHINE_STREAM');
      const [code, ...fields] = line.slice(9).split(' ');
      return { raw: line, code, fields };
    });
    const valid = machine.filter(row => row.code === 'VALIDSIG');
    const adverse = machine.filter(row => ['BADSIG', 'ERRSIG', 'NO_PUBKEY', 'EXPSIG', 'EXPKEYSIG', 'REVKEYSIG', 'KEYEXPIRED', 'KEYREVOKED', 'SIGEXPIRED', 'FAILURE', 'ERROR'].includes(row.code));
    const signatures = valid.map(row => ({ signingFingerprint: row.fields[0] ?? null, primaryFingerprintField: row.fields[9] ?? null, directAttributedPrimaryMatch: row.fields[0] === plan.authoritativePrimary, signatureDate: row.fields[1] ?? null, timestamp: row.fields[2] ?? null, expiration: row.fields[3] ?? null, publicKeyAlgorithm: row.fields[6] ?? null, digestAlgorithm: row.fields[7] ?? null, signatureClass: row.fields[8] ?? null }));
    const attributed = signatures.length === 1 && (signatures[0].primaryFingerprintField === plan.authoritativePrimary || signatures[0].primaryFingerprintField === null && signatures[0].directAttributedPrimaryMatch);
    const acceptable = result.disposition.code === 0 && machine.some(row => row.code === 'GOODSIG') && adverse.length === 0 && attributed;
    const outcome = { id: pair.id, name: pair.name, payload: pair.payload, signature: pair.signature, keyring, exit: result.disposition, machine, validSignatures: signatures, adverse, attributed, classification: acceptable ? 'VALID_SIGNATURE_WITH_SOURCE_ATTRIBUTED_PRIMARY' : 'LITERAL_REFUSAL_OR_UNATTRIBUTED_RESULT', unknownSignerHints: machine.filter(row => row.code === 'ERRSIG' || row.code === 'NO_PUBKEY').map(row => ({ raw: row.raw, untrustedHintOnly: true })), imagesObserved: result.images, keyHomeEntries: result.homeEntries };
    outcomes.push(outcome);
    await save(pair.id + '/OUTCOME.json', outcome);
  }
  for (const identity of checked) await check(identity);
  await check(keyring);
  await save('INPUT-POSTCHECK.json', { checkedCount: checked.length + 1, stage: 'AFTER_ALL_CHILDREN_CLOSED', unchanged: true });
} catch (error) {
  process.exitCode = 1;
  await save('FAILURE.json', { name: error.name, message: error.message, starts, ownedClosed, pairsCompleted: outcomes.length });
} finally {
  const result = { startedAt: (await readFile(output + 'STARTUP.json', 'utf8')).trim(), endedAt: new Date().toISOString(), elapsedMs: performance.now() - started, status: process.exitCode ? 'STOP' : 'ALL_16_OUTCOMES_CAPTURED', starts, ownedClosed, childrenClosed: children.filter(row => row.ownedClosed).length, totalCapture, completedPairs: outcomes.length, attributedValid: outcomes.filter(row => row.classification === 'VALID_SIGNATURE_WITH_SOURCE_ATTRIBUTED_PRIMARY').length, literalRefusals: outcomes.filter(row => row.classification !== 'VALID_SIGNATURE_WITH_SOURCE_ATTRIBUTED_PRIMARY').length, unrunPairs: 16 - outcomes.length, outcomes, children, network: false, globalKeyringUsed: false, noRuntimeOrContainmentQualification: true };
  await save('RESULT.json', result);
  console.log(JSON.stringify({ status: result.status, starts, childrenClosed: result.childrenClosed, completedPairs: result.completedPairs, attributedValid: result.attributedValid, literalRefusals: result.literalRefusals, unrunPairs: result.unrunPairs, elapsedMs: result.elapsedMs }));
}
