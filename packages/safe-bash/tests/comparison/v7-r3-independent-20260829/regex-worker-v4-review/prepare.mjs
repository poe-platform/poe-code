import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const home = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve('tests/comparison/breadth-continuation-20260828/executor-v7-r3/runs/regex-worker-instrumented-v4-20260829');
const destination = path.join(home, 'composition/executor-v7-r3/runs/v4');
const receipt = fs.openSync(path.join(home, 'PREPARATION.json'), 'wx', 0o600);
const insist = (value, code) => { if (!value) throw Error(code); };
const hash = data => createHash('sha256').update(data).digest('hex');
function raw(filename, cap = 262144) {
  const info = fs.lstatSync(filename); insist(info.isFile() && !info.isSymbolicLink() && info.size <= cap, 'READ_ADMISSION');
  const data = fs.readFileSync(filename); insist(data.length === info.size, 'READ_SIZE'); return data;
}
function file(filename) { const data = raw(filename); return { path: filename, bytes: data.length, mode: fs.lstatSync(filename).mode & 511, sha256: hash(data) }; }
async function tool(row) {
  const info = fs.lstatSync(row.path); insist(info.isFile() && info.size === row.bytes && (info.mode & 511) === row.mode && info.size <= 120000000, 'TOOL_ADMISSION');
  const digest = createHash('sha256'); let size = 0;
  for await (const chunk of fs.createReadStream(row.path, { highWaterMark: 65536 })) { size += chunk.length; insist(size <= info.size, 'TOOL_CAP'); digest.update(chunk); }
  insist(size === row.bytes && digest.digest('hex') === row.sha256, 'TOOL_HASH');
}
let output;
try {
  const sealBytes = raw(path.join(source, 'SEAL.json'));
  insist(hash(sealBytes) === '95d3707e7117e6101fd96549e823e7299ba0c058ea179eaf7336160d53a903ec', 'SOURCE_SEAL');
  const seal = JSON.parse(sealBytes);
  const inventory = raw(path.join(home, 'source-tree.raw'));
  insist(inventory.at(-1) === 0, 'GIT_FRAMING');
  const rows = new Map();
  for (const record of inventory.subarray(0, -1).toString('utf8').split('\0')) {
    const separator = record.indexOf('\t'); insist(separator > 0, 'GIT_METADATA');
    const [mode, type, oid] = record.slice(0, separator).split(' '), filename = record.slice(separator + 1);
    insist(mode === '100644' && type === 'blob' && /^[0-9a-f]{40}$/.test(oid) && !rows.has(filename), 'GIT_DOMAIN'); rows.set(filename, oid);
  }
  const inputs = [], copies = [];
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const row of [...seal.files.map(row => ({ ...row, path: path.join(source, row.path) })), ...seal.inherited]) {
    const data = raw(row.path); insist(hash(data) === row.sha256 && data.length === row.bytes && (fs.lstatSync(row.path).mode & 511) === row.mode, 'SOURCE_BINDING'); inputs.push(row);
    if (row.path.startsWith(source + path.sep)) {
      const relative = path.relative(process.cwd(), row.path), oid = rows.get(relative);
      insist(oid && createHash('sha1').update(Buffer.from('blob ' + data.length + '\0')).update(data).digest('hex') === oid, 'STORED_SOURCE_OBJECT');
    }
    const target = row.path.startsWith(source + path.sep) ? path.join(destination, path.basename(row.path)) : path.join(home, 'composition/executor-v3', path.basename(row.path));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.writeFileSync(target, data, { flag: 'wx', mode: row.mode }); copies.push(file(target));
  }
  inputs.push(file(path.join(source, 'SEAL.json')));
  for (const row of [seal.node, seal.git]) await tool(row);
  const derived = { ...seal, inherited: seal.inherited.map(row => ({ ...row, path: path.join(home, 'composition/executor-v3', path.basename(row.path)) })) };
  const derivedRaw = Buffer.from(JSON.stringify(derived, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'SEAL.json'), derivedRaw, { flag: 'wx', mode: 0o644 }); copies.push(file(path.join(destination, 'SEAL.json')));
  const auth = { role: 'independent-review-fixture', scope: 'TWO_RETIRED_CHILD_PUBLICATION_FIXTURES', attempts: 1, sealSha256: hash(derivedRaw), sourceSealSha256: hash(sealBytes), actualRootGrant: false, Workers: 0 };
  fs.writeFileSync(path.join(home, 'FIXTURE-AUTH.json'), JSON.stringify(auth, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const own = ['PLAN.md', 'prepare.mjs', 'run.mjs', 'faults.mjs', 'FIXTURE-AUTH.json'].map(name => file(path.join(home, name)));
  const preseal = { schema: 'INDEPENDENT_REGEX_V4_PRESEAL', source, destination, sourceCommit: '131a898c3edb25edc34e2d26dfdcd28b74e7c015', sourceSealSha256: hash(sealBytes), inputs, copies, tools: [seal.node, seal.git], own, auth: file(path.join(home, 'FIXTURE-AUTH.json')), controls: { repeatedSmallFixtures: 2, novel: 12, fixtureNodeStarts: 4, Workers: 0 }, limits: { minutes: 25, allOS: 48, peak: 3, capture: 67108864, work: 268435456, fixtureStarts: 8 }, started: new Date().toISOString() };
  const bytes = Buffer.from(JSON.stringify(preseal, null, 2) + '\n'); insist(bytes.length < 262144, 'PRESEAL_CAP');
  fs.writeFileSync(path.join(home, 'PRESEAL.json'), bytes, { flag: 'wx', mode: 0o600 });
  output = { status: 'PRESEALED_NOT_RUN', sha256: hash(bytes), inputs: inputs.length, copiedFiles: copies.length, tools: 2, sourceFilesAuthenticated: seal.files.length, actualWorkers: 0 };
} catch (error) { output = { status: 'HOLD', message: error.message }; process.exitCode = 1; }
fs.writeSync(receipt, JSON.stringify(output, null, 2) + '\n'); fs.fsyncSync(receipt); fs.closeSync(receipt); process.stdout.write(JSON.stringify(output) + '\n');
