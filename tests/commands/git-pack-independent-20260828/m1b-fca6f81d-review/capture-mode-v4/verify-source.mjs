import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scope = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repository = '/Users/kjopek/Workspace/safe-bash';
const output = path.join(scope, 'capture-mode-v4', 'source-observations');
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
  demand(++children <= 10, 'metadata child ceiling');
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
  const recipeBody = await identity(path.join(scope, 'RECIPE-v4.json'), { bytes: 91617, mode: 0o644, sha256: '008b2051acf29842c21deee57b099abb661b08a4040574903962f89ff1fab339' });
  const sealBody = await identity(path.join(scope, 'FINAL-SEAL-v4.json'), { bytes: 19135, mode: 0o644, sha256: '7122a5116f69dc1ccea3bde141f7a7b2df2b78d2e6522ec34208bd5092abc24c' });
  const recipe = JSON.parse(recipeBody);
  const seal = JSON.parse(sealBody);
  await capture('inputs.json', Buffer.from(JSON.stringify({ recipe: hash(recipeBody), seal: hash(sealBody), role: 'SOURCE_DATA_ONLY_NO_TARGET_IMPORT' })));
  for (const entry of seal.files) await identity(path.join(scope, entry.path), entry);
  const assemblyBody = await identity(path.join(scope, recipe.assembly.path), recipe.assembly);
  const assembly = JSON.parse(assemblyBody);
  demand(assembly.files.length === 55 && new Set(assembly.files.map(row => row.path)).size === 55, 'selected membership');
  const selected = [...assembly.files, ...[{"sourcePath":"tests/commands/git-pack-independent-20260828/m1b-fca6f81d-review/capture-mode-v4/DATA-SEAL.json","sourceCommit":"dcdaa7c12d5b3924d3f605014dd701fc60e7be84","mode":420,"bytes":4838,"sha256":"d2c2c754322f9aedb0704912529af8ed811d0047e4e819862ce07befc59137de","blob":"b719ed8a7a041c1fe7ad73c0c20e4a0d97b6a382"},{"sourcePath":"tests/commands/git-pack-independent-20260828/m1b-fca6f81d-review/capture-mode-v4/check-mode-data.mjs","sourceCommit":"dcdaa7c12d5b3924d3f605014dd701fc60e7be84","mode":420,"bytes":8525,"sha256":"a2a0b50f93082afaf34d0f561195cc8f802573464efa087c148fe99f53a5ff9b","blob":"935e8b3eb6c190857a63f7fa2cc25f84cbc5ece3"}]];
  const origins = [...new Set(selected.map(row => row.sourceCommit))];
  demand(origins.length === 9 && origins.every(value => /^[a-f0-9]{40}$/.test(value)), 'stored origins');
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
  const recipeOld = JSON.parse(await fs.readFile(path.join(scope, 'RECIPE-v3.json')));
  for (const key of ['batches', 'caseManifests', 'typeFixtures', 'mutants', 'data', 'caps', 'phaseEndsMs', 'reservations', 'harness']) demand(JSON.stringify(recipe[key]) === JSON.stringify(recipeOld[key]), 'UNCHANGED_' + key);
  const accounting = recipe.accounting;
  const captureSum = Object.entries(accounting.captureArithmetic).filter(([key]) => key !== 'total').reduce((sum, [, value]) => sum + value, 0);
  demand(captureSum === 255852544 && captureSum === accounting.captureArithmetic.total && captureSum <= recipe.caps.captureBytes, 'capture arithmetic');
  demand(accounting.allChildrenBelowOuter === 64 && accounting.processesIncludingOuter === 65 && recipe.caps.childStarts === 168 && recipe.caps.peakProcesses === 4, 'child arithmetic');
  demand(accounting.working.totalLiveCeilingWithFull256MiBCapture === 710937937 && accounting.working.totalLiveCeilingWithFull256MiBCapture < recipe.caps.workBytes, 'working ceiling');
  demand(recipe.caps.wallMs === 7200000 && recipe.batches.length === 50 && recipe.batches.every(batch => batch.timeoutMs <= 30000), 'single global/batch caps');
  for (const entry of seal.files) await identity(path.join(scope, entry.path), entry);
  for (const entry of assembly.files) await identity(path.join(repository, entry.sourcePath), entry);
  result = { status: 'MATCH_SOURCE_DATA_ONLY', selectedFiles: 55, captureRows, additionalStoredAuthorityFiles: 2, storedOrigins: origins.length, storedBlobs: blobs.size, recipeSha256: hash(recipeBody), finalSealSha256: hash(sealBody), captureProposalBytes: captureSum, candidateExecutions: 0, compilerExecutions: 0, fixtureExecutions: 0 };
} catch (error) {
  failure = { name: error?.name ?? typeof error, message: error?.message ?? String(error) };
  process.exitCode = 1;
} finally {
  await capture('RESULT.json', Buffer.from(JSON.stringify({ result: result ?? null, failure, childStarts: children, allMetadataChildrenKnownRetired: receipts.every(row => row.status === 0 && row.signal === null && row.error === null), captureBytesBeforeResult: written, elapsedMs: performance.now() - started, receipts }, null, 2) + '\n'));
}
