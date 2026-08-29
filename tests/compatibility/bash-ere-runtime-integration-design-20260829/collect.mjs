import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const own=path.resolve('tests/compatibility/bash-ere-runtime-integration-design-20260829');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ensure=(value,message)=>{if(!value)throw Error(message);};
function local(relative){const filename=own+'/'+relative,stat=fs.lstatSync(filename);ensure(stat.isFile()&&stat.size<=2097152,'INPUT_METADATA');const bytes=fs.readFileSync(filename);return {bytes,sha256:hash(bytes)};}
const mode=process.argv[2];ensure(['docs','selected'].includes(mode),'MODE');
let requests;
if(mode==='docs'){
 const locators=JSON.parse(local('LOCATORS.json').bytes);
 requests=[
 ['2660137c','tests/compatibility/bash-strict-extension-independent-20260829/n14-v2/source-locator-handoff/HANDOFF.md','core-handoff'],
 ['2660137c','tests/compatibility/bash-strict-extension-independent-20260829/n14-v2/source-locator-handoff/LOCATORS.json','core-locators'],
 ['2660137c','tests/compatibility/bash-strict-extension-independent-20260829/n14-v2/source-locator-handoff/HASH-DOMAINS.json','core-domains'],
 ['a2249d46','tests/compatibility/bash-ere-design-20260829/README.md','ere-design'],
 ['a2249d46','tests/compatibility/bash-ere-design-20260829/REFERENCE-PROGRAMS.json','references'],
 ['a2249d46','tests/compatibility/bash-ere-design-20260829/HOST-PROTOCOLS.json','hosts'],
 ['a2249d46','tests/compatibility/bash-ere-design-20260829/SOURCE-BINDINGS.json','ere-source'],
 ['e2b4823c','tests/compatibility/bash-ere-design-20260829/BUDGET-API-DECISIONS.md','budget-decisions'],
 ['aa16808c','tests/compatibility/bash-ere-transport-design-20260829/ROOT-RATIFICATION-v1.md','transport-choices'],
 ['6c68be44','tests/compatibility/bash-ere-transport-author-20260829/HANDOFF.md','transport-handoff'],
 ['efcd8b49','tests/compatibility/bash-reference-preparation-20260829/source-preparation-v1/HANDOFF.md','gnu-handoff'],
 ];
 const auth=locators.rows.find(row=>row.commit==='7cdb62ac').paths.filter(name=>!name.includes('/TYPE-')&&/\.(json|md)$/.test(name));
 for(let index=0;index<auth.length;index++)requests.push(['7cdb62ac',auth[index],'transport-auth-'+index]);
}else requests=JSON.parse(local('SELECTED-REQUESTS.json').bytes);
ensure(requests.length>0&&requests.length<=48,'REQUEST_COUNT');
const input=Buffer.from(requests.map(row=>row[0]+(row[1]?':'+row[1]:'')).join('\n')+'\n');
function git(id,args,maximum){const out=fs.openSync(own+'/raw/'+id+'.stdout','wx+',0o600),err=fs.openSync(own+'/raw/'+id+'.stderr','wx+',0o600);let bytes;try{const result=spawnSync('/usr/bin/git',['-c','core.fsmonitor=false',...args],{input,shell:false,stdio:['pipe',out,err],timeout:10000,killSignal:'SIGKILL'});fs.fsyncSync(out);fs.fsyncSync(err);const stat=fs.fstatSync(out),errors=fs.fstatSync(err);ensure(stat.isFile()&&stat.size<=maximum&&errors.isFile()&&errors.size<=65536&&!result.error&&result.status===0&&result.signal===null,'GIT_STOP');bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const amount=fs.readSync(out,bytes,offset,bytes.length-offset,offset);ensure(amount>0,'SHORT_READ');offset+=amount;}}finally{fs.closeSync(out);fs.closeSync(err);}return bytes;}
const metadata=git(mode+'-metadata',['cat-file','--batch-check'],65536).toString('ascii').trimEnd().split('\n');ensure(metadata.length===requests.length,'METADATA_COUNT');
const pins=metadata.map((line,index)=>{const fields=line.split(' ');ensure(fields.length===3&&/^[a-f0-9]{40}$/.test(fields[0])&&fields[1]==='blob'&&/^\d+$/.test(fields[2]),'BLOB_METADATA');const size=Number(fields[2]);ensure(size<=2097152,'BLOB_SIZE');ensure(!requests[index][1]?.split('/').includes('AGENTS.md'),'NO_INSTRUCTIONS');return {blob:fields[0],bytes:size};});ensure(pins.reduce((sum,pin)=>sum+pin.bytes,0)<=12582912,'AGGREGATE_SOURCE');
const raw=git(mode+'-blobs',['cat-file','--batch'],12599296);let offset=0;const manifest=[];fs.mkdirSync(own+'/'+mode,{mode:0o700});
for(let index=0;index<requests.length;index++){const newline=raw.indexOf(10,offset);ensure(newline>=0,'HEADER');const header=raw.subarray(offset,newline).toString('ascii');ensure(header===metadata[index],'HEADER_BINDING');offset=newline+1;const bytes=raw.subarray(offset,offset+pins[index].bytes);offset+=bytes.length;ensure(raw[offset++]===10,'FRAME');const blob=crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');ensure(blob===pins[index].blob,'BLOB_HASH');const sha256=hash(bytes),filename=mode+'/'+requests[index][2]+'.data';fs.writeFileSync(own+'/'+filename,bytes,{flag:'wx',mode:0o600});manifest.push({authority:requests[index][0],sourcePath:requests[index][1],storedBlob:blob,bytes:bytes.length,sha256,copy:filename});}
ensure(offset===raw.length,'TRAILING_BYTES');fs.writeFileSync(own+'/'+mode.toUpperCase()+'-BINDINGS.json',JSON.stringify({role:'SOURCE/DATA only; no imports or evaluation',files:manifest},null,2)+'\n',{flag:'wx',mode:0o600});
for(const item of manifest){console.log(JSON.stringify(item));if(mode==='docs'&&['core-handoff','core-domains','core-locators','transport-auth-0','transport-handoff','gnu-handoff'].includes(requests.find(row=>mode+'/'+row[2]+'.data'===item.copy)[2])){const bytes=fs.readFileSync(own+'/'+item.copy);console.log(bytes.toString('utf8').slice(0,13000));}if(mode==='selected'){const bytes=fs.readFileSync(own+'/'+item.copy),lines=bytes.toString('utf8').split('\n');const matches=lines.map((text,index)=>({line:index+1,text})).filter(row=>/^(export |class |interface |type )|^  (?:async |private |readonly |constructor|[A-Za-z][A-Za-z0-9_]*\()|=~|BASH_REMATCH/.test(row.text));console.log(JSON.stringify({copy:item.copy,methods:matches.slice(0,150)}));}}
