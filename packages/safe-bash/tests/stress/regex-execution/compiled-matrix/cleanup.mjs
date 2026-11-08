import { lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { base, build, json, digest, same, save } from './guard.mjs';

if (process.argv.length !== 2) throw new Error('Fixed cleanup only');
const ledger = json(new URL('evidence/ledger.json', base));
if (ledger.compiled.activechildren !== 0 || ledger.compiled.declaredRows !== 12) throw new Error('Completion required');
if (lstatSync(build).isSymbolicLink() || realpathSync(build) !== fileURLToPath(build).slice(0, -1)) throw new Error('Unexpected build handle');
const owner = json(new URL('owner.json', build));
if (!same(owner, { namespace: 'compiled-matrix', sourceBundle: digest(new URL('source-bundle.json', base)) })) throw new Error('Wrong owned directory');
const check = directory => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Unexpected temporary symlink');
    if (entry.isDirectory()) check(new URL(entry.name + '/', directory));
  }
};
check(build);
rmSync(build, { recursive: true });
save(new URL('evidence/cleanup.json', base), { utc: new Date().toISOString(), removed: fileURLToPath(build),
  owner, activechildren: ledger.compiled.activechildren, tempBuildClean: true });
console.log('activechildren=0 tempBuildClean=true');
