import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-author-20260829/b1-data-recovery-v1';
let total=0;
function read(relative){const filename=root+'/'+relative;const stat=fs.lstatSync(filename);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1048576);total+=stat.size;assert(total<=8388608);return fs.readFileSync(filename);}
const raw=read('MANIFEST.json');assert.equal(createHash('sha256').update(raw).digest('hex'),'a0761e51f84c875dd13e2909251be80f0073eb97432f7265ee521a9d98f27551');const manifest=JSON.parse(raw);
console.log('MANIFEST_KEYS',Object.keys(manifest));
console.log('FIRST_IDENTITY',read(manifest.sources[0].identityPath).toString());
console.log('PRESEAL',read('PRESEAL.json').toString());
for(const row of manifest.sources){console.log('ROW',JSON.stringify({path:row.source.path,role:row.source.role,bytes:row.source.bytes,dataPath:row.dataPath}));if(['executed-FINAL','original-runtime-result','runtime-preseal-authority'].includes(row.source.role)||row.source.path.endsWith('/ROOT-GRANT.json')||row.source.path.endsWith('/STOP.json')){const value=JSON.parse(read(row.dataPath));console.log('STRUCTURE',row.source.role,JSON.stringify(value).slice(0,row.source.role==='original-runtime-result'?1800:28000));}}
console.log('RECOVER_SOURCE',read('recover.mjs').toString());
console.log('OUTCOMES',read('OUTCOMES.json').toString());
console.log('RECOVERY_POLICY',read('ROOT-POLICY.md').toString());
