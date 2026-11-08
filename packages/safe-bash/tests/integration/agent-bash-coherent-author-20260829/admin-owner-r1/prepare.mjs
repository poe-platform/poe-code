import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Owner, identity, tag } from './tracked-owner.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = '/Users/kjopek/Workspace/safe-bash';
const relative = path.relative(repo, root);
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const external = '/private/tmp/b1-admin-owner-r1-controls';
let owner;
try {
  assert.equal(process.execPath, node);
  assert.equal(fs.existsSync(external), false);
  fs.mkdirSync(external);
  const nodeIdentity = identity(node, 128 * 1024 * 1024);
  assert.equal(nodeIdentity.bytes, 112989184);
  assert.equal(nodeIdentity.sha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  const gitIdentity = identity('/usr/bin/git', 2 * 1024 * 1024);
  owner = new Owner({ raw: external, cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: external, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' }, tools: [nodeIdentity, gitIdentity], wallMs: 180000, reserveMs: 30000, cleanupMs: 2000, maxStarts: 16, peak: 3, captureLimit: 2 * 1024 * 1024, metadataLimit: 2 * 1024 * 1024, tailBytes: 65536 });
  owner.persist(path.join(external, 'START.json'), owner.snapshot());
  const git = async (role, argv) => {
    const result = await owner.run(role, gitIdentity.path, argv, 20000);
    assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, 0);
    return fs.readFileSync(result.files[0], 'utf8').trim();
  };
  assert.equal(await git('git-root', ['rev-parse', '--show-toplevel']), repo);
  await git('git-scoped-status', ['status', '--porcelain=v1', '-z', '--', relative]);
  const sourceNames = ['tracked-owner.mjs', 'prepare.mjs', 'controls.mjs', 'harmless.mjs', 'launch.sh', 'HANDOFF.md'];
  const sources = sourceNames.map(name => identity(path.join(root, name), 65536));
  const inherited = ['stage-b1-r4-final-binding/preimport.mjs', 'stage-b1-r4/PRESEAL.json', 'stage-b1-r4/PUBLICATION-BINDING.json'].map(name => identity(path.join(path.dirname(root), name), 65536));
  assert.equal(inherited[0].sha256, '39aa97b2ba7b62ad87d109cb96602557d2a8951988101029a74ee00f0efdb2fb');
  assert.equal(inherited[1].sha256, 'a7c5e284c4dedbb1726e2231a5e67b44ef960f55203706c73b79ce2e63fa8b70');
  assert.equal(inherited[2].sha256, '8cc5f053a7331bd7c31d73064269d2034485a0aa78b4a8c96128af2e3b0559ea');
  const preseal = owner.persist(path.join(root, 'PRESEAL.json'), { schema: 'B1-admin-owner-author-preseal-r1', authority: 'Fresh 15-minute preparation ONLY; no B1 activation.', sources, tools: owner.config.tools, inherited, controls: { pure: 11, harmlessChildren: 2, identities: ['C01-short', 'C02-zero', 'C03-second-open-dual', 'C04-falsy', 'C05-live-self', 'C06-tail', 'C07-clock', 'C08-postpublication-bytes', 'C09-failed-spawn', 'C10-unknown-tool', 'C11-ready', 'C11-exit7', 'C12-duplicate'] }, config: owner.config, qualifications: ['Trusted file-based source preparation bootstrap. Own PID begins at coordinator construction; no claim about earlier instruction/edit tool PIDs.', 'No product imports, Workers, installs, compiler, network or native oracle.', 'Failed-spawn/FD/write faults are PURE injections, not native FD/failure proof.', 'Live-owner strict publication protocol HOLD; no automatic actual route.'] });
  const sourcePaths = [...sourceNames, 'PRESEAL.json'].map(name => relative + '/' + name);
  await git('git-preseal-add', ['add', '--', ...sourcePaths]);
  await git('git-preseal-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Preseal bounded administrative owner and harmless controls', '--', ...sourcePaths]);
  const sourceCommit = await git('git-preseal-receipt', ['rev-parse', 'HEAD']);
  for (const input of sources) assert.deepEqual(identity(input.path, 65536), input);
  const syntax = await owner.run('syntax-controls', node, ['--check', path.join(root, 'controls.mjs')], 5000);
  assert.equal(syntax.faults.primaryPresent, false); assert.equal(syntax.row.exitCode, 0);
  const { controls } = await import('./controls.mjs');
  const results = await controls(owner, node, root);
  assert.equal(results.length, 13);
  for (const input of [...sources, ...inherited]) assert.deepEqual(identity(input.path, 65536), input);
  owner.terminal = true;
  const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence);
  owner.persist(path.join(evidence, 'RESULT.json'), { sourceCommit, preseal, results, beforePublication: owner.snapshot(), status: 'AUTHOR_SCOPED_CONTROLS_ONLY_ACTUAL_B1_HOLD', protocol: 'Live owner cannot satisfy unchanged preimport every-start-closed predicate; publisher role formula also needs explicit admission interpretation. No implementation changes to either.' });
  const rawPaths = [];
  for (const name of fs.readdirSync(external).sort()) {
    const filename = path.join(external, name); const descriptor = identity(filename, 131072);
    const bytes = fs.readFileSync(filename); assert.equal(bytes.length, descriptor.bytes);
    const target = path.join(evidence, name); const output = fs.openSync(target, 'wx');
    try { const { writeAll } = await import('./tracked-owner.mjs'); writeAll(fs, output, bytes, count => owner.charge(count, true)); } finally { fs.closeSync(output); }
    rawPaths.push(relative + '/evidence/' + name);
  }
  await git('git-evidence-add', ['add', '--', relative + '/evidence/RESULT.json', ...rawPaths]);
  await git('git-evidence-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Record administrative owner pure and harmless-child observations', '--', relative + '/evidence/RESULT.json', ...rawPaths]);
  const evidenceCommit = await git('git-evidence-receipt', ['rev-parse', 'HEAD']);
  const beforeFinal = owner.snapshot();
  const receipt = owner.persist(path.join(external, 'FINAL.json'), { sourceCommit, evidenceCommit, results: results.length, snapshotBeforeThisWrite: beforeFinal, finalTail: 'This receipt and final stdout are explicitly additional writes; no zero-tail claim. External tool observes owner exit, not this live ledger.', pending: 'ROOT protocol decision and different review; no actual B1 authorization.' });
  const message = JSON.stringify({ sourceCommit, evidenceCommit, result: '13/13 scoped controls; 2 harmless children', receipt, snapshotAfterReceipt: owner.snapshot() }) + '\n';
  const { writeAll } = await import('./tracked-owner.mjs');
  writeAll(fs, 1, Buffer.from(message), count => owner.charge(count));
  fs.writeSync(3, message);
} catch (reason) {
  const body = JSON.stringify({ status: 'STOP', reason: tag(reason), detail: reason instanceof Error ? String(reason.message).slice(0, 512) : undefined, snapshot: owner?.snapshot() }) + '\n';
  fs.writeSync(2, body); fs.writeSync(3, body); process.exitCode = 78;
}
