import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scope = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repository = '/Users/kjopek/Workspace/safe-bash';
const output = path.join(scope, 'clock-v7', 'source-observations');
const originHrtimeNs = process.hrtime.bigint().toString();
const started = performance.now();
const maximumMs = 180000;
const maximumBytes = 3145728;
const receipts = [];
let written = 0;
let children = 0;
const hash = body => createHash('sha256').update(body).digest('hex');
function demand(condition, name) { if (!condition) throw new Error(name); }
async function capture(name, body) {
  demand(written + body.length <= maximumBytes, 'capture ceiling');
  written += body.length;
  await fs.writeFile(path.join(output, name), body, { flag: 'wx', mode: 0o600 });
}
async function identity(filename, expected) {
  demand(performance.now() - started < maximumMs, 'source review deadline');
  const before = await fs.lstat(filename);
  demand(before.isFile() && !before.isSymbolicLink() && before.size <= 8388608, 'regular bounded source');
  demand(await fs.realpath(filename) === filename, 'source realpath');
  const body = await fs.readFile(filename);
  const after = await fs.lstat(filename);
  demand(before.dev === after.dev && before.ino === after.ino && before.mode === after.mode && before.size === after.size && before.mtimeMs === after.mtimeMs, 'source stability');
  const actual = { bytes: body.length, mode: after.mode & 0o777, sha256: hash(body) };
  demand(actual.bytes === expected.bytes && actual.mode === expected.mode && actual.sha256 === expected.sha256, 'source identity: ' + filename);
  return body;
}
async function metadata(args, input) {
  demand(++children <= 13, 'metadata child ceiling');
  demand(performance.now() - started < maximumMs - 11000, 'metadata admission deadline');
  const result = spawnSync('/usr/bin/git', args, { cwd: repository, input, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, timeout: 10000, maxBuffer: maximumBytes - written, encoding: null });
  await capture(`${children}.stdout.raw`, result.stdout ?? Buffer.alloc(0));
  await capture(`${children}.stderr.raw`, result.stderr ?? Buffer.alloc(0));
  const receipt = { args, status: result.status, signal: result.signal, error: result.error?.code ?? null, elapsedMs: performance.now() - started };
  receipts.push(receipt);
  await capture(`${children}.process.json`, Buffer.from(JSON.stringify(receipt)));
  demand(result.status === 0 && result.signal === null && !result.error, 'metadata child failure');
  return result.stdout;
}
await fs.mkdir(output, { mode: 0o700 });
let failure = null;
let result;
try {
  await capture('STARTUP.json', Buffer.from(JSON.stringify({ role: 'SOURCE_PREFLIGHT_STARTUP', originHrtimeNs, candidateLoads: 0, compilerLoads: 0 })));
  await identity(path.join(scope, 'clock-v7/ROOT-GRANT.json'), {"path":"ROOT-GRANT.json","mode":420,"bytes":4099,"sha256":"035a82d4ef3babb2deef05ab687f59cd5088ea70cb374b7de056e7b5411a945a"});
  const recipeBody = await identity(path.join(scope, 'RECIPE-v7.json'), {"path":"RECIPE-v7.json","mode":420,"bytes":83489,"sha256":"f0adf8d086383d70fbae6489387515ee0835b702afda928206c0cf3bd0f8708f"});
  const sealBody = await identity(path.join(scope, 'FINAL-SEAL-v7.json'), {"path":"FINAL-SEAL-v7.json","mode":420,"bytes":21392,"sha256":"73edccde374954c3b2e574cdffff34be082ade4134efeee785eb03abaad75752"});
  const recipe = JSON.parse(recipeBody);
  const seal = JSON.parse(sealBody);
  await capture('inputs.json', Buffer.from(JSON.stringify({ recipe: hash(recipeBody), seal: hash(sealBody), role: 'SOURCE_DATA_ONLY_NO_TARGET_IMPORT' })));
  for (const entry of seal.files) await identity(path.join(scope, entry.path), entry);
  const assemblyBody = await identity(path.join(scope, recipe.assembly.path), recipe.assembly);
  const assembly = JSON.parse(assemblyBody);
  demand(assembly.files.length === 59 && new Set(assembly.files.map(row => row.path)).size === 59, 'selected membership');
  const selected = [...assembly.files, ...[{"sourcePath":"tests/commands/git-pack-independent-20260828/m1b-fca6f81d-review/capture-mode-v4/DATA-SEAL.json","sourceCommit":"dcdaa7c12d5b3924d3f605014dd701fc60e7be84","mode":420,"bytes":4838,"sha256":"d2c2c754322f9aedb0704912529af8ed811d0047e4e819862ce07befc59137de","blob":"b719ed8a7a041c1fe7ad73c0c20e4a0d97b6a382"},{"sourcePath":"tests/commands/git-pack-independent-20260828/m1b-fca6f81d-review/capture-mode-v4/check-mode-data.mjs","sourceCommit":"dcdaa7c12d5b3924d3f605014dd701fc60e7be84","mode":420,"bytes":8525,"sha256":"a2a0b50f93082afaf34d0f561195cc8f802573464efa087c148fe99f53a5ff9b","blob":"935e8b3eb6c190857a63f7fa2cc25f84cbc5ece3"}]];
  selected.push({"sourcePath":"tests/commands/git-pack-independent-20260828/m1b-fca6f81d-review/clock-v7/check-phases.mjs","sourceCommit":"c99d1036fec5053c3b564b1a2937f9f3c48f8c0b","mode":420,"bytes":12383,"sha256":"ac22a6a11a0662f2854893fdb89a7554b7f9d4a7e97b224d47aafc2a474c3235","blob":"afc7ce24b4768c2fba97e960a2f31fb4dbab0b4d"});
  const origins = [...new Set(selected.map(row => row.sourceCommit))];
  demand(origins.length === 12 && origins.every(value => /^[a-f0-9]{40}$/.test(value)), 'stored origins');
  const blobs = new Map();
  for (const origin of origins) {
    const rows = selected.filter(row => row.sourceCommit === origin);
    const raw = await metadata(['ls-tree', '-rz', '--full-tree', origin, '--', ...rows.map(row => row.sourcePath)]);
    const records = raw.toString('utf8').split('\0');
    demand(records.pop() === '', 'NUL framing');
    demand(records.length === rows.length, 'complete selected origin membership');
    for (const record of records) {
      const tab = record.indexOf('\t');
      const [mode, kind, blob] = record.slice(0, tab).split(' ');
      const filename = record.slice(tab + 1);
      const expected = rows.find(row => row.sourcePath === filename);
      demand(expected && mode === '100644' && kind === 'blob' && blob === expected.blob, 'stored path mode/blob');
      const body = await identity(path.join(repository, expected.sourcePath), expected);
      demand(createHash('sha1').update('blob ' + body.length + '\0').update(body).digest('hex') === blob, 'stored blob content');
      blobs.set(blob, expected);
    }
  }
  const rawBlobs = await metadata(['cat-file', '--batch'], Buffer.from([...blobs.keys()].join('\n') + '\n'));
  let cursor = 0;
  for (const [blob, expected] of blobs) {
    const newline = rawBlobs.indexOf(10, cursor);
    demand(newline !== -1, 'blob header');
    const header = rawBlobs.subarray(cursor, newline).toString('ascii');
    demand(header === `${blob} blob ${expected.bytes}`, 'exact stored body header');
    cursor = newline + 1;
    const body = rawBlobs.subarray(cursor, cursor + expected.bytes);
    demand(body.length === expected.bytes && hash(body) === expected.sha256, 'stored body SHA256');
    cursor += expected.bytes;
    demand(rawBlobs[cursor++] === 10, 'stored body delimiter');
  }
  demand(cursor === rawBlobs.length, 'no trailing stored body');
  let captureRows = 0;
  for (const archiveName of seal.modeRoles.nestedCaptureArchives) {
    const archiveIdentity = seal.files.find(row => row.path === archiveName);
    demand(archiveIdentity, 'EXPLICIT_CAPTURE_ARCHIVE');
    const archive = JSON.parse(await identity(path.join(scope, archiveName), archiveIdentity));
    const archiveDirectory = path.dirname(path.join(scope, archiveName));
    const names = (await fs.readdir(path.join(archiveDirectory, 'DATA-01'))).sort();
    demand(JSON.stringify(names) === JSON.stringify(archive.observations.map(row => path.basename(row.path)).sort()), 'ALL_CAPTURE_MEMBERSHIP');
    for (const row of archive.observations) {
      demand(row.mode === 0o600, 'ARCHIVED_CAPTURE_POSIX_AUTHORITY');
      await identity(path.join(archiveDirectory, row.path), row);
      captureRows++;
    }
  }
  demand(captureRows === 515, 'ALL515_CAPTURE_ROWS');
  const recipeOld = JSON.parse(await fs.readFile(path.join(scope, 'RECIPE-v5.json')));
  for (const key of ['typeFixtures', 'mutants', 'data', 'caps', 'reservations']) demand(JSON.stringify(recipe[key]) === JSON.stringify(recipeOld[key]), 'UNCHANGED_' + key);
  const preparation = JSON.parse(await identity(path.join(scope, 'clock-v7/PHASE-SEAL.json'), seal.files.find(row => row.path === 'clock-v7/PHASE-SEAL.json')));
  demand(preparation.controls.captures.length === 40 && preparation.controls.pass === 38 && preparation.controls.fail === 0, 'PHASE_CONTROL_MEMBERSHIP');
  const captureNames = preparation.controls.captures.map(row => path.basename(row.path)).sort();
  demand(JSON.stringify((await fs.readdir(path.join(scope, 'clock-v7/CONTROLS-01'))).sort()) === JSON.stringify(captureNames), 'PHASE_CAPTURE_FULL_MEMBERSHIP');
  for (const entry of preparation.controls.captures) { demand(entry.mode === 0o600, 'PHASE_CAPTURE_CREATION_ROLE'); await identity(path.join(scope, entry.path), entry); }
  demand(recipe.accounting.caseCounts.layoutCalls === 33 && recipe.accounting.caseCounts.completed214Replay === 0 && recipe.accounting.caseCounts.completed27Replay === 0, 'REMAINING_ONLY');
  demand(recipe.accounting.caseCounts.totalMaximumRequiredWindowsMs === 6150000 && recipe.accounting.caseCounts.totalMaximumRequiredWindowsMs <= recipe.caps.wallMs, 'FINITE_PHASE_SUM');
  const accounting = recipe.accounting;
  const captureSum = Object.entries(accounting.captureArithmetic).filter(([key]) => key !== 'total').reduce((sum, [, value]) => sum + value, 0);
  demand(captureSum === 255852544 && captureSum === accounting.captureArithmetic.total && captureSum <= recipe.caps.captureBytes, 'capture arithmetic');
  demand(accounting.allChildrenBelowOuter === 42 && accounting.processesIncludingOuter === 43 && recipe.caps.childStarts === 168 && recipe.caps.peakProcesses === 4, 'child arithmetic');
  demand(accounting.working.totalLiveCeilingWithFull256MiBCapture === 710937937 && accounting.working.totalLiveCeilingWithFull256MiBCapture < recipe.caps.workBytes, 'working ceiling');
  demand(recipe.caps.wallMs === 7200000 && recipe.batches.length === 29 && recipe.batches.every(batch => batch.timeoutMs <= 30000), 'single global/batch caps');
  for (const entry of seal.files) await identity(path.join(scope, entry.path), entry);
  for (const entry of assembly.files) await identity(path.join(repository, entry.sourcePath), entry);
  result = { status: 'MATCH_SOURCE_DATA_ONLY', selectedFiles: 59, captureRows, newCaptureRows: 40, additionalStoredAuthorityFiles: 3, storedOrigins: origins.length, storedBlobs: blobs.size, recipeSha256: hash(recipeBody), finalSealSha256: hash(sealBody), captureProposalBytes: captureSum, candidateExecutions: 0, compilerExecutions: 0, fixtureExecutions: 0 };
} catch (error) {
  failure = { name: error?.name ?? typeof error, message: error?.message ?? String(error) };
  process.exitCode = 1;
} finally {
  await capture('RESULT.json', Buffer.from(JSON.stringify({ originHrtimeNs, result: result ?? null, failure, childStarts: children, allMetadataChildrenKnownRetired: receipts.every(row => row.status === 0 && row.signal === null && row.error === null), captureBytesBeforeResult: written, elapsedMs: performance.now() - started, receipts }, null, 2) + '\n'));
}
