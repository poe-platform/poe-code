import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const repo = '/Users/kjopek/Workspace/safe-bash';
const own = path.join(repo, 'tests/shell/pipestatus-author-20260829');
const work = '/private/tmp/safe-bash-pipestatus-author-fresh';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename, maximum = 4 * 1024 * 1024) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size > maximum) throw new Error(`regular/size admission ${filename}`);
  const content = fs.readFileSync(filename);
  if (content.length !== stat.size) throw new Error('read size changed');
  return content;
}
function streamBinding(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error('binding admission');
  const digest = crypto.createHash('sha256'); const buffer = Buffer.alloc(65536);
  const descriptor = fs.openSync(filename, 'r'); let total = 0;
  try { for (;;) { const count = fs.readSync(descriptor, buffer, 0, buffer.length, null); if (!count) break; total += count; digest.update(buffer.subarray(0, count)); } }
  finally { fs.closeSync(descriptor); }
  if (total !== stat.size) throw new Error('binding size drift');
  return { path: filename, size: total, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}
const save = (name, value) => fs.writeFileSync(path.join(own, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sealBytes = read(path.join(own, 'SEAL.json'));
const seal = JSON.parse(sealBytes);
for (const row of seal.sources) {
  const content = read(path.join(seal.candidate, row.path));
  if (content.length !== row.bytes || hash(content) !== row.sha256) throw new Error('original candidate drift');
}
for (const row of seal.tools) {
  const actual = streamBinding(row.path);
  if (actual.size !== row.size || actual.mode !== row.mode || actual.sha256 !== row.sha256) throw new Error('tool drift');
}
const files = [];
function collect(directory, relative) {
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name); const next = relative + '/' + name;
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) collect(absolute, next);
    else {
      if (!stat.isFile()) throw new Error('nonregular build member');
      if (name.startsWith('pipestatus-proof-types.')) continue;
      files.push({ relative: next, absolute, content: read(absolute), mode: stat.mode & 0o777 });
    }
  }
}
collect(path.join(seal.candidate, 'dist'), 'package/dist');
for (const name of ['README.md', 'package.json']) files.push({ relative: 'package/' + name, absolute: path.join(seal.candidate, name), content: read(path.join(seal.candidate, name)), mode: 0o644 });
files.sort((left, right) => Buffer.compare(Buffer.from(left.relative), Buffer.from(right.relative)));
if (files.reduce((total, row) => total + row.content.length, 0) > 32 * 1024 * 1024) throw new Error('package decoded bound');
const pieces = [];
for (const row of files) {
  const header = Buffer.alloc(512);
  const encoded = Buffer.from(row.relative);
  if (encoded.length > 100) {
    const split = row.relative.lastIndexOf('/');
    const prefix = Buffer.from(row.relative.slice(0, split)); const suffix = Buffer.from(row.relative.slice(split + 1));
    if (prefix.length > 155 || suffix.length > 100) throw new Error('ustar pathname capacity');
    suffix.copy(header, 0); prefix.copy(header, 345);
  } else encoded.copy(header);
  const octal = (offset, length, value) => header.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
  octal(100, 8, row.mode); octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, row.content.length); octal(136, 12, 0);
  header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257, 'ascii'); header.write('00', 263, 'ascii');
  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  pieces.push(header, row.content, Buffer.alloc((512 - row.content.length % 512) % 512));
}
pieces.push(Buffer.alloc(1024));
const tar = Buffer.concat(pieces);
const compressed = zlib.gzipSync(tar);
if (compressed.length > 16 * 1024 * 1024) throw new Error('compressed package bound');
const packagePath = path.join(own, 'original-build-artifact.tgz');
fs.writeFileSync(packagePath, compressed, { flag: 'wx' });
const packageBinding = streamBinding(packagePath);
save('PACKAGE.json', { ...packageBinding, kind: 'manual USTAR/gzip original strict-build artifact projection; NOT npm-produced/installed acceptance', originalSeal: hash(sealBytes), members: files.map(row => ({ path: row.relative, size: row.content.length, mode: row.mode, sha256: hash(row.content) })), count: files.length, tarBytes: tar.length, compressedAdmittedBeforeAnyFutureInflation: true, noInflationPerformed: true, validationOnlyDeclarationsExcluded: true, correctedG18SourceIncluded: false });
const corrected = streamBinding(path.join(repo, 'src/shell/pipestatus.ts'));
const original = seal.sources.find(row => row.path === 'src/shell/pipestatus.ts');
save('SOURCE-SUCCESSOR.json', { originalSourceSeal: hash(sealBytes), unchangedRuntime: streamBinding(path.join(repo, 'src/shell/runtime.ts')), originalHelper: original, correctedHelper: corrected, strictBuildOfCorrection: 'NOT RUN: one compiler authorization consumed', pureCorrectionReplay: 'NOT RUN', expectedSourceCount: 307 });
const oldMatrix = path.join(repo, 'tests/compatibility/bash-surface-next-gaps-design-20260829/PROOF-MATRIX.json');
const oldBytes = read(oldMatrix);
JSON.parse(oldBytes);
fs.writeFileSync(path.join(own, 'legacy-32.data.json'), oldBytes, { flag: 'wx' });
save('LEGACY-BINDING.json', streamBinding(oldMatrix));
const result = JSON.parse(read(path.join(own, 'PURE-RESULTS.json')));
const build = JSON.parse(read(path.join(own, 'BUILD.json')));
const roles = read(path.join(work, 'roles.log')).toString('utf8').trimEnd().split('\n');
let scratchBytes = 0; let scratchFiles = 0;
function census(root) {
  for (const name of fs.readdirSync(root)) {
    const filename = path.join(root, name); const stat = fs.lstatSync(filename);
    if (stat.isDirectory()) census(filename);
    else { if (!stat.isFile()) throw new Error('owned scratch nonregular'); scratchBytes += stat.size; scratchFiles++; }
  }
}
census(work);
if (scratchBytes > 512 * 1024 * 1024 || roles.length > 80) throw new Error('phase resource stop');
save('PUBLICATION.json', { date: '2026-08-29', build, pure: { passed: result.passed, count: result.count, failed: result.groups.filter(row => row.status !== 'PASS') }, rolesObservedThroughThisSnapshot: roles, knownStartsThroughSnapshot: roles.length, scratchBytes, scratchFiles, peakKnownProcesses: 3, topology: 'controller shell -> Node helper -> synchronous Git or compiler; tests sequential with zero process starts', finalAdministrativeRolesNotYetIncluded: 'subsequent explicit Git/documentation/publication roles must be appended separately', sourceCount: seal.count, package: { sha256: packageBinding.sha256, bytes: packageBinding.size, members: files.length }, workers: 0, shellExecutions: 0, nativeExecutions: 0, compiledCorrection: false });
console.log(JSON.stringify({ sourceCount: seal.count, packageMembers: files.length, packageSha256: packageBinding.sha256, passed: result.passed, failed: result.count - result.passed, scratchBytes, knownStarts: roles.length, correctedSourceUncompiled: true }));
