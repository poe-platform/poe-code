import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { identity, writeAll } from '../admin-owner-r1/tracked-owner.mjs';

export async function finish(context) {
  const { owner, repo, relative, root, base, raw, node, read, json, git } = context;
  const originalRuntime = read(path.join(base, 'stage-b1-r4/PRESEAL.json'));
  assert.equal(originalRuntime.input.sha256, 'a7c5e284c4dedbb1726e2231a5e67b44ef960f55203706c73b79ce2e63fa8b70');
  const oldRuntime = JSON.parse(originalRuntime.bytes);
  const oldPublication = json(path.join(base, 'stage-b1-r4/PUBLICATION-BINDING.json'));
  const oldFinal = json(path.join(base, 'stage-b1-r4-final-binding/FINAL-BINDING.json'));
  const r2 = json(path.join(base, 'admin-owner-r2/PRESEAL.json'));
  const named = name => { const expected = r2.sources.find(entry => entry.path === path.join(base, 'admin-owner-r2', name)); assert(expected); assert.deepEqual(identity(expected.path, 131072), expected); return expected; };
  const ledger = named('ledger.mjs'), dispatch = named('admin-dispatch.mjs'), preimport = named('preimport.mjs'), publisher = named('publish.mjs');
  for (const entry of r2.dependencies) assert.deepEqual(identity(entry.path, 131072), entry);
  const kernel = r2.dependencies.find(entry => entry.path.endsWith('/tracked-owner.mjs'));
  const identityHelper = r2.dependencies.find(entry => entry.path.endsWith('/identity.mjs'));
  const policy = r2.dependencies.find(entry => entry.path.endsWith('/policy.mjs'));
  assert(kernel && identityHelper && policy);
  const ownNames = ['prepare.mjs', 'launch-preparation.sh', 'entry.mjs', 'launch.sh', 'finish.mjs', 'HANDOFF.md'];
  const ownSources = ownNames.map(name => identity(path.join(root, name), 131072));
  const entry = ownSources.find(item => item.path.endsWith('/entry.mjs'));
  const adminRoot = '/private/tmp/coherent-b1-r5-admin', runtimeRoot = '/private/tmp/coherent-b1-r5-runtime', publicationRoot = '/private/tmp/coherent-b1-r5-publication', captureRoot = path.join(adminRoot, 'capture'), evidenceRoot = path.join(root, 'actual-evidence');
  const newRuntime = { ...oldRuntime, workRoot: runtimeRoot };
  const runtimeIdentity = owner.persist(path.join(root, 'RUNTIME-PRESEAL.json'), newRuntime);
  const outputs = { ...oldPublication.outputs, work: runtimeRoot, evidence: evidenceRoot, publication: publicationRoot, launchCaptures: [path.join(captureRoot, 'runtime-coordinator.stdout'), path.join(captureRoot, 'runtime-coordinator.stderr'), path.join(captureRoot, 'publication-preimport.stdout'), path.join(captureRoot, 'publication-preimport.stderr'), path.join(adminRoot, 'START.json'), path.join(adminRoot, 'ROOT-GRANT.json'), path.join(adminRoot, 'PRIOR-LEDGER.json'), path.join(adminRoot, 'PREIMPORT-ADMISSION.json')], startupCaptures: ['/private/tmp/coherent-b1-r5-owner.stdout', '/private/tmp/coherent-b1-r5-owner.stderr', path.join(captureRoot, 'publisher.stdout'), path.join(captureRoot, 'publisher.stderr')] };
  const publication = { ...oldPublication, files: [publisher, policy, ledger], runtimePreseal: runtimeIdentity, outputs, workerProfile: { ...oldPublication.workerProfile, knownOS: 36 } };
  const publicationIdentity = owner.persist(path.join(root, 'PUBLICATION-BINDING.json'), publication);
  const publicationSeal = owner.persist(path.join(root, 'PUBLICATION-PRESEAL.json'), { schema: 'B1-r5-publication-preseal', binding: publicationIdentity, publisher, policy, ledger, owner: entry, rootActualAuthority: false });
  const now = Date.now();
  const packet = {
    schema: 'B1-final-admin-r5', repo, maxKnownOS: 36, peak: 3,
    issuedUTC: new Date(now).toISOString(), latestStartUTC: new Date(now + 1200000).toISOString(), expiresUTC: new Date(now + 3000000).toISOString(),
    action: 'ROOT_B1_PUBLIC15_ACTUAL', actualAuthority: false,
    sourceTree: oldRuntime.sourceTree, sourceInputs: oldRuntime.sourceInputs, package: oldPublication.package, members: 1014, actualStageAEmissions: 1012,
    reviewBindings: { runtime: '53ad11083d9e33fbcd5782672fde0d5dcb24180a', publisher: '7c8fb0e336499142398ef9ebe7169e64b7cfedfa logical profile only', adminSource: '07e3249ae35e7ec4fc09816de9f587609b3d8210', adminControls: 'd1006a259514c59b7cd74eacf540c23a3b731ea3', finalReview: 'PENDING; no actual authority' },
    adminRoot, runtimeRoot, publicationRoot, captureRoot, metadataHome: path.join(adminRoot, 'metadata-home'),
    adminOwner: entry, ownerKernel: kernel, dispatch, preimportEntry: preimport,
    adminFiles: [entry, kernel, dispatch, ledger, identityHelper], preimportFiles: [preimport, ledger, identityHelper], publisherFiles: [publisher, policy, ledger],
    runtimePreseal: runtimeIdentity, publisherBinding: publicationIdentity, publisherPreseal: publicationSeal,
    runtimeInputFiles: newRuntime.files.map(item => ({ ...item, path: path.resolve(repo, item.path) })), tools: r2.tools,
    absentSlots: [adminRoot, runtimeRoot, publicationRoot, evidenceRoot],
    slots: { startReceipt: path.join(adminRoot, 'START.json'), rootGrantFile: path.join(adminRoot, 'ROOT-GRANT.json'), ledgerPath: path.join(adminRoot, 'PRIOR-LEDGER.json'), preimportAdmissionPath: path.join(adminRoot, 'PREIMPORT-ADMISSION.json'), authorityPath: path.join(adminRoot, 'PUBLISH-AUTHORITY.json'), finalReceipt: path.join(adminRoot, 'FINAL.json'), failureReceipt: path.join(adminRoot, 'STOP.json') },
    runtimeCommand: { executable: node, argv: [path.join(base, 'stage-b1-r4/bootstrap.mjs'), '--run', runtimeIdentity.path, runtimeIdentity.sha256, String(runtimeIdentity.bytes)] },
    preimportCommand: { executable: node, argv: [preimport.path, { slot: 'this authenticated FINAL path' }, { slot: 'this FINAL SHA256' }, { slot: 'this FINAL bytes' }] },
    publicationCommand: { executable: node, argv: [publisher.path, '--publish', publicationIdentity.path, publicationIdentity.sha256, String(publicationIdentity.bytes), path.join(adminRoot, 'PUBLISH-AUTHORITY.json'), { slot: 'owner same-written final authority SHA256' }, { slot: 'same authority bytes' }] },
    runtimeRoles: ['offline-install', 'workflow-source-built', 'workflow-installed', 'workflow-physically-moved'],
    limits: { inclusiveSeconds: 1800, activeSeconds: 1620, publicationReserveSeconds: 180, cleanupSeconds: 5, captureBytes: 67108864, logicalWorkBytes: 805306368, guestTotal: 15, guestLive: 5, regexWorkers: 0, asyncLoaderThreads: 0 },
    dynamic: { authorization: 'ONLY a fresh ROOT-issued string after different review; argv[5], never a planned measurement', startedUTC: 'actual first entry timestamp', priorLedger: 'actual owner/direct and authenticated nested records', authority: 'same-written bytes after preimport exit/close, no intervening OS start' },
    qualifications: ['One LIVE_ADMIN_OWNER; other prior managed roles exited/closed. Owner EXIT_PENDING_EXTERNAL_OBSERVATION.', 'Source editor/runtime/publisher stream EOF not inferred: absent direct end telemetry is null.', 'Initial trusted shell/Node startup outside raw-capture execution proof; exact owner PID begins entry.', 'No full process census, no group-absence claim, no private inputs. Old windows and c441 remain retired/unrescored.', 'Fixed UTC schema +20/+50; fresh grant and final review required. Runtime code and C18/layout logic unchanged.']
  };
  for (const input of packet.runtimeInputFiles) assert.deepEqual(identity(input.path, 4194304), input);
  const final = owner.persist(path.join(root, 'FINAL.json'), packet);
  const command = { executable: '/bin/zsh', argv: [path.join(root, 'launch.sh'), final.path, final.sha256, String(final.bytes), { slot: 'FRESH_ROOT_AUTHORIZATION_STRING' }], cwd: repo, login: false, env: { B1_ADMIN_ROOT_GO: 'ROOT_B1_R5_LIVE_ADMIN_EXPLICIT_AUTHORIZATION' }, rule: 'One invocation only after review and fresh ROOT actual authority. No hand-executed admin commands after owner starts.' };
  owner.persist(path.join(root, 'COMMAND.json'), command);
  const identities = [...ownSources, runtimeIdentity, publicationIdentity, publicationSeal, final, identity(path.join(root, 'COMMAND.json'), 131072)];
  const preseal = owner.persist(path.join(root, 'PRESEAL.json'), { schema: 'B1-final-admin-r5-preparation', identities, inherited: [ledger, dispatch, preimport, publisher, ...r2.dependencies], tools: r2.tools, controls: ['F01-output-only-runtime', 'F02-single-direct-command', 'F03-flat-bound-closure', 'F04-unobserved-streams-null'], actualB1: 'NOT_AUTHORIZED', abandoned: 'Old r4 and r2 windows never reused.' });
  const paths = [...ownNames, 'RUNTIME-PRESEAL.json', 'PUBLICATION-BINDING.json', 'PUBLICATION-PRESEAL.json', 'FINAL.json', 'COMMAND.json', 'PRESEAL.json'].map(name => relative + '/' + name);
  await git('git-source-add', ['add', '--', ...paths]);
  await git('git-source-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Bind output-only r5 runtime to one live administrative owner', '--', ...paths]);
  const sourceCommit = await git('git-source-receipt', ['rev-parse', 'HEAD']);
  const checks = [];
  assert.deepEqual({ ...newRuntime, workRoot: oldRuntime.workRoot }, oldRuntime); checks.push({ id: 'F01-output-only-runtime', outcome: 'PASS', role: 'PURE_DATA' });
  assert.equal(command.executable, '/bin/zsh'); assert.equal(command.argv.length, 5); assert.equal(packet.runtimeCommand.executable, node); assert.equal(packet.publicationCommand.executable, node); checks.push({ id: 'F02-single-direct-command', outcome: 'PASS', role: 'PURE_DATA' });
  for (const input of [...packet.adminFiles, ...packet.preimportFiles, ...packet.publisherFiles]) { assert(!Array.isArray(input)); assert(path.isAbsolute(input.path)); assert.deepEqual(identity(input.path, 131072), input); } checks.push({ id: 'F03-flat-bound-closure', outcome: 'PASS', role: 'PURE_DATA' });
  const code = read(entry.path).bytes.toString(); assert(code.includes('stdoutEnd: null, stderrEnd: null')); assert(code.includes('EXIT_PENDING_EXTERNAL_OBSERVATION')); checks.push({ id: 'F04-unobserved-streams-null', outcome: 'PASS', role: 'PURE_SOURCE_POLICY' });
  owner.terminal = true;
  const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence);
  owner.persist(path.join(evidence, 'RESULT.json'), { sourceCommit, final, preseal, command, checks, window: { issuedUTC: packet.issuedUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC }, snapshot: owner.snapshot(), actualB1: false });
  const artifacts = [relative + '/evidence/RESULT.json'];
  for (const name of fs.readdirSync(raw).sort()) { const file = read(path.join(raw, name)); const descriptor = fs.openSync(path.join(evidence, name), 'wx'); try { writeAll(fs, descriptor, file.bytes, count => owner.charge(count, true)); } finally { fs.closeSync(descriptor); } artifacts.push(relative + '/evidence/' + name); }
  await git('git-evidence-add', ['add', '--', ...artifacts]);
  await git('git-evidence-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Record final r5 binding data controls without runtime activation', '--', ...artifacts]);
  const evidenceCommit = await git('git-evidence-receipt', ['rev-parse', 'HEAD']);
  const receipt = owner.persist(path.join(raw, 'FINAL.json'), { sourceCommit, evidenceCommit, final, command, snapshot: owner.snapshot(), ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION', actualB1: false });
  return { status: 'BOUND_NO_ACTUAL_GO', sourceCommit, evidenceCommit, final, runtimeIdentity, publicationIdentity, preseal, command, checks, window: { issuedUTC: packet.issuedUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC }, receipt, knownStarts: owner.snapshot().knownStarts };
}
