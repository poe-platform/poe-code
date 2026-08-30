import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const repo='/Users/kjopek/Workspace/safe-bash',own=repo+'/tests/shell/pipestatus-author-20260829/preexec-v1/actual-v2/inspection-v1';
let bytesRead=0;const files=[];
function read(filename,expected){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2097152)throw Error('SOURCE_BOUND');bytesRead+=stat.size;if(bytesRead>8388608)throw Error('TOTAL_BOUND');const bytes=fs.readFileSync(filename),sha256=createHash('sha256').update(bytes).digest('hex');if(expected&&((expected.bytes??expected.size)!==bytes.length||expected.sha256!==sha256))throw Error('SOURCE_AUTH '+filename);files.push({path:filename,bytes:bytes.length,sha256});return bytes.toString('utf8');}
const preexec=repo+'/tests/shell/pipestatus-author-20260829/preexec-v1';
const seal=JSON.parse(read(preexec+'/SEAL-v2.json',{bytes:795793,sha256:'f61b8fb41db61be3ed89fba296f5cbb9a6e8b4c80dd019202b065fe4f5a093d5'}));
const cases=seal.cases.filter(row=>['R16','R17','R18'].includes(row.id));
console.log('EXACT_BOUND_CASES '+JSON.stringify(cases));
const excerpts=[];
for(const name of ['src/shell/runtime.ts','src/shell/pipestatus.ts','src/shell/arrays/bindings.ts']){
 const row=seal.sources.find(item=>item.path===name||item.path.endsWith('/'+name));if(!row){console.log('SOURCE_MAPPING '+name+' '+JSON.stringify(seal.sources[0]));continue;}
 const filename=row.path.startsWith('/')?row.path:path.join(seal.sourceRoot,row.path);const text=read(filename,row),lines=text.split('\n');
 const ranges=[];for(let index=0;index<lines.length;index++){if(lines[index].includes('PIPESTATUS')&&(name!=='src/shell/runtime.ts'||lines.slice(Math.max(0,index-8),index+9).some(line=>line.includes('local')||line.includes('Local')))){const from=Math.max(0,index-8),to=Math.min(lines.length,index+18);if(ranges.some(range=>from<=range.to))continue;ranges.push({from,to});}}
 const selected=name==='src/shell/pipestatus.ts'?[{from:0,to:Math.min(lines.length,180)}]:ranges.slice(0,5);
 for(const range of selected){const excerpt={path:filename,line:range.from+1,text:lines.slice(range.from,range.to).join('\n')};excerpts.push(excerpt);console.log('SOURCE '+JSON.stringify(excerpt));}
}
const compatibility=repo+'/tests/compatibility';
const directories=fs.readdirSync(compatibility).filter(name=>name.includes('pipestatus')&&name.includes('typed'));
const native=[];
for(const directory of directories){const root=path.join(compatibility,directory);const walk=(folder,depth)=>{if(depth>3)return;for(const name of fs.readdirSync(folder)){const filename=path.join(folder,name),stat=fs.lstatSync(filename);if(stat.isDirectory()){walk(filename,depth+1);continue;}if(!stat.isFile()||stat.size>262144||!/(HANDOFF|REPORT|RESULT|RECEIPT|AUDIT|INSPECTION|MATRIX|manifest|observations|recipes).*\.(md|json)$/i.test(name))continue;const text=read(filename);if(!text.includes('P22')&&!text.includes('P23'))continue;const lines=text.split('\n'),matches=[];for(let index=0;index<lines.length;index++){if(lines[index].includes('P22')||lines[index].includes('P23'))matches.push({line:index+1,text:lines.slice(Math.max(0,index-3),Math.min(lines.length,index+14)).join('\n')});}native.push({path:filename,matches:matches.slice(0,8)});console.log('NATIVE '+JSON.stringify(native.at(-1)));}};walk(root,0);}
const result={cases,sourceExcerpts:excerpts,native,files,bytesRead,productExecutions:0,nativeExecutions:0,qualification:'SOURCE/DATA only; existing accepted P22/P23 observations, no new oracle or product execution.'};
fs.writeFileSync(own+'/R17-SOURCE.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log('READ_TOTAL '+bytesRead);
