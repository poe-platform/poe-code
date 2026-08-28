import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { makeAuthority } from './manifest.mjs';

const own = path.dirname(fileURLToPath(import.meta.url));
function read(name, maximum) { assert.match(name,/^[A-Za-z0-9_.-]+\.json$/); const filename=path.join(own,name),stat=fs.lstatSync(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maximum);return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(fs.readFileSync(filename))); }
const binding=read('BINDINGS.json',165223),pkg=read('PACKAGE-INVENTORY.json',164921);
const authority=makeAuthority(pkg,binding.selectedInputs,binding.candidate);
const source='export const authority = Object.freeze('+JSON.stringify(authority,null,2)+');\n';
fs.writeFileSync(path.join(own,'AUTHORITY.patch'),'*** Begin Patch\n*** Add File: '+path.relative(path.resolve(own,'../../../..'),path.join(own,'authority.mjs'))+'\n'+source.trimEnd().split('\n').map(line=>'+'+line).join('\n')+'\n*** End Patch\n',{flag:'wx'});
console.log(JSON.stringify({sourceGenerationOnly:true,authority,at:new Date().toISOString()}));
