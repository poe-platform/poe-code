import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { Owner, identity, writeAll, tag } from '../admin-owner-r1/tracked-owner.mjs';

const repo = '/Users/kjopek/Workspace/safe-bash';
const relative = 'tests/integration/agent-bash-coherent-author-20260829/admin-owner-r2';
const root = path.join(repo, relative);
const raw = '/private/tmp/b1-admin-owner-r2-sealed-preparation';
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const owner = new Owner({ raw, cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: raw, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' }, tools: [], wallMs: 780000, reserveMs: 60000, cleanupMs: 2000, maxStarts: 28, peak: 3, captureLimit: 8 * 1024 * 1024, metadataLimit: 8 * 1024 * 1024, tailBytes: 262144 });
const say = value => { const body = Buffer.from(JSON.stringify(value) + '\n'); writeAll(fs, 1, body, count => owner.charge(count)); fs.writeSync(3, body); };
const text = (filename, maximum = 65536) => { const input = identity(filename, maximum); const body = fs.readFileSync(filename); assert.equal(crypto.createHash('sha256').update(body).digest('hex'), input.sha256); return { input, text: body.toString('utf8') }; };
const git = async (role, args) => { const result = await owner.run(role, '/usr/bin/git', args, 20000); assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, 0); return fs.readFileSync(result.files[0], 'utf8').trim(); };
try {
  assert.equal(fs.existsSync(raw), false); fs.mkdirSync(raw);
  owner.persist(path.join(raw, 'START.json'), owner.snapshot());
  const nodeTool = identity(node, 128 * 1024 * 1024);
  assert.equal(nodeTool.bytes, 112989184); assert.equal(nodeTool.sha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  const inherited = JSON.parse(text(path.join(root, '../admin-owner-r1/PRESEAL.json')).text);
  const gitTool = inherited.tools.find(entry => entry.path === '/usr/bin/git');
  assert.deepEqual(identity('/usr/bin/git', 2 * 1024 * 1024), gitTool);
  owner.config.tools = [nodeTool, gitTool];
  assert.equal(await git('git-root', ['rev-parse', '--show-toplevel']), repo);
  await git('git-scoped-status', ['status', '--porcelain=v1', '-z', '--', relative]);
  const materialized = await owner.run('source-materialize', node, [path.join(root, 'materialize.mjs')], 10000);
  assert.equal(materialized.faults.primaryPresent, false); assert.equal(materialized.row.exitCode, 0);
  const editorLine = fs.readFileSync(materialized.files[0], 'utf8').trim().split('\n').at(-1);
  const editor = JSON.parse(editorLine); assert(editor.startObserved && editor.exitObserved && editor.closeObserved && editor.exitCode === 0);
  owner.rows.push({ id: `source-editor-${editor.pid}`, role: editor.role, pid: editor.pid, tool: 'apply_patch source editing tool', startUTC: editor.startUTC, startObserved: true, exitObserved: true, closeObserved: true, stdoutEnd: true, stderrEnd: true, exitCode: 0, closeCode: 0, signals: [], qualification: 'PID/exit/close from bounded source materializer; streams captured through its parent, not a separate direct raw pipe.' });
  const input = { close() {} };
  for (const command of ['seal-controls-publish']) {
    if (command === 'inspect-more') {
      for (const name of ['stage-b1-r4-final-binding/FINAL-BINDING.json', 'stage-b1-r4/publish-policy.mjs', 'stage-b1-r4/owner.mjs']) {
        const filename = path.join(root, '..', name);
        if (fs.existsSync(filename)) { const file = text(filename); owner.persist(path.join(raw, name.replaceAll('/', '_') + '.json'), file); say(file); }
      }
    } else if (command === 'seal-controls-publish') {
      const recipe = JSON.parse(text(path.join(root, 'RECIPE.json')).text);
      const sources = recipe.sources.map(name => identity(path.join(root, name), 131072));
      const historical = JSON.parse(text(path.join(root, '../stage-b1-r4/PUBLICATION-BINDING.json')).text);
      const ownerSource = inherited.sources.find(entry => entry.path.endsWith('/tracked-owner.mjs'));
      assert.deepEqual(identity(ownerSource.path, 131072), ownerSource);
      const identitySource = { path: path.join(root, '../stage-b1-r4-final-binding/identity.mjs'), bytes: 3228, sha256: '8e2bd3172834f0cb90e6f3473cbb25ff01a5a389e5c863f614580718f9af2769' };
      assert.deepEqual(identity(identitySource.path, 131072), identitySource);
      const policyEntry = historical.files.find(entry => entry.path.endsWith('/policy.mjs'));
      assert(policyEntry); const policySource = { ...policyEntry, path: path.resolve(repo, policyEntry.path) };
      assert.deepEqual(identity(policySource.path, 131072), policySource);
      const dependencies = [ownerSource, identitySource, policySource];
      const preseal = owner.persist(path.join(root, 'PRESEAL.json'), { schema: 'B1-live-admin-owner-r2-preseal', recipe, sources, dependencies, tools: owner.config.tools, owner: owner.snapshot(), actualB1Authorized: false });
      const paths = [...recipe.sources, 'PRESEAL.json'].map(name => relative + '/' + name);
      await git('git-preseal-add', ['add', '--', ...paths]);
      await git('git-preseal-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Preseal single-live-owner ledger integration and bounded controls', '--', ...paths]);
      const sourceCommit = await git('git-preseal-receipt', ['rev-parse', 'HEAD']);
      for (const entry of sources) assert.deepEqual(identity(entry.path, 131072), entry);
      const check = await owner.run('syntax-controls', node, ['--check', path.join(root, 'controls.mjs')], 5000); assert.equal(check.faults.primaryPresent, false); assert.equal(check.row.exitCode, 0);
      const { controls } = await import('./controls.mjs');
      const result = await controls(owner, node, root);
      for (const entry of [...sources, ...dependencies]) assert.deepEqual(identity(entry.path, 131072), entry);
      owner.terminal = true;
      const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence);
      owner.persist(path.join(evidence, 'RESULT.json'), { sourceCommit, preseal, result, snapshot: owner.snapshot(), qualification: 'PURE admission and two harmless children only; no B1 or real publisher executed.' });
      const artifacts = [relative + '/evidence/RESULT.json'];
      for (const name of fs.readdirSync(raw).sort()) {
        const filename = path.join(raw, name), record = identity(filename, 131072), body = fs.readFileSync(filename); assert.equal(body.length, record.bytes);
        const descriptor = fs.openSync(path.join(evidence, name), 'wx'); try { writeAll(fs, descriptor, body, count => owner.charge(count, true)); } finally { fs.closeSync(descriptor); }
        artifacts.push(relative + '/evidence/' + name);
      }
      await git('git-evidence-add', ['add', '--', ...artifacts]);
      await git('git-evidence-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Record live-owner ledger integration control observations', '--', ...artifacts]);
      const evidenceCommit = await git('git-evidence-receipt', ['rev-parse', 'HEAD']);
      const final = owner.persist(path.join(raw, 'FINAL.json'), { sourceCommit, evidenceCommit, result, snapshot: owner.snapshot(), ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION', tail: 'This receipt and final captured output remain bounded additional writes; no self-exit attestation.' });
      say({ status: 'DONE', sourceCommit, evidenceCommit, result, final, knownStarts: owner.snapshot().knownStarts, active: owner.snapshot().activeKnownPIDs, elapsedMs: owner.snapshot().elapsedMs, ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION' });
      input.close(); break;
    } else if (command === 'stop') { owner.terminal = true; const final = owner.persist(path.join(raw, 'STOP.json'), { snapshot: owner.snapshot(), status: 'PREPARATION_STOP_NO_B1' }); say(final); input.close(); break; }
    else throw new Error('UNSEALED_PREPARATION_COMMAND');
  }
} catch (reason) {
  owner.terminal = true;
  try { owner.persist(path.join(raw, 'FAILURE.json'), { reason: tag(reason), detail: reason instanceof Error ? reason.message.slice(0, 512) : undefined, snapshot: owner.snapshot() }); } catch {}
  say({ status: 'STOP', reason: tag(reason), detail: reason instanceof Error ? reason.message.slice(0, 512) : undefined, snapshot: owner.snapshot() }); process.exitCode = 78;
}
