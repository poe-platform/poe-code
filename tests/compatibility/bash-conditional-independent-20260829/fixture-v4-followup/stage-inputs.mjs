import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const own=path.dirname(fileURLToPath(import.meta.url));
assert.deepEqual(process.argv.slice(2),['--source-data-only']);
const spec=JSON.parse(fs.readFileSync(path.join(own,'STAGE-INPUTS.json')));
for(const row of spec.inputs){assert.ok(!row.from.split('/').some(part=>part==='..'||part==='AGENTS.md'));const source=path.join(spec.origin,row.from),stat=fs.lstatSync(source);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(fs.realpathSync(source),source);assert.equal(stat.size,row.bytes);const bytes=fs.readFileSync(source);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);const destination=path.join(own,row.from);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes,{flag:'wx',mode:stat.mode&511});assert.deepEqual(fs.readFileSync(destination),bytes);}
console.log(JSON.stringify({pid:process.pid,role:'SOURCE_DATA_ONLY',copies:spec.inputs.length,productImports:0}));

