import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(directory, 'DATA-01');
const started = performance.now();
const startedAt = new Date().toISOString();
const paths = [
  ['bash', '/bin/bash'],
  ['bash', '/usr/bin/bash'],
  ['bash', '/usr/local/bin/bash'],
  ['bash', '/opt/homebrew/bin/bash'],
  ['bash', '/usr/local/opt/bash/bin/bash'],
  ['bash', '/opt/homebrew/opt/bash/bin/bash'],
  ['bash', '/opt/local/bin/bash'],
  ['bash', '/opt/pkg/bin/bash'],
  ['bash', '/usr/pkg/bin/bash'],
  ['bash', '/usr/local/Cellar/bash/5.3/bin/bash'],
  ['bash', '/usr/local/Cellar/bash/5.3.15/bin/bash'],
  ['bash', '/opt/homebrew/Cellar/bash/5.3/bin/bash'],
  ['bash', '/opt/homebrew/Cellar/bash/5.3.15/bin/bash'],
  ['compiler', '/usr/bin/cc'],
  ['compiler', '/usr/bin/clang'],
  ['compiler', '/Library/Developer/CommandLineTools/usr/bin/clang'],
  ['compiler', '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang'],
  ['make', '/usr/bin/make'],
  ['make', '/Library/Developer/CommandLineTools/usr/bin/make'],
  ['make', '/opt/homebrew/bin/gmake'],
  ['make', '/usr/local/bin/gmake'],
  ['patch', '/usr/bin/patch'],
  ['patch', '/opt/homebrew/bin/gpatch'],
  ['patch', '/usr/local/bin/gpatch'],
  ['signature-verifier', '/usr/bin/gpg'],
  ['signature-verifier', '/usr/bin/gpgv'],
  ['signature-verifier', '/opt/homebrew/bin/gpg'],
  ['signature-verifier', '/opt/homebrew/bin/gpgv'],
  ['signature-verifier', '/usr/local/bin/gpg'],
  ['signature-verifier', '/opt/local/bin/gpg'],
  ['sdk-directory', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk'],
  ['sdk-directory', '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk'],
];
const allowedPrefixes = [
  '/bin/', '/usr/bin/', '/usr/local/', '/opt/homebrew/', '/opt/local/',
  '/opt/pkg/', '/usr/pkg/', '/Library/Developer/CommandLineTools/',
  '/Applications/Xcode.app/Contents/Developer/',
];
const records = [];
const hashed = new Map();
let readBytes = 0;
let captureBytes = 0;
let failure = null;
function demand(value, label) { if (!value) throw new Error(label); }
function clock() { demand(performance.now() - started < 120000, 'SURVEY_DEADLINE'); }
async function publish(name, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  demand(captureBytes + bytes.length <= 4194304, 'CAPTURE_LIMIT');
  captureBytes += bytes.length;
  await fs.writeFile(path.join(output, name), bytes, { flag: 'wx', mode: 0o600 });
}
const statData = stat => ({ mode: stat.mode & 0o7777, bytes: stat.size, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
async function inspect(role, filename) {
  clock();
  let initial;
  try { initial = await fs.lstat(filename); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { role, path: filename, disposition: 'ABSENT', code: error.code };
    throw error;
  }
  const row = { role, path: filename, initial: statData(initial), symbolicLink: initial.isSymbolicLink() };
  if (initial.isSymbolicLink()) row.linkText = await fs.readlink(filename);
  let resolved;
  try { resolved = await fs.realpath(filename); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { ...row, disposition: 'DANGLING_LINK', code: error.code };
    throw error;
  }
  row.resolved = resolved;
  if (!allowedPrefixes.some(prefix => resolved.startsWith(prefix))) return { ...row, disposition: 'RESOLVED_TARGET_OUTSIDE_EXPLICIT_PUBLIC_PREFIXES_NOT_READ' };
  const before = await fs.lstat(resolved);
  demand(!before.isSymbolicLink(), 'RESOLUTION_CHANGED');
  row.target = statData(before);
  if (role === 'sdk-directory') return { ...row, disposition: before.isDirectory() ? 'DIRECTORY_METADATA_ONLY_NO_CONTENT_CLOSURE' : 'UNEXPECTED_TYPE_NOT_READ' };
  if (!before.isFile()) return { ...row, disposition: 'NONREGULAR_NOT_READ' };
  if (before.size > 268435456 || readBytes + before.size > 805306368) return { ...row, disposition: 'FILE_OR_CUMULATIVE_READ_BOUND_NOT_HASHED' };
  const prior = hashed.get(resolved);
  let sha256;
  if (prior && JSON.stringify(prior.stat) === JSON.stringify(statData(before))) sha256 = prior.sha256;
  else {
    const digest = createHash('sha256');
    for await (const bytes of createReadStream(resolved, { highWaterMark: 65536 })) {
      clock(); readBytes += bytes.length;
      demand(readBytes <= 805306368, 'READ_LIMIT');
      digest.update(bytes);
    }
    sha256 = digest.digest('hex');
  }
  const after = await fs.lstat(resolved);
  const finalLink = await fs.lstat(filename);
  demand(JSON.stringify(statData(before)) === JSON.stringify(statData(after)) && JSON.stringify(statData(initial)) === JSON.stringify(statData(finalLink)) && await fs.realpath(filename) === resolved, 'METADATA_CHANGED_DURING_READ');
  hashed.set(resolved, { stat: statData(after), sha256 });
  return { ...row, sha256, disposition: 'STABLE_REGULAR_METADATA_HASH_ONLY', executed: false, executedVersion: null };
}
try {
  await fs.mkdir(output, { mode: 0o700 });
  await publish('STARTUP.json', { role: 'OUTER_METADATA_CAPTURE_BEFORE_PATH_LOOKUPS', startedAt, plannedPaths: paths.length, children: 0, bashExecutions: 0, buildToolExecutions: 0, archiveFetches: 0 });
  for (const [role, filename] of paths) {
    const row = await inspect(role, filename);
    records.push(row);
    await publish(String(records.length).padStart(2, '0') + '.json', row);
  }
  const system = records.find(row => row.path === '/bin/bash');
  demand(system?.target?.mode === 0o555 && system.target.bytes === 1293840 && system.sha256 === '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3', 'ROOT_SYSTEM_BASH_IDENTITY_CHANGED');
  clock();
} catch (error) {
  failure = { name: error?.name ?? typeof error, code: error?.code ?? null, message: error?.message ?? String(error) };
  process.exitCode = 1;
  process.stderr.write(JSON.stringify({ role: 'METADATA_SURVEY_FAILURE', failure }) + '\n');
} finally {
  const result = { role: 'METADATA_ONLY_NOT_VERSION_OR_FENCE_QUALIFICATION', startedAt, finishedAt: new Date().toISOString(), status: failure === null ? 'COMPLETE_FINITE_SURVEY' : 'STOP', failure, elapsedMs: performance.now() - started, pathsPlanned: paths.length, pathsObserved: records.length, records, cumulativeHashReadBytes: readBytes, captureBytesBeforeResult: captureBytes, activeChildren: 0, childrenStarted: 0, productExecutions: 0, bashExecutions: 0, compilerExecutions: 0, makeExecutions: 0, patchExecutions: 0, signatureVerifierExecutions: 0, archiveFetches: 0, directoryEnumeration: 0, exhaustiveLocalInventory: false };
  try { await publish('RESULT.json', result); }
  catch (error) { process.exitCode = 1; process.stderr.write(JSON.stringify({ role: 'OUTER_PUBLICATION_FAILURE', message: error?.message ?? String(error), result }) + '\n'); }
}
