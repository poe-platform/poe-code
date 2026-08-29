import { mkdir, open, lstat, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('./', import.meta.url));
const output = root + 'RUN-01/';
const started = performance.now();
const startedAt = new Date().toISOString();
let starts = 0;
let ownedClosed = true;
let totalBytes = 0;
const results = [];
const save = (name, value) => writeFile(output + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const binding = async path => {
  const before = await lstat(path, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink() && before.size <= 268435456n, 'REGULAR_BINARY_ADMISSION');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) digest.update(chunk);
  const after = await lstat(path, { bigint: true });
  assert(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs, 'IDENTITY_CHANGED');
  return { path, bytes: Number(before.size), mode: Number(before.mode & 0o777n).toString(8), sha256: digest.digest('hex'), dev: before.dev.toString(), ino: before.ino.toString() };
};
await mkdir(output, { mode: 0o700 });
await save('STARTUP.json', { role: 'OUTER_CAPTURE_BEFORE_ADMISSION', startedAt, pid: process.pid, childrenAuthorized: 1, archiveExtraction: false });
try {
  const planBinding = await binding(root + 'plan.json');
  const plan = JSON.parse(await readFile(root + 'plan.json', 'utf8'));
  const tools = { controller: await binding(fileURLToPath(import.meta.url)), plan: planBinding, node: await binding(process.execPath), nodeVersion: process.version, bash: await binding('/bin/bash'), gpgvMetadataOnly: await binding('/opt/homebrew/Cellar/gnupg/2.5.21/bin/gpgv') };
  assert.equal(tools.bash.sha256, plan.versionProbe.sha256);
  assert.equal(tools.bash.bytes, plan.versionProbe.bytes);
  assert.equal(tools.bash.mode, plan.versionProbe.mode);
  assert.equal(tools.gpgvMetadataOnly.sha256, 'd9eb7bc783a1a0f1f39bb1f12ff0c94d7c2aac3b25aac2a7909a647d60be7bd4');
  await save('TOOLS.json', tools);
  for (const name of ['home', 'tmp', 'cwd', 'empty-path', 'downloads']) await mkdir(output + name, { mode: 0o700 });
  const environment = { LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: output + 'home', TMPDIR: output + 'tmp', PATH: output + 'empty-path' };
  const stdout = await open(output + 'bash-version.stdout.raw', 'wx', 0o600);
  const stderr = await open(output + 'bash-version.stderr.raw', 'wx', 0o600);
  const events = [];
  await save('VERSION-ADMISSION.json', { executable: tools.bash, argv: plan.versionProbe.argv, environment, cwd: output + 'cwd', signalDeadlineMs: 3000, role: 'ONE_METADATA_PROBE_NOT_FENCE_OR_ORACLE_ADMISSION' });
  const probeStarted = performance.now();
  let termination = null;
  let timer;
  let closeGuard;
  let streamFailure;
  const lengths = { stdout: 0, stderr: 0 };
  try {
    assert.equal(starts, 0);
    starts++;
    ownedClosed = false;
    const child = spawn('/bin/bash', plan.versionProbe.argv, { cwd: output + 'cwd', env: environment, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    events.push({ event: 'spawn-request', elapsedMs: performance.now() - probeStarted, pid: child.pid ?? null });
    const kill = reason => {
      termination ??= reason;
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') streamFailure ??= error; } }
    };
    const consume = async (source, destination, name) => {
      try {
        for await (const chunk of source) {
          if (lengths[name] + chunk.length > 65536) { kill('CAPTURE_LIMIT'); throw new Error('CAPTURE_LIMIT'); }
          lengths[name] += chunk.length;
          await destination.writeFile(chunk);
        }
      } catch (error) { streamFailure ??= error; kill('STREAM_FAILURE'); }
    };
    const consumed = Promise.all([consume(child.stdout, stdout, 'stdout'), consume(child.stderr, stderr, 'stderr')]);
    const closed = new Promise((resolve, reject) => {
      child.once('error', error => { events.push({ event: 'spawn-error', message: error.message }); streamFailure ??= error; });
      child.once('exit', (code, signal) => events.push({ event: 'exit', code, signal, elapsedMs: performance.now() - probeStarted }));
      child.once('close', (code, signal) => { ownedClosed = true; events.push({ event: 'close', code, signal, elapsedMs: performance.now() - probeStarted }); resolve({ code, signal }); });
      timer = setTimeout(() => kill('BODY_DEADLINE'), 3000);
      closeGuard = setTimeout(() => { kill('UNKNOWN_RETIREMENT'); reject(new Error('UNKNOWN_RETIREMENT')); }, 4000);
    });
    const disposition = await closed;
    await consumed;
    if (streamFailure) throw streamFailure;
    assert.equal(termination, null, 'PROBE_TERMINATED');
    assert.equal(disposition.code, 0, 'VERSION_PROBE_NONZERO');
  } finally {
    clearTimeout(timer);
    clearTimeout(closeGuard);
    await stdout.close();
    await stderr.close();
    await save('VERSION-RESULT.json', { events, lengths, termination, ownedClosed, elapsedMs: performance.now() - probeStarted, starts, status: ownedClosed && !termination && !streamFailure ? 'CLOSED_METADATA_ONLY' : 'STOP' });
  }
  const after = await binding('/bin/bash');
  assert.equal(after.sha256, plan.versionProbe.sha256);
  assert.equal(after.bytes, plan.versionProbe.bytes);
  assert.equal(after.mode, plan.versionProbe.mode);
  await save('VERSION-POST-IDENTITY.json', after);
  const requests = plan.payloads.flatMap(payload => [
    { url: plan.artifactOrigin + payload.path, name: payload.path.split('/').at(-1), maxBytes: payload.maxBytes, role: 'OPAQUE_SOURCE' },
    { url: plan.artifactOrigin + payload.path + plan.signatureSuffix, name: payload.path.split('/').at(-1) + plan.signatureSuffix, maxBytes: plan.signatureMaxBytes, role: 'OPAQUE_DETACHED_SIGNATURE' },
  ]).concat(plan.verification);
  assert.equal(requests.length, plan.maxRequests);
  await save('REQUESTS.json', requests);
  for (const request of requests) {
    const remaining = plan.controllerTimeoutMs - (performance.now() - started);
    assert(remaining > 0, 'OVERALL_DEADLINE');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('REQUEST_DEADLINE')), Math.min(plan.requestTimeoutMs, remaining));
    const result = { ...request, startedAt: new Date().toISOString(), bytes: 0 };
    let reader;
    let destination;
    try {
      const response = await fetch(request.url, { redirect: 'manual', credentials: 'omit', signal: controller.signal, headers: { 'accept-encoding': 'identity' } });
      result.status = response.status;
      result.headers = Object.fromEntries(['date', 'last-modified', 'etag', 'content-length', 'content-type', 'location'].map(name => [name, response.headers.get(name)]));
      if (response.status !== 200) { await response.body?.cancel(); result.disposition = 'HTTP_UNAVAILABLE_NOT_AUTHENTICATED'; continue; }
      const claimed = response.headers.get('content-length');
      if (claimed !== null) assert(/^\d+$/.test(claimed) && Number(claimed) <= request.maxBytes, 'DECLARED_SIZE_CAP');
      destination = await open(output + 'downloads/' + request.name + '.data', 'wx', 0o600);
      const digest = createHash('sha256');
      reader = response.body?.getReader();
      assert(reader, 'MISSING_BODY');
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        result.bytes += part.value.byteLength;
        totalBytes += part.value.byteLength;
        assert(result.bytes <= request.maxBytes && totalBytes <= plan.maxBodyBytesTotal, 'BODY_CAPTURE_CAP');
        digest.update(part.value);
        await destination.writeFile(part.value);
      }
      if (claimed !== null) assert.equal(result.bytes, Number(claimed), 'DECLARED_LENGTH_MISMATCH');
      result.sha256 = digest.digest('hex');
      result.path = 'downloads/' + request.name + '.data';
      result.disposition = 'OPAQUE_ACQUIRED_NOT_SIGNATURE_VERIFIED';
    } catch (error) {
      result.error = { name: error.name, message: error.message, causeCode: error.cause?.code };
      result.disposition = 'REQUEST_FAILED';
      if (error.name === 'AssertionError' || error.code === 'EEXIST' || error.code === 'ENOSPC') throw error;
    } finally {
      controller.abort();
      if (reader) await reader.cancel().catch(() => {});
      if (destination) await destination.close();
      clearTimeout(timeout);
      result.endedAt = new Date().toISOString();
      results.push(result);
      await save(`request-${String(results.length).padStart(2, '0')}.json`, result);
    }
  }
} catch (error) {
  process.exitCode = 1;
  await save('FAILURE.json', { name: error.name, message: error.message, ownedClosed, starts });
} finally {
  await save('RESULT.json', { startedAt, endedAt: new Date().toISOString(), elapsedMs: performance.now() - started, requestsAttempted: results.length, acquired: results.filter(row => row.disposition === 'OPAQUE_ACQUIRED_NOT_SIGNATURE_VERIFIED').length, totalBytes, starts, ownedClosed, signatureVerifications: 0, extraction: false, results, status: process.exitCode ? 'STOP' : 'ACQUISITION_COMPLETED_WITH_RECORDED_AVAILABILITY', limitations: ['NO_SIGNATURE_OR_SIGNER_FINGERPRINT_VERIFICATION', 'NO_EXTRACT_BUILD_OR_PATCH', 'METADATA_PROBE_NOT_PROVIDER_FENCE'] });
}
