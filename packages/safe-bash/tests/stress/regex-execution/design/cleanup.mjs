import { readFileSync, readdirSync, lstatSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = new URL('./', import.meta.url);
const root = new URL('../../../../', base);
const frozen = JSON.parse(readFileSync(new URL('frozen.json', base)));
const build = new URL('.build/', base);
const paths = [];
function visit(directory) {
  for (const name of readdirSync(directory)) {
    const path = new URL(name, directory);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('UNEXPECTED_SYMLINK');
    if (stat.isDirectory()) visit(new URL(name + '/', directory));
    else paths.push(path);
  }
}
visit(build);
for (const path of paths) {
  const relative = path.href.slice(root.href.length);
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (frozen.built[relative] !== digest) throw new Error('UNKNOWN_OR_CHANGED_BUILD_FILE ' + relative);
}
rmSync(build, { recursive: true });
writeFileSync(new URL('cleanup.json', base), JSON.stringify({ utc: new Date().toISOString(), removedOwnedFiles: paths.length, build: '.build', sourceAndEvidenceRetained: true }, null, 2) + '\n');
console.log(JSON.stringify({ removedOwnedFiles: paths.length }));
