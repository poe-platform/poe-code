import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const home=path.dirname(fileURLToPath(import.meta.url));
const receipt=fs.openSync(path.join(home,'input-preparation.json'),'wx');
const state={role:'DATA-input-selection',start:new Date().toISOString(),productExecutions:0};
try{
 const file=path.join(home,'m03-INPUTS.json.gz.base64'),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1048576)throw Error('bounded DATA input');
 const compressed=Buffer.from(fs.readFileSync(file,'utf8').trim(),'base64');if(createHash('sha256').update(compressed).digest('hex')!=='2a9e4d4c7dc395b9ea6f8dfd5dfac0143a86b09e93aa3129f3e239c91a071d2c')throw Error('input integrity STOP');
 const rows=JSON.parse(gunzipSync(compressed,{maxOutputLength:4194304}));const manifest=JSON.parse(Buffer.from(rows.find(row=>row.oid==='184b174b55433d8ae862d95ff39e09e8635e560b').body,'base64'));
 if(manifest.shippingInputPaths.length!==309)throw Error('source count');const specs=[...new Set(manifest.shippingInputPaths.map(row=>row.blob))];
 specs.push('df6b2c0dfad8d7412f93f434d07a20b2b9375a86','7a5c620005fb04518d44bb284f4e99284e4a7c33:src/shell/runtime.ts','bb4dd0571a0335b20e29448bf88126ca02c1a32d:tests/integration/node-public-author-20260829/SOURCE.json','bb4dd0571a0335b20e29448bf88126ca02c1a32d:tests/commands/git-design-20260828/NEUTRAL-FIXTURE.json');
 fs.writeFileSync(path.join(home,'m04-SPECS.json'),JSON.stringify(specs,null,2)+'\n',{flag:'wx'});state.inputs=specs.length;state.ok=true;
}catch(error){state.error=error.message;process.exitCode=1;}
finally{state.end=new Date().toISOString();fs.writeFileSync(receipt,JSON.stringify(state,null,2)+'\n');fs.closeSync(receipt);}
