import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const own=path.resolve('tests/compatibility/bash-ere-runtime-integration-design-20260829');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function read(filename,pin){const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>2097152)throw Error('FILE_ADMISSION');if(pin&&(stat.size!==pin.bytes||hash(fs.readFileSync(filename))!==pin.sha256))throw Error('PIN');const bytes=fs.readFileSync(fd);if(pin&&hash(bytes)!==pin.sha256)throw Error('HASH');return bytes;}finally{fs.closeSync(fd);}}
const sourcePath='/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-strict-extension-independent-20260829/n14-v2/SOURCE.json';
const bytes=read(sourcePath,{bytes:230044,sha256:'12a5806df9ea13eb66e99bec1f0c0c3198bfeb76da012559d943a4d874070fc4'}),source=JSON.parse(bytes);if(source.inputs.length!==293||source.computedTree!=='bf079ada185a79aec864b068f3738ddc5520822e')throw Error('CORE_SCOPE');
const seen=new Set();for(const row of source.inputs){if(typeof row.path!=='string'||seen.has(row.path)||row.path.startsWith('/')||row.path.split('/').includes('..')||!['100644','100755'].includes(String(row.mode))||!/^[0-9a-f]{40}$/.test(row.blob))throw Error('INPUT_ROW');seen.add(row.path);}
fs.writeFileSync(own+'/CORE-SOURCE.json.data',bytes,{flag:'wx',mode:0o600});
const rows=source.inputs.filter(row=>(row.path.startsWith('src/shell/')&&row.path.endsWith('.ts'))||['src/contracts/command.ts','src/contracts/limits.ts','src/contracts/io.ts'].includes(row.path));
const requests=rows.map(row=>[row.blob,'',row.path.replaceAll('/','__')]);
for(const name of ['root','protocol','owner','accounting'])requests.push(['0f36459ccf38623906c5c80702c5d32111167f4d','src/commands/regex-execution/ere/transport/'+name+'.ts','transport-'+name]);
fs.writeFileSync(own+'/SELECTED-REQUESTS.json',JSON.stringify(requests,null,2)+'\n',{flag:'wx',mode:0o600});fs.writeFileSync(own+'/CORE-SELECTION.json',JSON.stringify({sourceManifestSha256:hash(bytes),derived:source.computedTree,storedRuntimeCommit:source.sourceCommit,allInputCount:source.inputs.length,allInputBytes:source.inputs.reduce((sum,row)=>sum+row.bytes,0),selected:rows,sourceOnly:true,wholeTreeReconstruction:false},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({count:requests.length,coreCount:rows.length,selected:rows.map(row=>({path:row.path,blob:row.blob,sha256:row.sha256,bytes:row.bytes}))}));
