import { mkdir, lstat, readFile, writeFile, open, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const output = root + 'KEY-INSPECTION-01/';
await mkdir(output, { mode: 0o700 });
const save = (name, value) => writeFile(output + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
await save('STARTUP.json', { startedAt: new Date().toISOString(), maxChildren: 1, purpose: 'PUBLIC_KEY_METADATA_NOT_SIGNATURE_VERIFICATION' });
const started = performance.now();
let ownedClosed = true;
let starts = 0;
const events = [];
const lengths = { stdout: 0, stderr: 0 };
const readJson = async relative => {
  const stat = await lstat(root + relative);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size < 1048576);
  return JSON.parse(await readFile(root + relative, 'utf8'));
};
const check = async identity => {
  const path = identity.resolved ?? identity.path;
  const before = await lstat(path, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink());
  assert.equal(Number(before.size), identity.bytes);
  assert.equal(Number(before.mode & 0o777n).toString(8), identity.mode);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) {
    assert(performance.now() - started < 180000);
    digest.update(chunk);
  }
  assert.equal(digest.digest('hex'), identity.sha256);
  const after = await lstat(path, { bigint: true });
  assert(before.ino === after.ino && before.dev === after.dev && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs);
};
try {
  const closure = await readJson('CLOSURE-01/CLOSURE.json');
  const cache = await readJson('AUTHORITY-CACHE-01/CACHE.json');
  const metadata = await readJson('PREPARE-01/METADATA.json');
  const key = { path: root + 'PUBLISHER-KEY-01/maintainer-public-key.data', bytes: 2200, mode: '600', sha256: 'db4041b4d3896b9f21250e6c29861958bd5d4781f521f06beda849a9ed79fae8' };
  const identities = [...closure.bindings, ...cache.selected, ...metadata.filter(row => row.path === '/usr/lib/dyld' || row.path === '/System/Library/CoreServices/SystemVersion.plist'), key];
  assert.equal(closure.unresolved.length, 0);
  assert.equal(cache.selected.length, 15);
  for (const identity of identities) await check(identity);
  for (const name of ['home', 'gnupg', 'tmp', 'empty']) await mkdir(output + name, { mode: 0o700 });
  const executable = '/opt/homebrew/Cellar/gnupg/2.5.21/bin/gpg';
  const argv = ['--no-options', '--homedir', output + 'gnupg', '--batch', '--no-autostart', '--no-default-keyring', '--no-keyring', '--no-auto-check-trustdb', '--no-auto-key-locate', '--no-auto-key-retrieve', '--no-auto-key-import', '--with-colons', '--with-fingerprint', '--with-subkey-fingerprint', '--show-keys', key.path];
  const env = { HOME: output + 'home', GNUPGHOME: output + 'gnupg', TMPDIR: output + 'tmp', PATH: output + 'empty', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', DYLD_PRINT_LIBRARIES: '1' };
  await save('ADMISSION.json', { executable, argv, env, identities, platformQualification: 'STATIC_CACHE_HASHES_PLUS_ACTUAL_DYLD_DIAGNOSTICS_NOT_OS_FENCE' });
  const stdout = await open(output + 'stdout.raw', 'wx', 0o600);
  const stderr = await open(output + 'stderr.raw', 'wx', 0o600);
  let timer;
  let closeTimer;
  let failure;
  let disposition;
  const bodyStarted = performance.now();
  try {
    starts++;
    ownedClosed = false;
    const child = spawn(executable, argv, { shell: false, detached: true, cwd: output + 'home', env, stdio: ['ignore', 'pipe', 'pipe'] });
    events.push({ event: 'spawn', pid: child.pid ?? null });
    const kill = reason => {
      failure ??= new Error(reason);
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') failure = error; } }
    };
    const capture = async (source, handle, name) => {
      try {
        for await (const chunk of source) {
          lengths[name] += chunk.length;
          assert(lengths[name] <= 262144, 'CAPTURE_CAP');
          await handle.writeFile(chunk);
        }
      } catch (error) { failure ??= error; kill('CAPTURE_FAILURE'); }
    };
    const captured = Promise.all([capture(child.stdout, stdout, 'stdout'), capture(child.stderr, stderr, 'stderr')]);
    disposition = await new Promise((resolve, reject) => {
      child.once('error', error => { failure ??= error; events.push({ event: 'error', message: error.message }); });
      child.once('exit', (code, signal) => events.push({ event: 'exit', code, signal, elapsedMs: performance.now() - bodyStarted }));
      child.once('close', (code, signal) => { ownedClosed = true; events.push({ event: 'close', code, signal, elapsedMs: performance.now() - bodyStarted }); resolve({ code, signal }); });
      timer = setTimeout(() => kill('BODY_DEADLINE'), 10000);
      closeTimer = setTimeout(() => { kill('UNKNOWN_RETIREMENT'); reject(new Error('UNKNOWN_RETIREMENT')); }, 11000);
    });
    await captured;
    if (failure) throw failure;
    assert.equal(disposition.code, 0, 'PUBLIC_KEY_METADATA_NONZERO');
  } finally {
    clearTimeout(timer);
    clearTimeout(closeTimer);
    await stdout.close();
    await stderr.close();
    await save('CHILD.json', { events, lengths, starts, ownedClosed, disposition, failure: failure?.message ?? null });
  }
  for (const identity of identities) await check(identity);
  const homeEntries = await readdir(output + 'gnupg');
  await save('RESULT.json', { status: 'PUBLIC_KEY_METADATA_CAPTURED_NOT_SIGNATURE_ACCEPTANCE', starts, ownedClosed, homeEntries, elapsedMs: performance.now() - started, verifiedPairs: 0, closureIdentitiesRechecked: identities.length });
} catch (error) {
  process.exitCode = 1;
  await save('FAILURE.json', { name: error.name, message: error.message, starts, ownedClosed, events, lengths });
}
