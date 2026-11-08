import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';

const output = path.dirname(new URL(import.meta.url).pathname);
const scratch = fs.realpathSync(process.argv[2]);
assert.ok(scratch.startsWith('/private/tmp/safe-bash-published-auth-'));
const platformEnvironmentRemoved = Object.keys(process.env).filter(key => key === '__CF_USER_TEXT_ENCODING');
delete process.env.__CF_USER_TEXT_ENCODING;
const expectedEnvironment = ['HOME', 'TMPDIR', 'npm_config_cache', 'PATH', 'LANG', 'LC_ALL', 'TZ'];
assert.deepEqual(Object.keys(process.env).sort(), expectedEnvironment.sort());
for (const key of ['HOME', 'TMPDIR', 'npm_config_cache']) assert.ok(fs.realpathSync(process.env[key]).startsWith(`${scratch}/`));
const writeJson = (name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const digest = (bytes, algorithm) => crypto.createHash(algorithm).update(bytes).digest('hex');
const start = Date.now(), requests = [];
const limits = { metadataBytes: 2 * 1024 * 1024, tarballBytes: 16 * 1024 * 1024, requestMs: 30000, totalMs: 90000, redirects: 3 };
const validate = value => {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'registry.npmjs.org');
  assert.ok(!url.port || url.port === '443'); assert.ok(!url.username && !url.password && !url.hash);
  return url;
};
async function download(initialUrl, maximumBytes) {
  let current = validate(initialUrl);
  for (let hop = 0; hop <= limits.redirects; hop++) {
    assert.ok(Date.now() - start < limits.totalMs, 'total transport deadline');
    const record = { url: current.href, requestedAt: new Date().toISOString(), method: 'GET', requestHeaders: { Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'safe-bash-pinned-artifact-audit/1' } };
    requests.push(record);
    const response = await new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      const request = https.request(current, { method: 'GET', headers: record.requestHeaders, agent: false, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, incoming => {
        Object.assign(record, { responseAt: new Date().toISOString(), statusCode: incoming.statusCode, statusMessage: incoming.statusMessage, httpVersion: incoming.httpVersion, rawHeaders: incoming.rawHeaders, headers: incoming.headers });
        incoming.on('data', bytes => { size += bytes.length; if (size > maximumBytes) request.destroy(new Error('response byte ceiling')); else chunks.push(bytes); });
        incoming.on('error', reject);
        incoming.on('end', () => { clearTimeout(timer); const body = Buffer.concat(chunks); Object.assign(record, { completedAt: new Date().toISOString(), bytes: body.length, sha256: digest(body, 'sha256') }); resolve({ status: incoming.statusCode, headers: incoming.headers, body }); });
      });
      const timer = setTimeout(() => request.destroy(new Error('request/total deadline')), Math.min(limits.requestMs, limits.totalMs - (Date.now() - start)));
      request.on('socket', socket => socket.once('secureConnect', () => { record.tls = { authorized: socket.authorized, authorizationError: socket.authorizationError ?? null, protocol: socket.getProtocol(), peerFingerprint256: socket.getPeerCertificate().fingerprint256, servername: current.hostname }; }));
      request.on('error', error => { clearTimeout(timer); record.error = String(error); record.receivedBytes = size; reject(error); });
      request.end();
    });
    assert.ok(!response.headers['content-encoding'] || response.headers['content-encoding'] === 'identity');
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      record.redirectBodyBase64 = response.body.toString('base64');
      assert.ok(response.headers.location && hop < limits.redirects);
      current = validate(new URL(response.headers.location, current).href);
      continue;
    }
    assert.equal(response.status, 200);
    return { body: response.body, finalUrl: current.href };
  }
  throw new Error('redirect ceiling');
}
try {
  const metadata = await download('https://registry.npmjs.org/just-bash/3.4.2', limits.metadataBytes);
  fs.writeFileSync(path.join(output, 'registry-metadata.raw.json'), metadata.body, { flag: 'wx' });
  const manifest = JSON.parse(metadata.body);
  assert.equal(manifest.name, 'just-bash'); assert.equal(manifest.version, '3.4.2');
  assert.equal(validate(manifest.dist.tarball).href, 'https://registry.npmjs.org/just-bash/-/just-bash-3.4.2.tgz');
  const archive = await download(manifest.dist.tarball, limits.tarballBytes);
  const tarball = path.join(scratch, 'just-bash-3.4.2.tgz');
  fs.writeFileSync(tarball, archive.body, { flag: 'wx', mode: 0o600 });
  const actual = { bytes: archive.body.length, sha256: digest(archive.body, 'sha256'), sha1: digest(archive.body, 'sha1'), sha512: digest(archive.body, 'sha512'), sriSha512: `sha512-${crypto.createHash('sha512').update(archive.body).digest('base64')}` };
  const integrityMatches = actual.sriSha512 === manifest.dist.integrity && actual.sha1 === manifest.dist.shasum;
  writeJson('download.json', { startedAt: new Date(start).toISOString(), finishedAt: new Date().toISOString(), scratch, node: process.version, executable: fs.realpathSync(process.execPath), nodeSha256: digest(fs.readFileSync(process.execPath), 'sha256'), environment: process.env, platformEnvironmentRemoved, limits, officialMetadata: { url: metadata.finalUrl, bytes: metadata.body.length, sha256: digest(metadata.body, 'sha256') }, officialTarball: { url: archive.finalUrl, path: tarball }, expected: manifest.dist, actual, integrityMatches, requests, transportLimits: ['TLS verified using Node default trust; no ambient proxy/profile/credential/TLS option environment.', 'rawHeaders preserves Node-received header names/order/values, not an independently captured raw TLS wire transcript.', 'No signature/attestation verification or other package downloads.'] });
  assert.ok(integrityMatches, 'STOP: published archive digest mismatch');
  console.log(JSON.stringify({ scratch, actual, integrityMatches }));
} catch (error) {
  writeJson('download-failure.json', { at: new Date().toISOString(), error: String(error.stack ?? error), requests, productExecutionAllowed: false });
  throw error;
}
