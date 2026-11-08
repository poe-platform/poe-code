import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
export async function check(context) {
  const { author, output, read, identity, digest, write, started } = context;
  const groups = [];
  const bindingRecord = await read(path.join(author, 'final-binding-v2/BINDING.json'));
  const binding = JSON.parse(bindingRecord.bytes);
  const grantRecord = await read(path.join(author, 'final-binding-v2/GRANT.pending.json'));
  const pending = JSON.parse(grantRecord.bytes);
  const caps = { seconds:1800,reserveSeconds:180,knownOsStarts:64,peakOs:3,rawBytes:100663296,childRawBytes:67108864,workBytes:536870912,terminalReserveBytes:4194304,traceBytesPerRole:524288,loaderAdmissions:34,regexWorkers:0,regexLoaderAdmissions:0,guestEngines:0,loaderThreads:34,peakLoaderThreads:1,decoderBytes:67108864,maximumInventoryEntries:16384 };
  assert.equal(grantRecord.bound.mode, 0o600);
  assert.equal(grantRecord.bound.bytes, 1081); assert.equal(grantRecord.bound.sha256, '779253fa14627330e812e9522603f8e61895a91155d5e4f9fe943f0823573e80');
  assert.equal(pending.schema, 'B2_RUNTIME_GO_R8'); assert.equal(pending.authority, 'ROOT_B2_672_EXPLICIT_FRESH_GO');
  assert.equal(pending.reviewAuthority, 'INDEPENDENT_PREEXEC_REVIEW_ACCEPTED');
  assert.equal(pending.reviewCommit, 'a54f318dedf6e80edd3ac12887f9e50ae4bff758');
  assert.equal(pending.mutableCacheAuthority, 'ROOT_ACCEPTS_BEST_EFFORT_MUTABLE_CACHE_R8');
  assert.deepEqual(pending.caps, caps); assert.deepEqual(binding.caps, caps);
  assert.equal(binding.actualGo, false); assert.equal(binding.grantInstalled, false);
  assert.equal(binding.grant.path, grantRecord.bound.path); assert.equal(binding.grant.bytes, grantRecord.bound.bytes); assert.equal(binding.grant.sha256, grantRecord.bound.sha256);
  groups.push({ id: 'B01-pending-grant', status: 'PASS', mode: '0600', actualAuthorityInstalled: false });

  assert.equal(binding.pins.length, 38); assert.equal(new Set(binding.pins.map(row => row.path)).size, 38);
  const before = [];
  for (const pin of binding.pins) {
    assert(path.isAbsolute(pin.path)); assert(Number.isSafeInteger(pin.bytes) && pin.bytes >= 0); assert.match(pin.sha256, /^[0-9a-f]{64}$/);
    const actual = await identity(pin.path); assert.equal(actual.bytes, pin.bytes); assert.equal(actual.sha256, pin.sha256); before.push(actual);
  }
  const packetPath = path.join(author, 'staged/PACKET.json');
  const packetRecord = await read(packetPath, { bytes: 6945, sha256: '6df866e7990386218848061128777008bfbd6cdd93a7c0f658559fc0d0aa23f9' });
  const packet = JSON.parse(packetRecord.bytes); assert.equal(packet.files.length, 32);
  assert.equal(pending.packetSha256, packetRecord.bound.sha256);
  for (const row of packet.files) {
    const pin = binding.pins.find(pin => pin.path === path.join(author, 'staged', row.path)); assert(pin); assert.equal(pin.bytes, row.bytes); assert.equal(pin.sha256, row.sha256);
  }
  assert.equal(packet.retained, 672); assert.equal(packet.roleCount, 41);
  groups.push({ id: 'B02-pins-and-packet', status: 'PASS', pins: 38, runtimeFiles: 32, productExecuted: 0 });

  const expectedSlots = ['/private/tmp/safe-bash-b2-runtime-r8','/private/tmp/safe-bash-b2-runtime-r8.outer.raw','/private/tmp/B2-R8-ROOT-GO.json'];
  assert.deepEqual(binding.absentSlotsBeforeAfter, expectedSlots);
  const absent = () => expectedSlots.map(filename => {
    try { fs.lstatSync(filename); throw new Error('occupied slot: ' + filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { path: filename, absent: true }; }
  });
  const slotsBefore = absent();
  const expectedCommand = '/bin/zsh /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r8/staged/new/launch.sh /private/tmp/B2-R8-ROOT-GO.json 6945';
  assert.equal(binding.command, expectedCommand); assert.equal(digest(Buffer.from(expectedCommand)), '59b7adb628be811652ede031c8ea3a0726de316a5c6a9dc4663b4b3bf7b4b18f');
  assert.equal(binding.commandSha256, digest(Buffer.from(expectedCommand)));
  assert.equal(binding.cwd, '/Users/kjopek/Workspace/safe-bash'); assert.equal(binding.login, false);
  assert.deepEqual(binding.roles, { owner: 1, children: 41, administration: 22 });
  const recipeRecord = await read(path.join(author, 'staged/metadata/RECIPE.json'));
  const recipe = JSON.parse(recipeRecord.bytes); assert.equal(recipe.roles.length, 41);
  assert.equal(new Set(recipe.roles.map(row => row.role)).size, 41);
  const launcher = (await read(path.join(author, 'staged/new/launch.sh'))).bytes.toString();
  const outer = (await read(path.join(author, 'staged/new/outer.mjs'))).bytes.toString();
  assert(launcher.includes('exec > /private/tmp/safe-bash-b2-runtime-r8.outer.raw 2>&1'));
  assert(launcher.includes('outer.mjs "$1" "$2"'));
  assert(outer.includes('for (const row of packet.files) admit('));
  assert(outer.indexOf('for (const row of packet.files) admit(') < outer.indexOf('await import("./coordinator.mjs")'));
  groups.push({ id: 'B03-command-graph-and-slots', status: 'PASS', commandSha256: binding.commandSha256, slotsBefore, roles: binding.roles, roleKinds: Object.fromEntries([...new Set(recipe.roles.map(row => row.kind))].map(kind => [kind, recipe.roles.filter(row => row.kind === kind).length])) });

  const window = binding.window;
  assert.equal(pending.notBefore, '2026-08-29T17:00:00.000Z'); assert.equal(window.externalLatestStart, '2026-08-29T17:05:00.000Z');
  assert.equal(pending.activeDeadline, '2026-08-29T17:27:00.000Z'); assert.equal(pending.deadline, '2026-08-29T17:30:00.000Z');
  for (const key of ['issuedAt','notBefore','activeDeadline','deadline']) { assert.equal(new Date(Date.parse(pending[key])).toISOString(), pending[key]); assert.equal(window[key], pending[key]); }
  assert.equal(Date.parse(pending.deadline) - Date.parse(pending.notBefore), 1800000);
  assert.equal(Date.parse(pending.deadline) - Date.parse(pending.activeDeadline), 180000);
  assert.equal(Date.parse(pending.deadline) - Date.parse(window.externalLatestStart), 1500000);
  assert.equal(Date.parse(pending.activeDeadline) - Date.parse(window.externalLatestStart), 1320000);
  const support = await import(pathToFileURL(path.join(author, 'staged/new/support.mjs')));
  assert.deepEqual(support.caps, caps);
  assert.equal(support.grant(pending, Date.parse(pending.notBefore)).times.deadline, Date.parse(pending.deadline));
  assert.equal(support.grant(pending, Date.parse(window.externalLatestStart)).times.deadline, Date.parse(pending.deadline));
  assert.throws(() => support.grant(pending, Date.parse(pending.notBefore) - 1));
  assert.throws(() => support.grant(pending, Date.parse(pending.activeDeadline)));
  assert.equal(binding.cache.reservationBytes, 134217728); assert.equal(binding.cache.includedWithinWorkBytes, 536870912);
  assert.equal(binding.cache.kernelQuota, false); assert.equal(binding.cache.sourceDerivedUpperBound, false);
  const after = [];
  for (let index = 0; index < binding.pins.length; index++) { const actual = await identity(binding.pins[index].path); assert.deepEqual(actual, before[index]); after.push(actual); }
  assert.deepEqual(await identity(grantRecord.bound.path), grantRecord.bound);
  assert.deepEqual(await identity(bindingRecord.bound.path), bindingRecord.bound);
  const slotsAfter = absent();
  groups.push({ id: 'B04-window-policy-and-postguards', status: 'PASS', postguards: after.length, slotsAfter,
    externalLatestStartNotEncodedInRuntimeGrant: true, delayedStartShrinksTime: true, tests: 'DATA clock inputs; no runtime activation' });
  const result = { status: 'QUALIFIED_BINDING_ONLY_ACCEPT', groups, binding: bindingRecord.bound, grant: grantRecord.bound,
    command: expectedCommand, window, pins: before, checkedUTC: new Date().toISOString(), startedUTC: new Date(started).toISOString(), helperPID: process.pid,
    childSpawns: 0, actualB2: 0, installedGrant: false, publicationReserveSeconds: 180,
    qualifications: ['External latest-start17:05 must be enforced by ROOT; runtime guard admits before activeDeadline17:27.', 'Delayed starts have less than1800 seconds; at latest1500 total/1320 active.', '128MiB cache reserve is inside512MiB logical work; non-atomic sampled not npm peak/kernel quota.', '64 knownOS includes1owner41children22administration;34loader threads are separate and not full census proof.', 'Original r7 and38ff819e failures unchanged; no runtime or archive decoding.'] };
  const report = `# B2 r8 final binding-only review\n\nQUALIFIED ACCEPT:4/4 DATA checks;38 pins authenticated before/after;3 slots absent before/after. Packet6945B SHA6df866e7990386218848061128777008bfbd6cdd93a7c0f658559fc0d0aa23f9,32 runtime files. Pending grant1081B mode0600 SHA779253fa14627330e812e9522603f8e61895a91155d5e4f9fe943f0823573e80.\n\nFixed UTC:17:00 notBefore /17:05 external latest /17:27 activeEnd /17:30 expiry on2026-08-29. Delayed start shrinks remaining time:latest gives1500 total/1320 active;180 publication reserve. Latest-start is external ROOT policy, not encoded runtime enforcement.\n\nCommand SHA256(UTF8,noLF):59b7adb628be811652ede031c8ea3a0726de316a5c6a9dc4663b4b3bf7b4b18f. Exact command/cwd/login and identities in RESULT.json.64 knownOS/peak3,41children,34loader admissions;96MiB precharged capture/512MiB logical work including128MiB sampled cache reserve. No npm peak/kernel quota/full transitive census claim.\n\nExactly one DATA helper, no child spawns/product/npm/compiler/Workers. Support grant function received explicit simulated timestamps only; no actual grant installed, runtime root or capture created. ROOT actual GO remains separate. Historical failures unchanged.\n`;
  write(path.join(output, 'HANDOFF.md'), Buffer.from(report));
  return result;
}
