import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Owner, identity, writeAll } from '../admin-owner-r1/tracked-owner.mjs';
const repo = '/Users/kjopek/Workspace/safe-bash', relative = 'tests/integration/agent-bash-coherent-author-20260829/final-admin-r6';
const root = path.join(repo, relative), raw = '/private/tmp/b1-final-admin-r6-stop-publication', previous = '/private/tmp/b1-final-admin-r6-preparation';
const owner = new Owner({ raw, cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: raw, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' }, tools: [], wallMs: 90000, reserveMs: 15000, cleanupMs: 2000, maxStarts: 6, peak: 2, captureLimit: 1048576, metadataLimit: 1048576, tailBytes: 65536 });
const read = (filename, maximum) => { const entry = identity(filename, maximum); const bytes = fs.readFileSync(filename); assert.equal(bytes.length, entry.bytes); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256); return { entry, bytes }; };
const git = async (role, args) => { const result = await owner.run(role, '/usr/bin/git', args, 15000); assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, 0); return fs.readFileSync(result.files[0], 'utf8').trim(); };
try {
  assert.equal(fs.existsSync(raw), false); fs.mkdirSync(raw);
  const preseal = JSON.parse(read(path.join(root, 'PRESEAL.json'), 131072).bytes);
  for (const tool of preseal.tools) assert.deepEqual(identity(tool.path, 128 * 1024 * 1024), tool); owner.config.tools = preseal.tools;
  const stopped = read(path.join(previous, 'STOP.json'), 131072), stop = JSON.parse(stopped.bytes);
  assert.equal(stop.detail, 'Aggregate capture admission'); assert.equal(stop.snapshot.poisoned, false); assert.deepEqual(stop.snapshot.activeKnownPIDs, []);
  const sourceCommit = read(path.join(previous, 'git-source-receipt.stdout'), 256).bytes.toString().trim(); assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  const packet = read(path.join(root, 'FINAL.json'), 131072), final = JSON.parse(packet.bytes);
  const binding = JSON.parse(read(path.join(root, 'PUBLICATION-BINDING.json'), 131072).bytes);
  const policyIdentity = binding.files.find(entry => entry.path.endsWith('/policy.mjs')); assert(policyIdentity); assert.deepEqual(identity(policyIdentity.path, 131072), policyIdentity);
  const policy = read(policyIdentity.path, 131072).bytes.toString();
  const evidence = path.join(root, 'failure-evidence'); fs.mkdirSync(evidence);
  const copied = [];
  for (const name of fs.readdirSync(previous).sort()) { const file = read(path.join(previous, name), 131072); const output = fs.openSync(path.join(evidence, name), 'wx'); try { writeAll(fs, output, file.bytes, count => owner.charge(count, true)); } finally { fs.closeSync(output); } copied.push(relative + '/failure-evidence/' + name); }
  const report = { status: 'PURE_FIXTURE_FAILURE_NO_RUNTIME_NO_RETRY', sourceCommit, final: packet.entry, preseal: identity(path.join(root, 'PRESEAL.json'), 131072), failure: stopped.entry, knownOwnerIntervalStarts: stop.snapshot.knownStarts, sourceFinding: 'S06 constructs Ledger with capture=67108864-8192 outside assert.throws. The inherited constructor rejects its active-capacity admission before the intended shared.charge assertion. No actual output cap overflow.', policyIdentity, relevantPolicyLines: policy.split('\n').map((text, index) => ({ line: index + 1, text })).filter(row => /capture|Capture|tail|reserve|reserve|constructor/.test(row.text)), controls: 'INCOMPLETE: no completed six-group result returned; do not promote transient local groups to a sealed pass cohort.', next: 'Version S06 using the exact inherited active/tail constructor domain, then separately authorized PURE replay; no source publisher or cap change inferred.', window: { issuedUTC: final.issuedUTC, latestStartUTC: final.latestStartUTC, expiresUTC: final.expiresUTC, disposition: 'UNUSED_NOT_REVIEW_READY; no activation or extension' }, historicalN08: 'Original source finding/7of8 remains unchanged', ownerOutcome: 'Original preparation tool exit78; six recorded children exit/close, owner exit is externally reported, not self-certified full census.' };
  owner.persist(path.join(evidence, 'HANDOFF.json'), report);
  const paths = [relative + '/publish-stop.mjs', relative + '/launch-stop-publication.sh', relative + '/failure-evidence/HANDOFF.json', ...copied];
  owner.terminal = true;
  await git('git-evidence-add', ['add', '--', ...paths]);
  await git('git-evidence-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Preserve r6 pure fixture constructor refusal without replay', '--', ...paths]);
  const evidenceCommit = await git('git-evidence-receipt', ['rev-parse', 'HEAD']);
  const receipt = owner.persist(path.join(raw, 'FINAL.json'), { sourceCommit, evidenceCommit, report: identity(path.join(evidence, 'HANDOFF.json'), 131072), snapshot: owner.snapshot(), noRetry: true });
  const message = Buffer.from(JSON.stringify({ status: report.status, sourceCommit, evidenceCommit, final: packet.entry, receipt, priorStarts: stop.snapshot.knownStarts, publicationStarts: owner.snapshot().knownStarts, actualCalls: 0 }) + '\n'); writeAll(fs, 1, message, count => owner.charge(count)); fs.writeSync(3, message);
} catch (error) { const body = Buffer.from(JSON.stringify({ status: 'STOP_PUBLICATION_FAILURE', message: error instanceof Error ? error.message : String(error), snapshot: owner.snapshot() }) + '\n'); fs.writeSync(2, body); fs.writeSync(3, body); process.exitCode = 78; }
