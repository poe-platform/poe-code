import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validateIdentities } from './identity.mjs';
const root = fs.realpathSync(process.cwd());
const scope = import.meta.dirname;
const base = path.dirname(scope);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (file, expected, cap = 8388608) => {
  assert.equal(typeof file, 'string'); assert(path.isAbsolute(file));
  const stat = fs.lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size === expected.bytes && stat.size <= cap);
  const bytes = fs.readFileSync(file); assert.equal(bytes.length, expected.bytes); assert.equal(sha(bytes), expected.sha256); return bytes;
};
const stream = async (file, expected) => {
  const stat = fs.lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size === expected.bytes);
  const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  assert.equal(hash.digest('hex'), expected.sha256);
};
try {
  const issued = new Date();
  fs.mkdirSync(`${scope}/capture`);
  const prior = JSON.parse(read(`${base}/stage-b1-final-binding-v3/PACKET.json`, { bytes: 20152, sha256: '86721fa44a10c997abd2fbeb56673cacf6221c5d2f9830c40c3682af777928ca' }, 32768));
  const git = (label, args, input) => {
    const child = spawnSync('/usr/bin/git', args, { cwd: root, input, timeout: 15000, maxBuffer: 65536, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' } });
    for (const channel of ['stdout', 'stderr']) fs.writeFileSync(`${scope}/capture/${label}.${channel}`, child[channel] ?? Buffer.alloc(0), { flag: 'wx' });
    assert.equal(child.status, 0); assert.equal(child.signal, null); assert.equal(child.error, undefined); return child.stdout;
  };
  const helperPath = `${base}/stage-b1-final-binding-v3/preimport.mjs`;
  const spec = `d990b17d19d00d06327cbdf0cd6792482c8acffd:${path.relative(root, helperPath)}`;
  const meta = git('helper-type', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], spec + '\n').toString().trim().split(' ');
  assert.equal(meta[1], 'blob'); assert(Number(meta[2]) <= 32768);
  const framed = git('helper-body', ['cat-file', '--batch'], spec + '\n');
  const newline = framed.indexOf(10); assert.equal(framed.subarray(0, newline).toString(), meta.join(' '));
  const helperBody = framed.subarray(newline + 1, newline + 1 + Number(meta[2])); assert.equal(helperBody.length, Number(meta[2]));
  const preimportFiles = [{ path: helperPath, bytes: helperBody.length, sha256: sha(helperBody) }];
  const finalIdentities = [...prior.publisherFiles, ...preimportFiles];
  validateIdentities(finalIdentities);
  validateIdentities(prior.runtimeFiles);
  validateIdentities([prior.publisherBinding, prior.publisherPreseal, prior.runtimePreseal]);
  for (const entry of [...finalIdentities, ...prior.runtimeFiles, prior.publisherBinding, prior.publisherPreseal, prior.runtimePreseal]) {
    read(entry.path, entry); assert.equal(fs.realpathSync(entry.path), entry.path);
  }
  for (const review of prior.reviews) read(path.join(root, review.path), review, 131072);
  const seal = JSON.parse(read(prior.runtimePreseal.path, prior.runtimePreseal));
  const b0 = JSON.parse(read(path.join(root, seal.b0.path), seal.b0));
  await stream(prior.node.path, prior.node);
  const stage = JSON.parse(read(`${base}/stage-b0-r2/stageAProducerPreseal.json`, b0.stageAProducerPreseal, 65536));
  const producer = '/private/tmp/safe-bash-coherent-stage-a-20260829-r2';
  const record = name => { const entry = b0.producerRecords.find(item => item.path === name); assert(entry); return JSON.parse(read(`${base}/stage-a-r2/evidence/${name}`, entry, 2097152)); };
  const sources = JSON.parse(read(stage.source.path, stage.source, 262144)).inputs;
  const emits = record('EMITTED.json'); const tools = record('TOOLS-BEFORE.json');
  assert.equal(sources.length, 309); assert.equal(emits.length, 1012);
  for (const entry of sources) read(path.join(producer, 'source', entry.path), entry, 33554432);
  for (const entry of emits) read(path.join(producer, 'source/dist', entry.path), entry, 33554432);
  const expectedPaths = []; let links = 0;
  for (const entry of tools) {
    const file = path.join(producer, 'tools', entry.path); expectedPaths.push(entry.path);
    if (entry.type === 'symlink' || Object.hasOwn(entry, 'target')) { assert(fs.lstatSync(file).isSymbolicLink()); assert.equal(fs.readlinkSync(file), entry.target); links++; }
    else await stream(file, entry);
  }
  const observed = [];
  const walk = (directory, prefix = '') => { for (const name of fs.readdirSync(directory).sort()) { const file = path.join(directory, name); const relative = prefix ? `${prefix}/${name}` : name; if (fs.lstatSync(file).isDirectory()) walk(file, relative); else observed.push(relative); } };
  walk(`${producer}/tools`); assert.deepEqual(observed.sort(), expectedPaths.sort());
  await stream(prior.product.package.path, prior.product.package);
  for (const file of prior.absentSlots) assert.equal(fs.existsSync(file), false, `ABSENT ${file}`);
  const rootGrantFile = `${scope}/ACTUAL-ROOT-GRANT.json`; assert.equal(fs.existsSync(rootGrantFile), false);
  const now = new Date();
  const packet = { ...prior, schema: 'B1-final-binding-v4', issuedUTC: issued.toISOString(), latestStartUTC: new Date(issued.getTime() + 1200000).toISOString(), expiresUTC: new Date(issued.getTime() + 3000000).toISOString(), abandonedDraft: { commit: 'd990b17d19d00d06327cbdf0cd6792482c8acffd', issuedUTC: prior.issuedUTC, latestStartUTC: prior.latestStartUTC, expiresUTC: prior.expiresUTC, status: 'ABANDONED_NOT_AUTHORITY; original captured failure unchanged' }, preimportFiles, preimportOrigin: { commit: 'd990b17d19d00d06327cbdf0cd6792482c8acffd', blob: meta[0], ...preimportFiles[0] }, slots: { ...prior.slots, rootGrantFile, knownStartsBeforePublication: { status: 'UNMEASURED; no runtime', type: 'integer7..27', rule: '6..26 observed retired prior starts plus executing preimport self PID; coordinator observes helper exit/close; no intervening OS starts' } }, sourceGuards: { atUTC: now.toISOString(), sources: sources.length, emissions: emits.length, regularTools: tools.length - links, links, packageHash: prior.product.package.sha256, PUBLIC: 'all exact runtime-bound input hashes; no decode/import' }, identityShapePolicy: 'finite own-data absolute path/bytes/SHA256 records; exact spread, no flatten; duplicate paths rejected within each list before filesystem use', controlResults: 'CONTROLS.json four PURE shape groups, not runtime or full preimport protocol tests', actualAuthority: false, completedUTC: now.toISOString() };
  packet.absentSlots = [...prior.absentSlots, rootGrantFile];
  packet.preimportCommand = { executable: prior.node.path, argv: [helperPath, `${scope}/FINAL-PACKET.json`, { slot: 'finalPacketSha256', source: 'FINAL-RECEIPT.json.sha256' }, { slot: 'finalPacketBytes', source: 'FINAL-RECEIPT.json.bytes' }, { slot: 'rootGrantSha256', source: rootGrantFile }, { slot: 'rootGrantBytes', source: rootGrantFile }, { slot: 'measuredPriorLedgerSha256', source: prior.slots.ledgerPath }, { slot: 'measuredPriorLedgerBytes', source: prior.slots.ledgerPath }], cwd: root, login: false, capture: prior.slots.preimportCapture, rule: 'trusted capture/admission precedes helper entry; metadata-only, no automatic dispatch' };
  const body = Buffer.from(JSON.stringify(packet, null, 2) + '\n');
  fs.writeFileSync(`${scope}/FINAL-PACKET.json`, body, { flag: 'wx' });
  const receipt = { path: `${scope}/FINAL-PACKET.json`, bytes: body.length, sha256: sha(body), issuedUTC: packet.issuedUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC, sourceInputs: 309, emissions: 1012, tools: tools.length, actualCalls: 0, publisherBinding: packet.publisherBinding, publisherPreseal: packet.publisherPreseal, helper: preimportFiles[0], runtimePreseal: prior.runtimePreseal, knownGitChildren: 2, actualAuthority: false };
  fs.writeFileSync(`${scope}/FINAL-RECEIPT.json`, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(receipt));
} catch (error) { console.error(error); process.exitCode = 78; }
