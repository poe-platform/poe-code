import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { captureIdentity } from './mode-authority.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const scope = path.dirname(directory);
const repository = '/Users/kjopek/Workspace/safe-bash';
const relative = 'tests/commands/git-pack-independent-20260828/m1b-fca6f81d-review/decoder-v3/';
const output = path.join(directory, 'DATA-01');
const started = performance.now();
const maximumMs = 180000;
const maximumBytes = 1048576;
const sha = value => createHash('sha256').update(value).digest('hex');
const authority = { role: 'CAPTURE_POSIX_MODE', creationMode: 0o600, creationFlags: 'wx', creationSourceSha256: 'a2fb4dae7394c5fb7ed04b99ce9f79afb1b287f3a84fce9ef601559b61fcf414', archiveSha256: 'ca809a22ac6570310bc0f6d93024884997964aacb0f549fba8af988b05247ed5' };
const origins = [
  { commit: '5b7290ff14dec6af96bcdbde25d6c73ec8da8500', path: relative + 'check-data.mjs', sha256: authority.creationSourceSha256, bytes: 13630 },
  { commit: '9273c71437a36be97bc4eb5db5640131cd9543b4', path: relative + 'SEAL.json', sha256: authority.archiveSha256, bytes: 85054 }
];
let children = 0;
let captureBytes = 0;
let failure = null;
const controls = [];
const observed = [];
const processes = [];
function demand(condition, label) { if (!condition) throw new Error(label); }
function clock() { demand(performance.now() - started < maximumMs, 'MODE_DATA_DEADLINE'); }
async function record(name, value) {
  clock();
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  demand(captureBytes + bytes.length <= maximumBytes, 'MODE_DATA_CAPTURE');
  captureBytes += bytes.length;
  await fs.writeFile(path.join(output, name), bytes, { flag: 'wx', mode: 0o600 });
}
async function metadata(args, input) {
  clock();
  demand(++children <= 3, 'MODE_METADATA_CHILDREN');
  const result = spawnSync('/usr/bin/git', args, { cwd: repository, input, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, timeout: Math.min(10000, maximumMs - (performance.now() - started)), maxBuffer: maximumBytes - captureBytes });
  await record(children + '.stdout.raw', result.stdout ?? Buffer.alloc(0));
  await record(children + '.stderr.raw', result.stderr ?? Buffer.alloc(0));
  processes.push({ args, status: result.status, signal: result.signal, error: result.error?.code ?? null });
  await record(children + '.process.json', processes.at(-1));
  demand(result.status === 0 && result.signal === null && !result.error, 'MODE_METADATA_RETIREMENT');
  return result.stdout;
}
await fs.mkdir(output, { mode: 0o700 });
try {
  demand(process.execPath === '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node' && process.execArgv.length === 0 && !process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'MODE_DATA_NODE');
  const toolBytes = await fs.readFile(process.execPath);
  demand(sha(toolBytes) === '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011', 'MODE_NODE_IDENTITY');
  const blobs = [];
  for (const row of origins) {
    const bytes = await metadata(['ls-tree', '-z', row.commit, '--', row.path]);
    const framing = bytes.toString('utf8');
    demand(framing.endsWith('\0') && framing.split('\0').length === 2, 'MODE_STORED_MEMBERSHIP');
    const prefix = '100644 blob ';
    demand(framing.startsWith(prefix) && framing.slice(prefix.length + 40) === '\t' + row.path + '\0', 'MODE_GIT_FILE_ROLE');
    const blob = framing.slice(prefix.length, prefix.length + 40);
    demand(/^[a-f0-9]{40}$/.test(blob), 'MODE_BLOB');
    blobs.push({ ...row, blob });
  }
  const stored = await metadata(['cat-file', '--batch'], Buffer.from(blobs.map(row => row.blob).join('\n') + '\n'));
  let cursor = 0;
  const bodies = [];
  for (const row of blobs) {
    const end = stored.indexOf(10, cursor);
    demand(end !== -1 && stored.subarray(cursor, end).toString('ascii') === `${row.blob} blob ${row.bytes}`, 'MODE_BLOB_FRAME');
    cursor = end + 1;
    const bytes = stored.subarray(cursor, cursor + row.bytes);
    cursor += row.bytes;
    demand(stored[cursor++] === 10 && sha(bytes) === row.sha256, 'MODE_STORED_BYTES');
    demand(sha(await fs.readFile(path.join(repository, row.path))) === row.sha256, 'MODE_LIVE_AUTHORITY_BYTES');
    bodies.push(bytes);
  }
  demand(cursor === stored.length, 'MODE_NO_TRAILING');
  const source = bodies[0].toString('utf8');
  demand(source.includes("await fs.writeFile(path.join(output, String(++sequence).padStart(3, '0') + '.json'), bytes, { flag: 'wx', mode: 0o600 });") && !source.includes('chmod'), 'BOUND_EXCLUSIVE_CAPTURE_CREATION');
  const archived = JSON.parse(bodies[1]);
  demand(archived.observations.length === 492, 'ALL_CAPTURE_ROWS');
  demand(JSON.stringify((await fs.readdir(path.join(scope, 'decoder-v3/DATA-01'))).sort()) === JSON.stringify(archived.observations.map(row => path.basename(row.path))), 'EXACT_CAPTURE_MEMBERSHIP');
  for (const row of archived.observations) {
    clock();
    const filename = path.join(scope, 'decoder-v3', row.path);
    const before = await fs.lstat(filename);
    demand(before.isFile() && !before.isSymbolicLink() && await fs.realpath(filename) === filename && before.size <= 1048576, 'MODE_REGULAR_CAPTURE');
    const bytes = await fs.readFile(filename);
    const after = await fs.lstat(filename);
    demand(before.dev === after.dev && before.ino === after.ino && before.mode === after.mode && before.size === after.size && before.mtimeMs === after.mtimeMs, 'MODE_CAPTURE_STABILITY');
    const actual = { path: row.path, mode: after.mode & 0o777, bytes: bytes.length, sha256: sha(bytes) };
    observed.push({ declared: row, observed: actual });
    captureIdentity(row, actual, authority);
  }
  await record('CAPTURE-MODES.json', { authority, origins: blobs, observations: observed });
  const declared = archived.observations.at(-1);
  const actual = observed.at(-1).observed;
  const variants = [
    ['correct0600', declared, actual, authority, true],
    ['wrong-observed0644', declared, { ...actual, mode: 420 }, authority, false],
    ['missing-observed-mode', declared, Object.fromEntries(Object.entries(actual).filter(([key]) => key !== 'mode')), authority, false],
    ['missing-declared-mode', Object.fromEntries(Object.entries(declared).filter(([key]) => key !== 'mode')), actual, authority, false],
    ['invented-declared0644', { ...declared, mode: 420 }, { ...actual, mode: 420 }, authority, false],
    ['git-mode-role-confusion', declared, actual, { ...authority, role: 'GIT_REGULAR_FILE' }, false],
    ['source-path-role-confusion', { ...declared, path: 'check-data.mjs' }, { ...actual, path: 'check-data.mjs' }, authority, false],
    ['missing-creation-mode', declared, actual, Object.fromEntries(Object.entries(authority).filter(([key]) => key !== 'creationMode')), false],
    ['string-mode', declared, { ...actual, mode: '0600' }, authority, false],
    ['wrong-capture-hash', declared, { ...actual, sha256: '0'.repeat(64) }, authority, false],
    ['wrong-capture-size', declared, { ...actual, bytes: actual.bytes + 1 }, authority, false],
    ['creation-not-exclusive', declared, actual, { ...authority, creationFlags: 'w' }, false]
  ];
  for (const [id, declaration, observation, provenance, accept] of variants) {
    let returned = null;
    let error = null;
    try { returned = captureIdentity(declaration, observation, provenance); } catch (caught) { error = { name: caught.name, message: caught.message }; }
    await record(id + '.raw.json', { id, declaration, observation, provenance, returned, error });
    const passed = accept ? error === null && JSON.stringify(returned) === JSON.stringify(declared) : error !== null;
    controls.push({ id, passed });
    demand(passed, 'MODE_CONTROL:' + id);
  }
} catch (error) {
  failure = { name: error?.name ?? typeof error, message: error?.message ?? String(error) };
  process.exitCode = 1;
} finally {
  await record('RESULT.json', { status: failure ? 'STOP' : 'PASS_DATA_ONLY', failure, controls, captureRowsVerified: observed.length, processes, allMetadataChildrenKnownRetired: processes.every(row => row.status === 0 && row.signal === null && row.error === null), elapsedMs: performance.now() - started, captureBytesBeforeResult: captureBytes, productLoads: 0, old245Rescored: false });
}
