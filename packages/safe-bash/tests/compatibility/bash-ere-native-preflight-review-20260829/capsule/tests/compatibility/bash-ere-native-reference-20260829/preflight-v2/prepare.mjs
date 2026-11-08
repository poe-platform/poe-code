import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
const root=path.resolve('tests/compatibility/bash-ere-native-reference-20260829'),own=root+'/preflight-v2',destination=own+'/materialized';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ensure=(condition,reason)=>{if(!condition)throw Error(reason);};
const started=Date.now(),grantStart=fs.lstatSync(own+'/raw/prepare-syntax.stdout').birthtimeMs-120000,deadline=grantStart+720000;
function bounded(filename,pin){const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const before=fs.fstatSync(fd);ensure(before.isFile()&&before.nlink===1&&before.size<=1048576,'REGULAR_SIZE');if(pin)ensure(before.size===pin.bytes&&(before.mode&511)===pin.mode,'INPUT_METADATA');const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);ensure(bytes.length===before.size&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'READ_RACE');if(pin)ensure(hash(bytes)===pin.sha256,'INPUT_HASH');return bytes;}finally{fs.closeSync(fd);}}
function write(filename,value){ensure(Date.now()<=deadline,'PREPARATION_DEADLINE');fs.writeFileSync(filename,value,{flag:'wx',mode:0o600});}
function pin(filename,relative){const bytes=bounded(filename),stat=fs.lstatSync(filename);return {path:relative,bytes:bytes.length,mode:stat.mode&511,sha256:hash(bytes)};}
const parentRaw=bounded(root+'/preflight-v1/PUBLICATION.json');ensure(hash(parentRaw)==='4c176106d6730c33c087c2fcf31b375edf206c61dc073ffed638993778dd7c00','PARENT_PUBLICATION');const parent=JSON.parse(parentRaw);
const inputs=new Map();for(const item of parent.files)inputs.set(item.path,bounded(root+'/'+item.path,item));
const oldRuntime=inputs.get('materialized/PRESEAL.json');ensure(hash(oldRuntime)==='d002ec622f7668b0766216acd60d19330723d4552205f3049202898eccdbca2f','PARENT_PRESEAL');
const oldSeal=JSON.parse(oldRuntime);for(const item of oldSeal.files)bounded(root+'/materialized/'+item.path,item);
const oldControlRaw=inputs.get('preflight-v1/CONTROL-PRESEAL.json');ensure(hash(oldControlRaw)==='89bea43a9445b940dae42147cf798a79196745f1bdcc4c5b22cbcaef4c83c06f','PARENT_CONTROLS');const oldControls=JSON.parse(oldControlRaw);
for(const item of oldControls.files)bounded(root+'/'+item.path,item);
const tools=JSON.parse(inputs.get('materialized/TOOLS.json')),observedTools=[];
for(const item of [...tools.toolPins,tools.environmentLauncher,tools.wrapperTool]){
 const fd=fs.openSync(item.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const before=fs.fstatSync(fd);ensure(before.isFile()&&before.size===item.bytes&&(before.mode&511)===item.mode,'TOOL_METADATA');const digest=crypto.createHash('sha256'),buffer=Buffer.alloc(1048576);let count,total=0;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0){total+=count;ensure(total<=134217728,'TOOL_SIZE');digest.update(buffer.subarray(0,count));}const after=fs.fstatSync(fd);ensure(total===item.bytes&&digest.digest('hex')===item.sha256&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'TOOL_IDENTITY');observedTools.push({path:item.path,bytes:item.bytes,mode:item.mode,sha256:item.sha256,observedAt:new Date().toISOString()});}finally{fs.closeSync(fd);}
}
ensure(process.execPath===tools.toolPins[0].path,'OWNER_TOOL');
const readSource=Function.prototype.toString.call(fs.readSync);ensure(Buffer.byteLength(readSource)<=16384&&readSource.includes('function readSync')&&readSource.includes('binding.read')&&readSource.includes('length === 0'),'READ_SOURCE_SHAPE');
write(own+'/node-fs-readSync-source.txt.data',readSource+'\n');
ensure(!fs.existsSync(destination),'UNUSED_OUTPUT');fs.mkdirSync(destination,{mode:0o700});fs.mkdirSync(destination+'/programs',{mode:0o700});
const before="operations.readSync(fd,Buffer.alloc(0),0,0,0);",after="operations.readSync(fd,Buffer.alloc(1),0,1,0);";
const members=[],deltas=[];
for(const item of oldSeal.files){let bytes=bounded(root+'/materialized/'+item.path,item);if(item.path==='admission.mjs'){const source=bytes.toString('utf8');ensure(source.split(before).length===2,'EXACT_READ_DELTA');bytes=Buffer.from(source.replace(before,after));deltas.push({path:item.path,before,after,parentSha256:item.sha256,sha256:hash(bytes)});}if(item.path.endsWith('.mjs'))new vm.SourceTextModule(bytes.toString('utf8'),{identifier:item.path});write(destination+'/'+item.path,bytes);members.push(pin(destination+'/'+item.path,item.path));}
const runtime={schema:'ere-capture-executable-preseal-v1',role:'PREEXECUTION_V2_NOT_GO',parentCommit:'0463adbcee3601b2cdf43f44bf428eddc0cab2f1',parentPresealSha256:hash(oldRuntime),files:members};
const runtimeBytes=Buffer.from(JSON.stringify(runtime,null,2)+'\n');write(destination+'/PRESEAL.json',runtimeBytes);
const oldTemplatePin=oldControls.files.find(item=>item.path==='APPROVAL-PROPOSAL.template.json'),oldTemplate=bounded(root+'/APPROVAL-PROPOSAL.template.json',oldTemplatePin),template=JSON.parse(oldTemplate);
const oldPrefix=root+'/materialized/',newPrefix=destination+'/';ensure(template.parameters.cmd.split(oldPrefix).length===3,'TEMPLATE_TWO_PATHS');template.parameters.cmd=template.parameters.cmd.split(oldPrefix).join(newPrefix);write(own+'/APPROVAL-PROPOSAL.template.json',JSON.stringify(template,null,2)+'\n');
let controls=inputs.get('preflight-v1/controls.mjs').toString('utf8');const originalControls=controls;
const changes=[
 ["own=root+'/preflight-v1',materialized=root+'/materialized'","own=root+'/preflight-v2',materialized=root+'/preflight-v2/materialized'"],
 ["item.path==='materialized/PRESEAL.json'","item.path==='preflight-v2/materialized/PRESEAL.json'"],
 ["root+'/APPROVAL-PROPOSAL.template.json'","own+'/APPROVAL-PROPOSAL.template.json'"],
 ["item.path==='APPROVAL-PROPOSAL.template.json'","item.path==='preflight-v2/APPROVAL-PROPOSAL.template.json'"],
];
for(const [from,to] of changes){ensure(controls.split(from).length===2,'CONTROL_DELTA');controls=controls.replace(from,to);}
ensure(controls.split('../materialized/').length===6,'FIVE_IMPORTS');controls=controls.split('../materialized/').join('./materialized/');
const start=controls.indexOf("await control('C07',()=>{"),end=controls.indexOf("await control('C08',()=>{",start);ensure(start>=0&&end>start,'C07_BLOCK');const fragment=bounded(own+'/C07.mjs.fragment.data').toString('utf8');controls=controls.slice(0,start)+fragment+controls.slice(end);
new vm.SourceTextModule(controls,{identifier:'controls-v2.mjs'});write(own+'/controls.mjs',controls);
write(own+'/SOURCE-DELTA.json',JSON.stringify({parentCommit:'0463adbcee3601b2cdf43f44bf428eddc0cab2f1',deltas,controls:{parentSha256:hash(Buffer.from(originalControls)),sha256:hash(Buffer.from(controls)),changes,importRewrite:{before:'../materialized/',after:'./materialized/',count:5},replacedControl:'C07',fragmentSha256:hash(Buffer.from(fragment))},template:{parentSha256:hash(oldTemplate),sha256:hash(bounded(own+'/APPROVAL-PROPOSAL.template.json')),onlyChange:'two owned materialized pathname prefixes in cmd',oldPrefix,newPrefix},programsUnchanged:12,otherControlIDsUnchanged:11},null,2)+'\n');
const files=[pin(destination+'/PRESEAL.json','preflight-v2/materialized/PRESEAL.json'),...members.map(item=>({...item,path:'preflight-v2/materialized/'+item.path}))];
for(const name of ['prepare.mjs','controls.mjs','C07.mjs.fragment.data','APPROVAL-PROPOSAL.template.json','SOURCE-DELTA.json','node-fs-readSync-source.txt.data'])files.push(pin(own+'/'+name,'preflight-v2/'+name));
const controlSeal={schema:'ere-preexec-control-preseal-v2',role:'DATA_ONLY_NO_NATIVE_AUTHORITY',createdAt:new Date().toISOString(),grantStart,deadline,started,files,cases:Array.from({length:12},(_,index)=>'C'+String(index+1).padStart(2,'0')),fixtureChildren:0,targetChildren:0,controlProcessMs:120000,rootPreparationCaps:{totalMs:720000,knownStarts:32,peak:2,capture:33554432,work:134217728},tools:observedTools,readSourceRole:'actual pinned Node public fs.readSync implementation; not decoded executable bytes; native binding internals not inspected',C07:{fileContents:['','ABCDE'],openRoles:['readwrite','readonly','writeonly'],position:0,length:1,cursorCheck:'initial sequential A, admission positional read, next sequential B',preAdmissionNegatives:['wrong inode','wrong mode','nonregular','wrong path','refused descriptor'],oldUnrun:['unchanged file bytes','valid provision','missing provision parent'],newTopLevelCases:0},nativeStatus:'12_UNRUN'};
const bytes=Buffer.from(JSON.stringify(controlSeal,null,2)+'\n');write(own+'/CONTROL-PRESEAL.json',bytes);write(own+'/CONTROL-PRESEAL.sha256',hash(bytes)+'\n');
console.log(JSON.stringify({at:new Date().toISOString(),runtimePresealSha256:hash(runtimeBytes),controlPresealSha256:hash(bytes),sourceDelta:deltas,programsUnchanged:12,modulesParsed:9,controls:12,fixtureChildren:0,deadline}));
