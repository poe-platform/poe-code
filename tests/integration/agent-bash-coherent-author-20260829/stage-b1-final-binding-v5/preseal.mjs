import fs from 'node:fs';
import crypto from 'node:crypto';
const scope = import.meta.dirname;
const files = ['identity.mjs', 'preimport.mjs', 'prepare.mjs', 'controls.mjs', 'preseal.mjs', 'fixtures/publisher.json', 'fixtures/helper.json'].map(name => {
  const file = `${scope}/${name}`; const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size > 32768) throw Error('Source type/size');
  const bytes = fs.readFileSync(file); return { path: fs.realpathSync(file), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
});
const body = Buffer.from(JSON.stringify({ atUTC: new Date().toISOString(), files, helpers: 1, groups: 8, actualAuthority: false }, null, 2) + '\n');
fs.writeFileSync(`${scope}/CONTROL-PRESEAL.json`, body, { flag: 'wx' });
console.log(JSON.stringify({ bytes: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') }));
