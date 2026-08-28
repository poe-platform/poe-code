import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyRecipe(expectedSealHash) {
  const demand = (condition, label) => { if (!condition) throw new Error(`RECIPE_INTEGRITY: ${label}`); };
  demand(/^[a-f0-9]{64}$/u.test(expectedSealHash), 'independently supplied seal digest required');
  let ancestor = root;
  while (true) {
    demand(!lstatSync(ancestor).isSymbolicLink(), ancestor);
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  demand(realpathSync(root) === root, 'root alias');
  const sealPath = join(root, 'RECIPE-SEAL.json');
  const sealStat = lstatSync(sealPath);
  demand(sealStat.isFile() && !sealStat.isSymbolicLink() && sealStat.nlink === 1 && (sealStat.mode & 4095) === 420, 'seal mode/type');
  const raw = readFileSync(sealPath);
  demand(hash(raw) === expectedSealHash, 'seal bytes');
  const seal = JSON.parse(raw);
  const actual = {};
  const visit = relative => {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      if (path === 'RECIPE-SEAL.json') continue;
      const stat = lstatSync(join(root, path));
      demand(!stat.isSymbolicLink(), path);
      if (stat.isDirectory()) { actual[path] = { type: 'directory', mode: stat.mode & 4095 }; visit(path); }
      else {
        demand(stat.isFile() && stat.nlink === 1, path);
        const bytes = readFileSync(join(root, path));
        actual[path] = { type: 'file', mode: stat.mode & 4095, bytes: bytes.length, sha256: hash(bytes) };
      }
    }
  };
  visit('');
  demand((lstatSync(root).mode & 4095) === seal.rootMode, 'root mode');
  demand(JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(seal.entries).sort()), 'membership including new entries');
  for (const [path, identity] of Object.entries(actual)) demand(JSON.stringify(identity) === JSON.stringify(seal.entries[path]), path);
  return { entries: Object.keys(actual).length, sealSha256: expectedSealHash, productExecution: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node verify-recipe.mjs ROOT_ROUTED_SEAL_SHA256');
    console.log(JSON.stringify(verifyRecipe(process.argv[2])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
