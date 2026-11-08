import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Owner, identity, writeAll } from '../admin-owner-r1/tracked-owner.mjs';
const repo = '/Users/kjopek/Workspace/safe-bash', relative = 'tests/integration/agent-bash-coherent-author-20260829/b1-r6-window-v2';
const root = path.join(repo, relative), base = path.dirname(root), raw = '/private/tmp/b1-r6-window-v2-preparation';
const owner = new Owner({ raw, cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: raw, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' }, tools: [], wallMs: 360000, reserveMs: 45000, cleanupMs: 2000, maxStarts: 12, peak: 3, captureLimit: 1048576, metadataLimit: 4194304, tailBytes: 65536 });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (entry, maximum = 131072) => { assert.deepEqual(identity(entry.path, maximum), entry); const bytes = fs.readFileSync(entry.path); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256); return bytes; };
const git = async (role, args) => { const result = await owner.run(role, '/usr/bin/git', args, 15000); assert.equal(result.faults.primaryPresent, false); assert.equal(result.row.exitCode, 0); return fs.readFileSync(result.files[0], 'utf8').trim(); };
const say = value => { const bytes = Buffer.from(JSON.stringify(value) + '\n'); writeAll(fs, 1, bytes, count => owner.charge(count)); fs.writeSync(3, bytes); };
function utc(milliseconds) {
  assert(Number.isSafeInteger(milliseconds) && milliseconds >= 0);
  const value = new Date(milliseconds).toISOString(); assert.match(value, /^2026-08-29T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); assert.equal(Date.parse(value), milliseconds); return value;
}
try {
  assert.equal(fs.existsSync(raw), false); fs.mkdirSync(raw); owner.persist(path.join(raw, 'START.json'), owner.snapshot());
  const previousIdentity = { path: path.join(base, 'final-admin-r6/FINAL.json'), bytes: 24620, sha256: '8bd385557c356994062d62fb10d9aef485e3c440dd509e68220425ae770e03a9' };
  const previous = JSON.parse(read(previousIdentity));
  for (const tool of previous.tools) assert.deepEqual(identity(tool.path, 128 * 1024 * 1024), tool); owner.config.tools = previous.tools;
  assert.equal(await git('git-root', ['rev-parse', '--show-toplevel']), repo);
  await git('git-scoped-status', ['status', '--porcelain=v1', '-z', '--', relative]);
  for (const entry of [...previous.adminFiles, ...previous.preimportFiles, ...previous.publisherFiles]) read(entry);
  read(previous.runtimePreseal, 1048576);
  const oldPublication = JSON.parse(read(previous.publisherBinding));
  const oldPublicationSeal = JSON.parse(read(previous.publisherPreseal));
  const packet = structuredClone(previous), publication = structuredClone(oldPublication);
  const capturePaths = ['/private/tmp/coherent-b1-r6-window-v2-owner.stdout', '/private/tmp/coherent-b1-r6-window-v2-owner.stderr'];
  for (const filename of [...packet.absentSlots, ...capturePaths]) assert.equal(fs.existsSync(filename), false, 'FRESH_SLOT_NOT_ABSENT');
  assert.equal(publication.outputs.startupCaptures.length, 4); assert.equal(publication.startupStreams.length, 4);
  const oldCapturePaths = publication.outputs.startupCaptures.slice(0, 2);
  assert.deepEqual(oldCapturePaths, ['/private/tmp/coherent-b1-r5-owner.stdout', '/private/tmp/coherent-b1-r5-owner.stderr']);
  for (let index = 0; index < 2; index++) { assert.equal(publication.startupStreams[index].path, oldCapturePaths[index]); publication.outputs.startupCaptures[index] = capturePaths[index]; publication.startupStreams[index].path = capturePaths[index]; }
  for (const stream of publication.startupStreams) assert.equal(stream.capBytes, 4096);
  const publicationIdentity = owner.persist(path.join(root, 'PUBLICATION-BINDING.json'), publication);
  const publicationSeal = owner.persist(path.join(root, 'PUBLICATION-PRESEAL.json'), { ...oldPublicationSeal, binding: publicationIdentity, windowRevision: 'r6-window-v2 metadata only', actualGo: false });
  const issued = Date.now(), latest = issued + 1200000, expires = latest + 1800000;
  assert(Number.isSafeInteger(issued)); assert(expires <= Date.parse('2026-08-29T17:50:00.000Z'), 'WINDOW_CANNOT_FIT_BEFORE_1750');
  packet.issuedUTC = utc(issued); packet.latestStartUTC = utc(latest); packet.expiresUTC = utc(expires);
  packet.revision = 'r6-window-v2'; packet.publisherBinding = publicationIdentity; packet.publisherPreseal = publicationSeal;
  packet.publicationCommand.argv[2] = publicationIdentity.path; packet.publicationCommand.argv[3] = publicationIdentity.sha256; packet.publicationCommand.argv[4] = String(publicationIdentity.bytes);
  packet.previousConsumedAttempt = { final: previousIdentity, inspection: '1e7f2c4d3b4f0acc5c739581c3dd2cf7624d3495', disposition: 'UTC admission refusal before managed dispatch; exact timestamp/conjunct/counts unknown. Captures preserved.' };
  packet.reviewBindings.finalReview = 'PENDING_FRESH_TIME_BINDING_CHECK; no actual authority';
  packet.reviewQualifications = { reviewer: '6acd8e3c7a308536f18646f72722023b74b4f651', terminal: 'HOLD_RETAINED', root: 'QUALIFIED adjudication based on source-linked returned control bodies and postguards; not an independent terminal PASS or full archive census', reviewerPublicationUTC: '2026-08-29T16:12:31.025Z', separatePostguardUTC: 'UNRECORDED' };
  packet.bindingOnly = true; packet.actualAuthority = false;
  packet.outerCaptureSlots = capturePaths;
  const final = owner.persist(path.join(root, 'FINAL.json'), packet);
  const launch = identity(path.join(root, 'launch.sh'), 131072);
  const command = { executable: '/bin/zsh', argv: [launch.path, final.path, final.sha256, String(final.bytes), packet.prospectiveAuthorization], cwd: repo, login: false, env: { B1_ADMIN_ROOT_GO: 'ROOT_B1_R5_LIVE_ADMIN_EXPLICIT_AUTHORIZATION' }, launch, actualGo: false };
  owner.persist(path.join(root, 'COMMAND.json'), command);
  const clock = owner.persist(path.join(root, 'CLOCK-AND-SLOTS.json'), { clock: 'Trusted tool host Date.now; exact UTC ISO parse roundtrip; not remote time attestation', issuedUTC: packet.issuedUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC, latestDeltaMs: latest - issued, headroomMs: expires - latest, cutoffUTC: '2026-08-29T17:50:00.000Z', verifiedAbsent: [...packet.absentSlots, ...capturePaths], scope: 'New outer capture slots. Existing admin/runtime/publication roots remain exact fixed UNUSED slots; absent checked, no prior-root deletion or reuse of any populated root.' });
  assert.deepEqual(packet.runtimePreseal, previous.runtimePreseal); assert.deepEqual(packet.adminFiles, previous.adminFiles); assert.deepEqual(packet.publisherFiles, previous.publisherFiles); assert.deepEqual(packet.preimportFiles, previous.preimportFiles); assert.deepEqual(packet.package, previous.package);
  const restored = structuredClone(publication);
  for (let index = 0; index < 2; index++) { restored.outputs.startupCaptures[index] = oldCapturePaths[index]; restored.startupStreams[index].path = oldCapturePaths[index]; }
  assert.deepEqual(restored, oldPublication, 'ONLY_TWO_CAPTURE_PATHS_CHANGE');
  const names = ['bind.mjs', 'launch-preparation.sh', 'launch.sh', 'HANDOFF.md', 'PUBLICATION-BINDING.json', 'PUBLICATION-PRESEAL.json', 'FINAL.json', 'COMMAND.json', 'CLOCK-AND-SLOTS.json'];
  const sources = names.map(name => identity(path.join(root, name), 131072));
  const preseal = owner.persist(path.join(root, 'PRESEAL.json'), { schema: 'r6-window-v2-metadata-binding', sources, inheritedFinal: previousIdentity, inheritedSourceFiles: [...previous.adminFiles, ...previous.preimportFiles, ...previous.publisherFiles], tools: previous.tools, noRuntimeChanges: true, noActualGo: true, clock });
  const paths = [...names, 'PRESEAL.json'].map(name => relative + '/' + name);
  await git('git-binding-add', ['add', '--', ...paths]);
  await git('git-binding-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Bind fresh r6 UTC window and unused outer capture slots', '--', ...paths]);
  const sourceCommit = await git('git-binding-receipt', ['rev-parse', 'HEAD']);
  for (const entry of sources) read(entry);
  for (const entry of [...previous.adminFiles, ...previous.preimportFiles, ...previous.publisherFiles]) read(entry);
  for (const filename of [...packet.absentSlots, ...capturePaths]) assert.equal(fs.existsSync(filename), false);
  owner.terminal = true; const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence);
  owner.persist(path.join(evidence, 'RESULT.json'), { status: 'METADATA_BOUND_NO_ACTUAL_GO', sourceCommit, preseal, final, publicationIdentity, publicationSeal, clock, command, snapshot: owner.snapshot(), qualifications: packet.reviewQualifications });
  const artifacts = [relative + '/evidence/RESULT.json'];
  for (const name of fs.readdirSync(raw).sort()) { const entry = identity(path.join(raw, name), 131072); const bytes = read(entry); const descriptor = fs.openSync(path.join(evidence, name), 'wx'); try { writeAll(fs, descriptor, bytes, count => owner.charge(count, true)); } finally { fs.closeSync(descriptor); } artifacts.push(relative + '/evidence/' + name); }
  await git('git-evidence-add', ['add', '--', ...artifacts]);
  await git('git-evidence-commit', ['-c', 'core.hooksPath=/dev/null', 'commit', '--only', '-m', 'Record fresh r6 time and slot binding guards without activation', '--', ...artifacts]);
  const evidenceCommit = await git('git-evidence-receipt', ['rev-parse', 'HEAD']);
  const receipt = owner.persist(path.join(raw, 'FINAL.json'), { sourceCommit, evidenceCommit, final, clock, command, snapshot: owner.snapshot(), ownerDisposition: 'EXIT_PENDING_EXTERNAL_OBSERVATION' });
  say({ status: 'READY_FOR_BINDING_REVIEW_NO_GO', sourceCommit, evidenceCommit, final, publicationIdentity, publicationSeal, preseal, command, window: { issuedUTC: packet.issuedUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC }, receipt, knownStarts: owner.snapshot().knownStarts });
} catch (reason) {
  owner.terminal = true; const message = reason instanceof Error ? reason.message : String(reason);
  try { owner.persist(path.join(raw, 'STOP.json'), { message, snapshot: owner.snapshot() }); } catch {}
  say({ status: 'STOP_NO_ACTUAL_GO', message, snapshot: owner.snapshot() }); process.exitCode = 78;
}
