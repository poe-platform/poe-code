import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const root = fs.realpathSync(process.cwd());
const scope = import.meta.dirname;
const base = path.dirname(scope);
const issued = new Date();
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (file, record, cap = 8388608) => {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size === record.bytes && stat.size <= cap);
  const body = fs.readFileSync(file);
  assert.equal(body.length, record.bytes); assert.equal(sha(body), record.sha256);
  return body;
};
const stream = async (file, record) => {
  const stat = fs.lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size === record.bytes);
  const digest = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  assert.equal(digest.digest('hex'), record.sha256);
};
const identity = file => { const stat = fs.lstatSync(file); assert(stat.isFile() && stat.size < 131072); const body = fs.readFileSync(file); return { path: fs.realpathSync(file), bytes: body.length, sha256: sha(body) }; };
try {
  fs.mkdirSync(path.join(scope, 'capture'));
  const git = (label, args, input) => {
    const child = spawnSync('/usr/bin/git', args, { cwd: root, input, timeout: 15000, maxBuffer: 1048576, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' } });
    for (const channel of ['stdout', 'stderr']) fs.writeFileSync(path.join(scope, 'capture', `${label}.${channel}`), child[channel] ?? Buffer.alloc(0), { flag: 'wx' });
    assert.equal(child.status, 0); assert.equal(child.signal, null); assert.equal(child.error, undefined);
    return child.stdout;
  };
  git('status', ['status', '--porcelain=v1', '-z', '--', path.relative(root, scope)]);
  git('index', ['diff', '--cached', '--name-only', '-z']);
  const reviews = [
    { commit: 'ebf511e84bdb7d6fb0b11bca05310710c56967b9', path: 'tests/integration/agent-bash-coherent-independent-20260829/b1-preexecution-review/RECEIPT.json', sha256: '12c8f7e03af23977ccf5015a902fe04956681a26c89f59165409d606fc0578c2' },
    { commit: '7c8fb0e336499142398ef9ebe7169e64b7cfedfa', sha256: '602295f8ab1366c86bce9e719076a8c107e5107019fdbc31ff4b2892049239c5' },
  ];
  const paths = git('publisher-review-paths', ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', reviews[1].commit]).toString().split('\0').filter(name => name.endsWith('/RECEIPT.json'));
  assert.equal(paths.length, 1); reviews[1].path = paths[0];
  const specs = reviews.map(review => `${review.commit}:${review.path}`).join('\n') + '\n';
  const types = git('review-types', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], specs).toString().trim().split('\n');
  for (let index = 0; index < types.length; index++) {
    const [blob, type, size] = types[index].split(' '); assert.equal(type, 'blob'); assert(Number(size) < 131072);
    reviews[index].blob = blob; reviews[index].bytes = Number(size);
  }
  const bodies = git('review-bodies', ['cat-file', '--batch'], specs);
  let offset = 0;
  for (const review of reviews) {
    const newline = bodies.indexOf(10, offset); assert.equal(bodies.subarray(offset, newline).toString(), `${review.blob} blob ${review.bytes}`);
    const body = bodies.subarray(newline + 1, newline + 1 + review.bytes); assert.equal(sha(body), review.sha256);
    offset = newline + review.bytes + 2;
  }
  const runtimePreseal = { path: path.join(base, 'stage-b1-r2/PRESEAL.json'), bytes: 17692, sha256: '007887fff41f65481ecf7a4fe4ab68db2aa1a5c67d4782a30c5bf764d84f0fbc' };
  const seal = JSON.parse(read(runtimePreseal.path, runtimePreseal));
  const runtimeFiles = [];
  for (const entry of seal.files) { const file = path.join(root, entry.path); read(file, entry); runtimeFiles.push({ ...entry, path: fs.realpathSync(file) }); }
  const publisherBinding = { path: path.join(base, 'stage-b1-publication-v2/BINDING-v2.json'), bytes: 3923, sha256: '022ff1fc4ec15f25ef937419062a69ade7a0b3e3df482a0dcea7318e802fce56' };
  const publisherPreseal = { path: path.join(base, 'stage-b1-publication-v2/PRESEAL-v2.json'), bytes: 1532, sha256: 'eaf5c9d789906e689eb47b7586c1b0ad41226eff4a3ae4957a51013fbded7152' };
  const publisher = JSON.parse(read(publisherBinding.path, publisherBinding)); read(publisherPreseal.path, publisherPreseal);
  const publisherFiles = [];
  for (const entry of publisher.files) { const file = path.join(root, entry.path); read(file, entry); publisherFiles.push({ ...entry, path: fs.realpathSync(file) }); }
  const b0 = JSON.parse(read(path.join(root, seal.b0.path), seal.b0));
  const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node'; await stream(node, b0.node);
  const stage = JSON.parse(read(path.join(base, 'stage-b0-r2/stageAProducerPreseal.json'), b0.stageAProducerPreseal, 65536));
  const record = name => { const entry = b0.producerRecords.find(row => row.path === name); assert(entry); return JSON.parse(read(path.join(base, 'stage-a-r2/evidence', name), entry, 2097152)); };
  const sources = JSON.parse(read(stage.source.path, stage.source, 262144)).inputs;
  const emits = record('EMITTED.json'); const tools = record('TOOLS-BEFORE.json');
  assert.equal(sources.length, 309); assert.equal(emits.length, 1012);
  const producer = '/private/tmp/safe-bash-coherent-stage-a-20260829-r2';
  for (const entry of sources) read(path.join(producer, 'source', entry.path), entry, 33554432);
  for (const entry of emits) read(path.join(producer, 'source/dist', entry.path), entry, 33554432);
  const expectedTools = [];
  let toolLinks = 0;
  for (const entry of tools) {
    const file = path.join(producer, 'tools', entry.path); expectedTools.push(entry.path);
    if (entry.type === 'symlink' || Object.hasOwn(entry, 'target')) { assert(fs.lstatSync(file).isSymbolicLink()); assert.equal(fs.readlinkSync(file), entry.target); toolLinks++; }
    else await stream(file, entry);
  }
  const observed = [];
  const walk = (directory, prefix = '') => { for (const name of fs.readdirSync(directory).sort()) { const file = path.join(directory, name); const relative = prefix ? `${prefix}/${name}` : name; if (fs.lstatSync(file).isDirectory()) walk(file, relative); else observed.push(relative); } };
  walk(path.join(producer, 'tools')); assert.deepEqual(observed.sort(), expectedTools.sort());
  const packageRecord = { ...publisher.package, path: fs.realpathSync(path.join(root, publisher.package.path)) }; await stream(packageRecord.path, packageRecord);
  const authorityPath = path.join(publisher.outputs.work, 'PUBLICATION-AUTHORITY-v3.json');
  const ledgerPath = path.join(publisher.outputs.work, 'PREPUBLICATION-LEDGER-v3.json');
  const preimportCapture = ['stdout', 'stderr'].map(channel => path.join(publisher.outputs.work, `publication-preimport-v3.${channel}`));
  const absentSlots = [publisher.outputs.work, publisher.outputs.evidence, publisher.outputs.publication, ...publisher.outputs.launchCaptures, ...publisher.outputs.startupCaptures, authorityPath, ledgerPath, ...preimportCapture];
  for (const file of absentSlots) assert.equal(fs.existsSync(file), false, `Fresh ABSENT slot ${file}`);
  const preimportFiles = ['preimport.mjs'].map(name => identity(path.join(scope, name)));
  const runtimeCommand = { executable: '/bin/zsh', argv: [path.join(base, 'stage-b1-r2/launch.sh'), runtimePreseal.path, runtimePreseal.sha256, String(runtimePreseal.bytes)], cwd: root, login: false, env: { B1_ROOT_GO: 'ROOT_B1_PUBLIC15_EXPLICIT_FRESH_AUTHORIZATION' } };
  const publicationCommand = { executable: '/bin/zsh', argv: [path.join(base, 'stage-b1-publication-v2/publication.sh'), '--publish', publisherBinding.path, publisherBinding.sha256, String(publisherBinding.bytes), authorityPath, { slot: 'authoritySha256', type: 'sha256', producedBy: 'preimport.mjs from same written bytes after measured ledger authentication' }, { slot: 'authorityBytes', type: 'positive integer decimal', producedBy: 'same authority Buffer' }], cwd: root, login: false, env: { PATH: '/usr/bin:/bin' } };
  const packet = { schema: 'B1-final-binding-v3', issuedUTC: issued.toISOString(), latestStartUTC: new Date(issued.getTime() + 1200000).toISOString(), expiresUTC: new Date(issued.getTime() + 3000000).toISOString(), windowEnforcement: 'External ROOT/coordinator; runtime unchanged; no actual authority', reviews, publisherSourceCommit: 'daf5179dfc674b8d4744ad117dcc9e7bc6c492df', runtimeSourceCommit: 'bd0f227d081829512bafc2936f0b33632e02890b', runtimePreseal, publisherBinding, publisherPreseal, runtimeFiles, publisherFiles, preimportFiles, node: { ...b0.node, path: node }, product: { tree: '3adc676a0ab638c9788ef007e465931d65d2c6fe', sourceInputs: 309, actualEmits: 1012, packageMembers: 1014, package: packageRecord, toolRegularFiles: tools.length - toolLinks, toolLinks, PUBLIC96and98: 'exact encoded inputs/receipts rehashed in runtimeFiles; no inflation/import or fresh origin edge review' }, observedAbsentUTC: new Date().toISOString(), absentSlots, runtimeCommand, publicationCommand, slots: { authorityPath, ledgerPath, preimportCapture, rootGrantFile: path.join(scope, 'ACTUAL-ROOT-GRANT.json'), knownStartsBeforePublication: { status: 'UNMEASURED; no actual attempt', type: 'integer7..27', rule: 'actual recorded starts including preimport process; no reserved-slot math substituted for observations' } }, bounds: publisher.workerProfile, actualAuthority: false, qualifications: ['accepted explicit logical accounting only', 'Git internal physical growth trusted/unobserved', '8KiB startup reserve/check not OS interception', 'late output/headroom/persistence qualifications retained', 'known roles not full census/group absence', 'static closure not nested dynamic load proof'], completedUTC: new Date().toISOString() };
  const bytes = Buffer.from(JSON.stringify(packet, null, 2) + '\n');
  fs.writeFileSync(path.join(scope, 'PACKET.json'), bytes, { flag: 'wx' });
  const receipt = { path: path.join(scope, 'PACKET.json'), bytes: bytes.length, sha256: sha(bytes), issuedUTC: packet.issuedUTC, latestStartUTC: packet.latestStartUTC, expiresUTC: packet.expiresUTC, gitChildren: 5, productCalls: 0 };
  fs.writeFileSync(path.join(scope, 'RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(receipt));
} catch (error) { console.error(error); process.exitCode = 78; }
