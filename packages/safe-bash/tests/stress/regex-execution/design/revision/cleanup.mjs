import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = new URL('./', import.meta.url);
const build = JSON.parse(readFileSync(new URL('evidence/build.json', base)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = []; const directories = [];
function visit(directory) {
  directories.push(directory);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) visit(path); else { assert(entry.isFile()); files.push(path); }
  }
}
visit(new URL('.temporary/', base));
assert.equal(files.length, Object.keys(build.built).length);
for (const path of files) {
  const relative = path.href.slice(new URL('.temporary/js/', base).href.length);
  assert.equal(hash(readFileSync(path)), build.built[relative], relative);
}
for (const path of files) unlinkSync(path);
for (const path of directories.reverse()) rmdirSync(path);
const cleanup = { utc: new Date().toISOString(), removedFiles: files.length, temporaryAbsent: !existsSync(new URL('.temporary/', base)), exactHashCheckedOnly: true };
writeFileSync(new URL('evidence/cleanup.json', base), JSON.stringify(cleanup, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(cleanup));
