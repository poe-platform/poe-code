import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const started=performance.now(),args=process.argv.slice(2);assert.equal(args.length,4);assert.equal(args[0],'--run');
function read(filename,identity,max){const stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max);assert.equal(stat.size,identity.bytes);const body=fs.readFileSync(filename);assert.equal(crypto.createHash('sha256').update(body).digest('hex'),identity.sha256);return body;}
const seal=JSON.parse(read(args[1],{bytes:Number(args[3]),sha256:args[2]},1048576));assert.equal(seal.schema,'coherent-b0-executable-preseal-v1');
for(const row of seal.files)read(path.join('/Users/kjopek/Workspace/safe-bash',row.path),row,4194304);
assert.equal(process.env.B0_ROOT_GO,'ROOT_B0_39_EXPLICIT_FRESH_AUTHORIZATION');assert.ok(performance.now()-started<60000,'bootstrap time bound');
await(await import(pathToFileURL(path.join(import.meta.dirname,'run.mjs')).href)).main(args,started);
