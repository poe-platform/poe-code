import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve('tests/compatibility/bash-ere-native-reference-20260829'),own=root+'/preflight-v1';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const files=[];let bytes=0,captureBytes=0;
function scan(directory,relative=''){for(const name of fs.readdirSync(directory).sort()){const filename=directory+'/'+name,rel=relative?relative+'/'+name:name;if(['preflight-v1/raw/publish.stdout','preflight-v1/raw/publish.stderr'].includes(rel))continue;const stat=fs.lstatSync(filename);if(stat.isSymbolicLink())throw Error('SYMLINK');if(stat.isDirectory())scan(filename,rel);else{if(!stat.isFile()||stat.nlink!==1||stat.size>1048576)throw Error('FILE_ADMISSION');const value=fs.readFileSync(filename);files.push({path:rel,bytes:value.length,mode:stat.mode&511,sha256:hash(value)});bytes+=value.length;if(rel.includes('/raw/'))captureBytes+=value.length;}}}
scan(own,'preflight-v1');scan(root+'/materialized','materialized');
if(bytes>268435456||captureBytes>67108864||fs.existsSync(own+'/scratch'))throw Error('RESOURCE_BOUND');
const resultPin=files.find(item=>item.path==='preflight-v1/CONTROL-RESULT.json'),resultBytes=fs.readFileSync(own+'/CONTROL-RESULT.json');if(resultBytes.length!==resultPin.bytes||hash(resultBytes)!==resultPin.sha256)throw Error('RESULT_DRIFT');const result=JSON.parse(resultBytes);
const report={schema:'ere-preflight-publication-v1',at:new Date().toISOString(),files,bytes,captureBytes,controls:result.results.map(row=>({id:row.id,status:row.status})),passed:result.passed,failed:result.failed,assertions:result.assertions,allNativeObservations:'UNRUN',nativeChildren:0,fixtureChildren:0,entryExecution:false,approvalRequested:false,grantCreated:false,scratchRemoved:result.scratchRemoved,qualifiedControlsOnly:true,role:'AUTHOR_PREEXECUTION_EVIDENCE_REQUIRES_DIFFERENT_REVIEW'};
fs.writeFileSync(own+'/PUBLICATION.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({publicationSha256:hash(fs.readFileSync(own+'/PUBLICATION.json')),bytes,captureBytes,passed:report.passed,failed:report.failed,assertions:report.assertions}));
