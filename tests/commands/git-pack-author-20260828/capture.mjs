import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { own, sha } from './prepare.mjs';
const [root, version] = process.argv.slice(2);
if (!root || !/^v[0-9]+$/.test(version) || !path.basename(root).startsWith('git-m1b-author-')) throw Error('exact owned root/version required');
const output = path.join(own, 'results-' + version); await fs.mkdir(output);
const result = JSON.parse(await fs.readFile(path.join(root, 'RESULT.json'))), rows = [];
let size = 0;
for (const name of (await fs.readdir(root)).sort()) {
  const filename = path.join(root, name), stat = await fs.lstat(filename); if (!stat.isFile()) continue;
  if (name === 'AGENTS.md' || stat.size > 16777216) throw Error('capture file refused');
  const bytes = await fs.readFile(filename); size += bytes.length; if (size > 268435456) throw Error('capture total exceeded');
  const row = { name, bytes: bytes.length, sha256: sha(bytes) };
  if (name.endsWith('.tgz')) { await fs.writeFile(path.join(output, 'PACKAGE.tgz.base64'), bytes.toString('base64') + '\n', { flag: 'wx' }); row.separateFullTarball = 'PACKAGE.tgz.base64'; }
  else if (name === 'development-blobs.stdout') row.omission = 'Authenticated exact Git source bytes; retained raw original, source manifest binds all blobs';
  else row.base64 = bytes.toString('base64');
  rows.push(row);
}
const encoded = gzipSync(Buffer.from(JSON.stringify({ role: 'AUTHOR_RAW_CAPTURE_NOT_RESCORE', root, result, files: rows }))).toString('base64') + '\n';
await fs.writeFile(path.join(output, 'RAW.json.gz.base64'), encoded, { flag: 'wx' });
const summary = { root, candidate: result.source.computedTree, module: result.source.moduleCommit, status: result.status, cohorts: result.cohorts.map(({ label, pass, fail }) => ({ label, pass, fail })), types: result.types.map(({ label, negative, pass }) => ({ label, negative, pass })), controls: result.controls.map(({ name, pass, detected }) => ({ name, pass, detected })), failures: result.failures, cleanup: result.cleanup, elapsedMs: result.elapsedMs, captureBytes: result.captureBytes, scratchWriteBytes: result.scratchWriteBytes, package: result.package && { sha256: result.package.sha256, bytes: result.package.bytes, members: result.package.members?.length }, rawSha256: sha(Buffer.from(encoded)), files: rows.map(({ base64, ...row }) => row) };
await fs.writeFile(path.join(output, 'SUMMARY.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, rawSha256: summary.rawSha256, files: rows.length, package: summary.package }));
