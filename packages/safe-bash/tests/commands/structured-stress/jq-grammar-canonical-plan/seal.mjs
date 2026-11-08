import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, owned, digest, artifact } from './common.mjs';

const entries = [];
function visit(relative = '') {
  for (const name of readdirSync(resolve(root, owned, relative)).sort()) {
    const path = relative ? `${relative}/${name}` : name;
    if (path === 'MANIFEST.sha256') continue;
    const stat = lstatSync(resolve(root, owned, path));
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) visit(path);
    else entries.push(`${digest(readFileSync(resolve(root, owned, path)))}  ${path}`);
  }
}
visit();
artifact('MANIFEST.sha256', `${entries.sort().join('\n')}\n`);
console.log(JSON.stringify({ sealedFiles: entries.length }));
