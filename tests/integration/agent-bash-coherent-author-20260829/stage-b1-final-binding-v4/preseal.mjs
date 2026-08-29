import fs from 'node:fs';
import crypto from 'node:crypto';
const scope = import.meta.dirname;
const files = ['identity.mjs', 'controls.mjs', 'prepare.mjs', 'preseal.mjs'].map(name => {
  const file = `${scope}/${name}`; const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 32768) throw Error('Source admission');
  const bytes = fs.readFileSync(file);
  return { path: fs.realpathSync(file), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
});
const bytes = Buffer.from(JSON.stringify({ issuedUTC: new Date().toISOString(), files, helperCount: 1, groups: ['I01', 'I02', 'I03', 'I04'], actualAuthority: false }, null, 2) + '\n');
fs.writeFileSync(`${scope}/CONTROL-PRESEAL.json`, bytes, { flag: 'wx' });
console.log(JSON.stringify({ bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }));
