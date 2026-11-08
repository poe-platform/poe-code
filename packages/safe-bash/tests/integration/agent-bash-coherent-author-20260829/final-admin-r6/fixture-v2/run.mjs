import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Owner, identity, writeAll, tag } from '../../admin-owner-r1/tracked-owner.mjs';
const repo = '/Users/kjopek/Workspace/safe-bash';
const relative = 'tests/integration/agent-bash-coherent-author-20260829/final-admin-r6/fixture-v2';
const root = path.join(repo, relative), previous = path.dirname(root), raw = '/private/tmp/b1-r6-fixture-v2-qualification';
const owner = new Owner({ raw, cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: raw, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' }, tools: [], wallMs: 180000, reserveMs: 30000, cleanupMs: 2000, maxStarts: 12, peak: 3, captureLimit: 2097152, metadataLimit: 4194304, tailBytes: 65536 });
const read = entry => { assert.deepEqual(identity(entry.path, 131072), entry); const bytes = fs.readFileSync(entry.path); assert.equal(bytes.length, entry.bytes); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256); return bytes; };
const current = filename => { const entry = identity(filename, 131072); return { entry, bytes: read(entry) }; };
const say = value => { const bytes = Buffer.from(JSON.stringify(value) + '\n'); writeAll(fs, 1, bytes, count => owner.charge(count)); fs.writeSync(3, bytes); };
const git = async (role, args) => { const result = await owner.run(role, '/usr/bin/git', args, 15000); assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, 0); return fs.readFileSync(result.files[0], 'utf8').trim(); };
try {
  assert.equal(fs.existsSync(raw), false); fs.mkdirSync(raw); owner.persist(path.join(raw, 'START.json'), owner.snapshot());
  const finalIdentity = { path: path.join(previous, 'FINAL.json'), bytes: 24620, sha256: '8bd385557c356994062d62fb10d9aef485e3c440dd509e68220425ae770e03a9' };
  const packet = JSON.parse(read(finalIdentity));
  for (const tool of packet.tools) assert.deepEqual(identity(tool.path, 128 * 1024 * 1024), tool); owner.config.tools = packet.tools;
  assert.equal(await git('git-root', ['rev-parse', '--show-toplevel']), repo);
  await git('git-scoped-status', ['status', '--porcelain=v1', '-z', '--', relative]);
  const oldPreseal = JSON.parse(current(path.join(previous, 'PRESEAL.json')).bytes);
  const oldControls = oldPreseal.source.find(entry => entry.path === path.join(previous, 'controls.mjs')); assert(oldControls);
  const oldText = read(oldControls).toString(), revised = current(path.join(root, 'controls.mjs'));
  const oldLines = oldText.split('\n'), newLines = revised.bytes.toString().split('\n');
  assert.deepEqual(oldLines.filter(line => !line.startsWith('import ') && !line.includes("check('S06-") && line !== '  return results;' && line !== '}' && line !== ''), newLines.filter(line => !line.startsWith('import ') && !line.includes("check('S06-") && !line.includes("check('D01-") && !line.includes("check('D02-") && line !== '  return results;' && line !== '}' && line !== ''));
  const dependencies = packet.publisherFiles;
  for (const entry of dependencies) read(entry);
  const names = ['controls.mjs', 'run.mjs', 'launch.sh', 'HANDOFF.md'];
  const source = names.map(name => identity(path.join(root, name), 131072));
  const preseal = owner.persist(path.join(root, 'PRESEAL.json'), { schema: 'r6-fixture-v2-preseal', unchangedFinal: finalIdentity, unchangedPublisherSourceCommit: 'de5d778146578b793ac26c57bb506c7a783cf67e', oldControls, source, dependencies, tools: packet.tools, exactDelta: 'Only S06 setup and exact refusal predicate/snapshot guard; five earlier groups byte-identical. Two separate discrimination controls. Import paths adjusted for new directory.', groups: ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'D01', 'D02'], actualPublisher: 0, runtime: 0, renewal: false });
  const paths = [...names, 'PRESEAL.json'].map(name => relative + '/' + name);
  await git('git-source-add', ['add', '--', ...paths]);
  await git('git-source-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Preseal fixture-only r6 active-tail setup correction', '--', ...paths]);
  const sourceCommit = await git('git-source-receipt', ['rev-parse', 'HEAD']);
  for (const entry of [...source, ...dependencies]) read(entry);
  const { controls } = await import('./controls.mjs'); const results = controls(); assert.equal(results.length, 8);
  for (const entry of [...source, ...dependencies, finalIdentity]) read(entry);
  const observedUTC = new Date().toISOString(); const window = { issuedUTC: packet.issuedUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC, observedUTC, staleForStart: Date.parse(observedUTC) > Date.parse(packet.latestStartUTC), renewed: false, actualGo: false };
  owner.terminal = true; const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence);
  owner.persist(path.join(evidence, 'RESULT.json'), { sourceCommit, preseal, finalIdentity, results, window, snapshot: owner.snapshot(), inheritedFailure: '1cfff67d and N08/7of8 unchanged, not rescored', publisherMain: 0 });
  const artifacts = [relative + '/evidence/RESULT.json'];
  for (const name of fs.readdirSync(raw).sort()) { const input = current(path.join(raw, name)); const descriptor = fs.openSync(path.join(evidence, name), 'wx'); try { writeAll(fs, descriptor, input.bytes, count => owner.charge(count, true)); } finally { fs.closeSync(descriptor); } artifacts.push(relative + '/evidence/' + name); }
  await git('git-evidence-add', ['add', '--', ...artifacts]);
  await git('git-evidence-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Record six corrected r6 groups and two discrimination controls', '--', ...artifacts]);
  const evidenceCommit = await git('git-evidence-receipt', ['rev-parse', 'HEAD']);
  const receipt = owner.persist(path.join(raw, 'FINAL.json'), { sourceCommit, evidenceCommit, finalIdentity, results, window, snapshot: owner.snapshot(), ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION' });
  say({ status: 'QUALIFIED_PURE_CONTROLS_NO_ACTUAL_GO', sourceCommit, evidenceCommit, preseal, finalIdentity, results, window, receipt, knownStarts: owner.snapshot().knownStarts });
} catch (reason) {
  owner.terminal = true;
  try { owner.persist(path.join(raw, 'STOP.json'), { reason: tag(reason), detail: reason instanceof Error ? reason.message.slice(0, 512) : undefined, snapshot: owner.snapshot() }); } catch {}
  say({ status: 'STOP_NO_RETRY', reason: tag(reason), detail: reason instanceof Error ? reason.message.slice(0, 512) : undefined, snapshot: owner.snapshot() }); process.exitCode = 78;
}
