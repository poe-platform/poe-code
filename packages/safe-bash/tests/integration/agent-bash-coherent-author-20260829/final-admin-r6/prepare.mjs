import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Owner, identity, writeAll, tag } from '../admin-owner-r1/tracked-owner.mjs';
const repo = '/Users/kjopek/Workspace/safe-bash', base = repo + '/tests/integration/agent-bash-coherent-author-20260829';
const relative = 'tests/integration/agent-bash-coherent-author-20260829/final-admin-r6', root = path.join(repo, relative);
const raw = '/private/tmp/b1-final-admin-r6-preparation';
const owner = new Owner({ raw, cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: raw, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' }, tools: [], wallMs: 360000, reserveMs: 45000, cleanupMs: 2000, maxStarts: 20, peak: 3, captureLimit: 4 * 1024 * 1024, metadataLimit: 16 * 1024 * 1024, tailBytes: 262144 });
const read = (entry, maximum = 131072) => { assert.deepEqual(identity(entry.path, maximum), entry); const bytes = fs.readFileSync(entry.path); assert.equal(bytes.length, entry.bytes); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256); return bytes; };
const current = filename => { const entry = identity(filename, 131072); return { entry, bytes: read(entry) }; };
const say = value => { const bytes = Buffer.from(JSON.stringify(value) + '\n'); writeAll(fs, 1, bytes, count => owner.charge(count)); fs.writeSync(3, bytes); };
const git = async (role, args) => { const result = await owner.run(role, '/usr/bin/git', args, 20000); assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, 0); return fs.readFileSync(result.files[0], 'utf8').trim(); };
try {
  assert.equal(fs.existsSync(raw), false); fs.mkdirSync(raw); owner.persist(path.join(raw, 'START.json'), owner.snapshot());
  const oldFinalInput = { path: path.join(base, 'final-admin-r5/FINAL.json'), bytes: 23784, sha256: 'd7cdc4e0261c4752b518fdc42c327f2afa2d777c83c33048c8d14ad86b5b0e65' };
  const old = JSON.parse(read(oldFinalInput));
  for (const tool of old.tools) assert.deepEqual(identity(tool.path, 128 * 1024 * 1024), tool); owner.config.tools = old.tools;
  assert.equal(await git('git-root', ['rev-parse', '--show-toplevel']), repo);
  await git('git-scoped-status', ['status', '--porcelain=v1', '-z', '--', relative]);
  for (const entry of [...old.adminFiles, ...old.preimportFiles, ...old.publisherFiles]) read(entry);
  const publisherInput = old.publisherFiles.find(entry => entry.path.endsWith('/publish.mjs')); assert(publisherInput);
  let publisher = read(publisherInput).toString();
  const changes = [
    ["from './ledger.mjs';", "from '../admin-owner-r2/ledger.mjs';\nimport { startupReservation, observeStartup } from './startup-policy.mjs';"],
    ['let publisherStart;', 'let publisherStart;\nlet startupPlan;'],
    ["  let startupBytes = 0;\n  for (const file of binding.outputs.startupCaptures) {\n    const stat = fs.lstatSync(file);\n    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('Startup capture admission');\n    startupBytes += stat.size;\n  }", "  startupPlan = startupReservation(binding);\n  const startupInitial = observeStartup(startupPlan, file => fs.lstatSync(file));\n  const startupBytes = startupInitial.total;"],
    ['  ledger.charge(8192 - startupBytes);', '  ledger.charge(startupPlan.bytes - startupBytes);'],
    ["    const startup = binding.outputs.startupCaptures.map(file => {\n      const stat = fs.lstatSync(file);\n      if (!stat.isFile() || stat.size > 4096) throw Error('Startup reserved tail exceeded');\n      return { path: file, bytes: stat.size, prechargedCeiling: 4096, liveAfterCensus: true };\n    });", "    const startupFinal = observeStartup(startupPlan, file => fs.lstatSync(file));\n    const startup = startupFinal.streams;\n    terminal.startupReconciliation = { ...startupFinal, aggregateCaptureCap: 67108864, accounting: 'All per-stream capacity was precharged to the same capture/work Ledger; observed late bytes must remain within it.' };"],
  ];
  for (const [before, after] of changes) { assert.equal(publisher.split(before).length, 2, 'EXACT_SINGLE_SOURCE_DELTA'); publisher = publisher.replace(before, after); }
  const patch = '*** Begin Patch\n*** Add File: ' + relative + '/publish.mjs\n' + publisher.split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n';
  const editor = '/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch';
  const editorTarget = fs.realpathSync(editor); const editorIdentity = identity(editorTarget, 256 * 1024 * 1024);
  owner.persist(path.join(raw, 'EDITOR-IDENTITY.json'), { editor, target: editorIdentity, role: 'SOURCE_EDIT_ONLY_NOT_ACTUAL_RUNTIME_TOOL' });
  const stdout = fs.openSync(path.join(raw, 'apply-patch.stdout'), 'wx'); let stderr;
  try { stderr = fs.openSync(path.join(raw, 'apply-patch.stderr'), 'wx'); } catch (reason) { fs.closeSync(stdout); throw reason; }
  const child = spawn(editor, [], { cwd: repo, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const editorRow = { id: `editor-${child.pid}`, role: 'source-edit-apply-patch', pid: child.pid, startUTC: new Date().toISOString(), startObserved: Number.isSafeInteger(child.pid), exitObserved: false, closeObserved: false, stdoutEnd: false, stderrEnd: false, signals: [] };
  assert(editorRow.startObserved); owner.rows.push(editorRow); owner.active.set(child.pid, child);
  let timer, killTimer, primaryPresent = false, primary;
  const fail = reason => { if (!primaryPresent) { primaryPresent = true; primary = reason; } child.kill('SIGTERM'); };
  try {
    await new Promise(resolve => {
      child.on('error', fail); child.stdin.on('error', fail);
      child.stdout.on('data', bytes => { try { writeAll(fs, stdout, bytes, count => owner.charge(count)); } catch (reason) { fail(reason); } });
      child.stderr.on('data', bytes => { try { writeAll(fs, stderr, bytes, count => owner.charge(count)); } catch (reason) { fail(reason); } });
      child.stdout.on('end', () => { editorRow.stdoutEnd = true; }); child.stderr.on('end', () => { editorRow.stderrEnd = true; });
      child.once('exit', code => { editorRow.exitObserved = true; editorRow.exitCode = code; });
      child.once('close', code => { editorRow.closeObserved = true; editorRow.closeCode = code; owner.active.delete(child.pid); resolve(); });
      timer = setTimeout(() => fail('EDITOR_DEADLINE'), 5000); killTimer = setTimeout(() => { if (!editorRow.closeObserved) child.kill('SIGKILL'); }, 7000);
      child.stdin.end(patch);
    });
  } finally { clearTimeout(timer); clearTimeout(killTimer); fs.closeSync(stdout); fs.closeSync(stderr); }
  assert.equal(primaryPresent, false, String(primary)); assert.equal(editorRow.exitCode, 0); assert(editorRow.exitObserved && editorRow.closeObserved && editorRow.stdoutEnd && editorRow.stderrEnd);
  const names = ['prepare.mjs', 'launch-preparation.sh', 'startup-policy.mjs', 'controls.mjs', 'publish.mjs', 'launch.sh', 'HANDOFF.md'];
  const sources = names.map(name => identity(path.join(root, name), 131072));
  const publisherEntry = sources.find(entry => entry.path.endsWith('/publish.mjs')), startupEntry = sources.find(entry => entry.path.endsWith('/startup-policy.mjs'));
  const publication = JSON.parse(read(old.publisherBinding));
  publication.files = [publisherEntry, ...old.publisherFiles.filter(entry => entry.path !== publisherInput.path), startupEntry];
  publication.startupStreams = publication.outputs.startupCaptures.map(filename => ({ path: filename, capBytes: 4096 }));
  const publicationBinding = owner.persist(path.join(root, 'PUBLICATION-BINDING.json'), publication);
  const publicationSeal = owner.persist(path.join(root, 'PUBLICATION-PRESEAL.json'), { schema: 'B1-r6-startup-reservation', binding: publicationBinding, files: publication.files, inheritedReview: '027f058cffebf369dc51a822209742a11f9e6b2a HOLD/N08 retained; r6 prospective controls separate', actualGo: false });
  const now = Date.now(), packet = structuredClone(old);
  packet.schema = 'B1-final-admin-r5';
  packet.revision = 'r6-startup-reservation';
  packet.issuedUTC = new Date(now).toISOString(); packet.latestStartUTC = new Date(now + 1200000).toISOString(); packet.expiresUTC = new Date(now + 3000000).toISOString();
  packet.prospectiveAuthorization = 'ROOT_B1_R6_LIVE_ADMIN_20260829_ONE_ACTUAL_AFTER_FINAL_ACCEPTANCE';
  packet.publisherBinding = publicationBinding; packet.publisherPreseal = publicationSeal; packet.publisherFiles = publication.files;
  packet.publicationCommand.argv = [publisherEntry.path, '--publish', publicationBinding.path, publicationBinding.sha256, String(publicationBinding.bytes), packet.slots.authorityPath, { slot: 'owner same-written final authority SHA256' }, { slot: 'same authority bytes' }];
  packet.reviewBindings.finalReview = 'PENDING_R6; old r5 window RETIRED_UNUSED';
  packet.retiredUnusedWindow = { issuedUTC: old.issuedUTC, latestStartUTC: old.latestStartUTC, expiresUTC: old.expiresUTC, final: oldFinalInput };
  const final = owner.persist(path.join(root, 'FINAL.json'), packet);
  const command = { executable: '/bin/zsh', argv: [path.join(root, 'launch.sh'), final.path, final.sha256, String(final.bytes), packet.prospectiveAuthorization], cwd: repo, login: false, env: { B1_ADMIN_ROOT_GO: 'ROOT_B1_R5_LIVE_ADMIN_EXPLICIT_AUTHORIZATION' }, actualGo: false, qualification: 'Existing owner entry schema/token retained; authority string is prospective and ROOT actual GO is separate.' };
  owner.persist(path.join(root, 'COMMAND.json'), command);
  const dataFiles = ['PUBLICATION-BINDING.json', 'PUBLICATION-PRESEAL.json', 'FINAL.json', 'COMMAND.json'].map(name => identity(path.join(root, name), 131072));
  const preseal = owner.persist(path.join(root, 'PRESEAL.json'), { schema: 'B1-r6-source-control-preseal', source: sources, data: dataFiles, unchangedRuntimePreseal: old.runtimePreseal, unchangedAdminFiles: old.adminFiles, unchangedPreimport: old.preimportFiles, tools: old.tools, exactChanges: changes, controls: ['S01-zero-streams', 'S02-one-stream', 'S03-four-streams-unique-bound', 'S04-safeinteger-sum', 'S05-late-per-stream-overrun', 'S06-aggregate-headroom'], actualProduct: 0, publisherMain: 0 });
  const paths = [...names, ...dataFiles.map(entry => path.basename(entry.path)), 'PRESEAL.json'].map(name => relative + '/' + name);
  await git('git-source-add', ['add', '--', ...paths]);
  await git('git-source-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Bind startup reservation to exact authenticated stream capacities', '--', ...paths]);
  const sourceCommit = await git('git-source-receipt', ['rev-parse', 'HEAD']);
  for (const entry of [...sources, ...dataFiles]) read(entry);
  const { controls } = await import('./controls.mjs'); const results = controls(); assert.equal(results.length, 6);
  for (const entry of [...sources, ...dataFiles, ...old.adminFiles, ...old.preimportFiles]) read(entry);
  assert.deepEqual(JSON.parse(read(old.runtimePreseal)), JSON.parse(read(packet.runtimePreseal)));
  owner.terminal = true; const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence);
  owner.persist(path.join(evidence, 'RESULT.json'), { sourceCommit, preseal, final, publicationBinding, command, results, snapshot: owner.snapshot(), actualB1: false, originalN08: 'SOURCE_FINDING_NO_OVERFLOW_EXECUTION_7_OF_8_NOT_RESCORED' });
  const artifacts = [relative + '/evidence/RESULT.json'];
  for (const name of fs.readdirSync(raw).sort()) { const input = current(path.join(raw, name)); const descriptor = fs.openSync(path.join(evidence, name), 'wx'); try { writeAll(fs, descriptor, input.bytes, count => owner.charge(count, true)); } finally { fs.closeSync(descriptor); } artifacts.push(relative + '/evidence/' + name); }
  await git('git-evidence-add', ['add', '--', ...artifacts]);
  await git('git-evidence-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Record six startup-capacity controls and prospective r6 binding', '--', ...artifacts]);
  const evidenceCommit = await git('git-evidence-receipt', ['rev-parse', 'HEAD']);
  const receipt = owner.persist(path.join(raw, 'FINAL.json'), { sourceCommit, evidenceCommit, final, publicationBinding, results, snapshot: owner.snapshot(), ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION' });
  say({ status: 'R6_BOUND_NO_ACTUAL_GO', sourceCommit, evidenceCommit, final, publicationBinding, publicationSeal, preseal, publisherEntry, startupEntry, command, results, window: { issuedUTC: packet.issuedUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC }, receipt, knownStarts: owner.snapshot().knownStarts });
} catch (reason) {
  owner.terminal = true;
  try { owner.persist(path.join(raw, 'STOP.json'), { reason: tag(reason), detail: reason instanceof Error ? reason.message.slice(0, 512) : undefined, snapshot: owner.snapshot() }); } catch {}
  say({ status: 'STOP_NO_ACTUAL_GO', reason: tag(reason), detail: reason instanceof Error ? reason.message.slice(0, 512) : undefined, snapshot: owner.snapshot() }); process.exitCode = 78;
}
