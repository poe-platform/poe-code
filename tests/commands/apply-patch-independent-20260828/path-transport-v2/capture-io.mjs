import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ownership, retired, supervise } from './supervisor.mjs';
import { deadline } from './deadline.mjs';
import { sha256 } from './path-bytes.mjs';

export function recorder(directory, repository) {
  assert.equal(fs.existsSync(directory), false, 'unique capture'); fs.mkdirSync(directory, { recursive: true });
  const clock = deadline(1800000), owners = [], receipts = [];
  let rawBytes = 0, persistentBytes = 0;
  function put(name, bytes) {
    const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(JSON.stringify(bytes, null, 2) + '\n');
    persistentBytes += payload.length; assert.ok(persistentBytes <= 128 * 1024 * 1024, 'capture128MiB');
    fs.writeFileSync(path.join(directory, name), payload, { flag: 'wx' });
  }
  async function git(id, args, input) {
    assert.ok(owners.every(retired)); assert.ok(!receipts.some(item => item.id === id)); clock.check(id, 13000);
    assert.ok(rawBytes + 16 * 1024 * 1024 <= 128 * 1024 * 1024);
    const owner = ownership(id, 'metadata-git'); owners.push(owner);
    const run = await supervise('/usr/bin/git', ['--no-replace-objects', ...args], { cwd: repository, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', HOME: directory, TMPDIR: directory }, input, timeoutMs: 10000, maxBytes: 16 * 1024 * 1024 }, owner, clock);
    rawBytes += run.bytes;
    const fragments = [];
    for (const channel of ['stdout', 'stderr']) {
      const bytes = Buffer.from(run[channel + 'Base64'], 'base64');
      for (let offset = 0; offset < bytes.length; offset += 65536) {
        const fragment = bytes.subarray(offset, offset + 65536), name = `${id}-${channel}-${offset}.json`;
        const record = { channel, offset, totalBytes: bytes.length, base64: fragment.toString('base64'), sha256: sha256(fragment) };
        put(name, record); fragments.push({ name, bytes: fragment.length, sha256: record.sha256 });
      }
    }
    const { stdout, stderr, stdoutBase64, stderrBase64, ...description } = run;
    const receipt = { id, ...description, fragments, stdoutSha256: sha256(Buffer.from(stdoutBase64, 'base64')), stderrSha256: sha256(Buffer.from(stderrBase64, 'base64')), knownChildCleanup: retired(owner) };
    put(`${id}.json`, receipt); receipts.push(receipt);
    assert.ok(retired(owner)); assert.equal(run.fault, null); assert.equal(run.code, 0); assert.equal(run.signal, null);
    return Buffer.from(stdoutBase64, 'base64');
  }
  return { git, put, finish: () => ({ elapsedMs: clock.elapsed(), rawBytes, persistentBytes, childCount: owners.length, peakOwnedProcesses: owners.length ? 2 : 1, allRetired: owners.every(retired), remainingHandles: owners.filter(owner => !retired(owner)).length, receipts }) };
}
export function readCapture(directory, id) {
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, `${id}.json`)));
  assert.equal(receipt.id, id); assert.equal(receipt.code, 0); assert.equal(receipt.signal, null); assert.equal(receipt.fault, null);
  assert.equal(receipt.closeObserved, true); assert.equal(receipt.groupAbsent, true); assert.equal(receipt.knownChildCleanup, true);
  const channels = {};
  for (const channel of ['stdout', 'stderr']) {
    const chunks = []; let offset = 0, total;
    for (const descriptor of receipt.fragments.filter(item => item.name.startsWith(`${id}-${channel}-`))) {
      assert.equal(descriptor.name, `${id}-${channel}-${offset}.json`);
      const fragment = JSON.parse(fs.readFileSync(path.join(directory, descriptor.name)));
      const bytes = Buffer.from(fragment.base64, 'base64'); assert.equal(bytes.toString('base64'), fragment.base64);
      assert.equal(fragment.channel, channel); assert.equal(fragment.offset, offset); assert.ok(bytes.length > 0 && bytes.length <= 65536);
      assert.equal(bytes.length, descriptor.bytes); assert.equal(sha256(bytes), descriptor.sha256); assert.equal(sha256(bytes), fragment.sha256);
      total ??= fragment.totalBytes; assert.equal(fragment.totalBytes, total); chunks.push(bytes); offset += bytes.length;
    }
    assert.equal(offset, total ?? 0); channels[channel] = Buffer.concat(chunks); assert.equal(sha256(channels[channel]), receipt[channel + 'Sha256']);
  }
  assert.equal(receipt.fragments.length, receipt.fragments.filter(item => item.name.startsWith(`${id}-stdout-`) || item.name.startsWith(`${id}-stderr-`)).length);
  assert.equal(channels.stdout.length + channels.stderr.length, receipt.bytes);
  return channels.stdout;
}
