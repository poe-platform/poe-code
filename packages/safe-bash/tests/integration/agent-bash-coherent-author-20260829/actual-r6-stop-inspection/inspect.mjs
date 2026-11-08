import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Owner, identity, writeAll } from '../admin-owner-r1/tracked-owner.mjs';
const repo = '/Users/kjopek/Workspace/safe-bash', relative = 'tests/integration/agent-bash-coherent-author-20260829/actual-r6-stop-inspection';
const root = path.join(repo, relative), raw = '/private/tmp/b1-actual-r6-stop-inspection';
const owner = new Owner({ raw, cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: raw, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' }, tools: [], wallMs: 150000, reserveMs: 30000, cleanupMs: 2000, maxStarts: 5, peak: 2, captureLimit: 1048576, metadataLimit: 8388608, tailBytes: 65536 });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const observations = [];
function inspect(filename, expected) {
  let before;
  try { before = fs.lstatSync(filename); } catch (error) { if (error.code === 'ENOENT') { const result = { path: filename, status: 'ABSENT_AT_INSPECTION', implication: 'Not proof of zero activity or clean retirement' }; observations.push(result); return result; } throw error; }
  const metadata = { path: filename, bytes: before.size, mode: before.mode & 0o7777, inode: before.ino, dev: before.dev, mtimeMs: before.mtimeMs };
  if (!before.isFile() || before.isSymbolicLink() || before.size > 1048576) { const result = { ...metadata, status: 'TYPE_OR_SIZE_REFUSED_NO_CONTENT_READ' }; observations.push(result); return result; }
  if (expected) { assert.equal(before.size, expected.bytes); }
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try { const opened = fs.fstatSync(descriptor); assert.equal(opened.ino, before.ino); assert.equal(opened.dev, before.dev); assert.equal(opened.size, before.size); bytes = Buffer.alloc(before.size); let offset = 0; while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset); assert(count > 0); offset += count; } const extra = Buffer.alloc(1); assert.equal(fs.readSync(descriptor, extra, 0, 1, before.size), 0); } finally { fs.closeSync(descriptor); }
  const digest = hash(bytes); if (expected) assert.equal(digest, expected.sha256);
  const after = fs.lstatSync(filename); assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); assert.equal(after.size, before.size); assert.equal(after.mode, before.mode); assert.equal(after.mtimeMs, before.mtimeMs);
  const result = { ...metadata, sha256: digest, status: 'READONLY_OBSERVED', stableSizeModeInodeMtime: true, excerpt: bytes.subarray(0, 16384).toString('utf8'), excerptTruncated: bytes.length > 16384 };
  observations.push(result); return { ...result, buffer: bytes };
}
const git = async (role, args) => { const result = await owner.run(role, '/usr/bin/git', args, 15000); assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, 0); return fs.readFileSync(result.files[0], 'utf8').trim(); };
try {
  assert.equal(fs.existsSync(raw), false); fs.mkdirSync(raw); owner.persist(path.join(raw, 'START.json'), owner.snapshot());
  const finalPath = path.join(repo, 'tests/integration/agent-bash-coherent-author-20260829/final-admin-r6/FINAL.json');
  const final = inspect(finalPath, { bytes: 24620, sha256: '8bd385557c356994062d62fb10d9aef485e3c440dd509e68220425ae770e03a9' });
  const packet = JSON.parse(final.buffer);
  for (const tool of packet.tools) assert.deepEqual(identity(tool.path, 128 * 1024 * 1024), tool); owner.config.tools = packet.tools;
  const stdout = inspect('/private/tmp/coherent-b1-r5-owner.stdout');
  const stderr = inspect('/private/tmp/coherent-b1-r5-owner.stderr');
  const exactPaths = [...new Set([...Object.values(packet.slots), path.join(packet.runtimeRoot, 'RESULT.json'), path.join(packet.runtimeRoot, 'STOP.json'), path.join(packet.runtimeRoot, 'capture/events.jsonl'), path.join(packet.publicationRoot, 'FINAL.json'), path.join(packet.publicationRoot, 'git-add.stdout'), path.join(packet.captureRoot, 'runtime-coordinator.stdout'), path.join(packet.captureRoot, 'runtime-coordinator.stderr'), path.join(packet.captureRoot, 'publication-preimport.stdout'), path.join(packet.captureRoot, 'publication-preimport.stderr'), path.join(packet.captureRoot, 'publisher.stdout'), path.join(packet.captureRoot, 'publisher.stderr')])];
  const existing = [];
  for (const filename of exactPaths) {
    assert([packet.adminRoot, packet.runtimeRoot, packet.publicationRoot].some(parent => filename.startsWith(parent + '/')));
    const result = inspect(filename);
    if (result.buffer && filename.endsWith('.json')) {
      try { existing.push({ path: filename, value: JSON.parse(result.buffer) }); } catch { existing.push({ path: filename, parse: 'MALFORMED_RETAINED' }); }
    }
  }
  const report = { schema: 'B1-r6-readonly-stop-inspection', observedUTC: new Date().toISOString(), phase: 'SEPARATE_INSPECTION_NOT_ACTUAL_LEDGER', actualToolResult: 'Exact requested route returned exit78; no phase output to tool channel', rootAuthority: 'ROOT qualified adjudication accepted for actual attempt; independent reviewer terminal HOLD remains, not rewritten PASS', ownerStdout: stdout.path, ownerStderr: stderr.path, observations, existingJournals: existing, inferencePolicy: 'Absent journals do not establish zero calls/roles or cleanup. No signals, replay, publication-main invocation or prior artifact edits.', actualRoleCount: 'UNKNOWN unless an existing journal records it', actualWorkerRetirement: 'UNKNOWN unless an existing journal records it', inspectionOwner: owner.snapshot() };
  owner.terminal = true;
  owner.persist(path.join(root, 'REPORT.json'), report);
  const paths = [relative + '/inspect.mjs', relative + '/launch.sh', relative + '/REPORT.json'];
  await git('git-inspection-add', ['add', '--', ...paths]);
  await git('git-inspection-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Preserve separate read-only inspection of B1 r6 STOP captures', '--', ...paths]);
  const commit = await git('git-inspection-receipt', ['rev-parse', 'HEAD']);
  const receipt = owner.persist(path.join(raw, 'FINAL.json'), { commit, report: identity(path.join(root, 'REPORT.json'), 1048576), snapshot: owner.snapshot(), ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION' });
  const output = Buffer.from(JSON.stringify({ commit, receipt, stderr: stderr.excerpt, stdoutBytes: stdout.bytes, journals: existing, absent: observations.filter(item => item.status === 'ABSENT_AT_INSPECTION').map(item => item.path), inspectionStarts: owner.snapshot().knownStarts }) + '\n');
  writeAll(fs, 1, output, count => owner.charge(count)); fs.writeSync(3, output);
} catch (error) {
  owner.terminal = true;
  try { owner.persist(path.join(raw, 'STOP.json'), { message: error instanceof Error ? error.message : String(error), observations, snapshot: owner.snapshot() }); } catch {}
  const bytes = Buffer.from(JSON.stringify({ status: 'INSPECTION_STOP', message: error instanceof Error ? error.message : String(error), snapshot: owner.snapshot() }) + '\n'); fs.writeSync(2, bytes); fs.writeSync(3, bytes); process.exitCode = 78;
}
