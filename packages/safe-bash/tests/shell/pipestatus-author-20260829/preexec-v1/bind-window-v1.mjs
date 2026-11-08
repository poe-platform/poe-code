import fs from 'node:fs';
import {createHash} from 'node:crypto';
const own='/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/preexec-v1';
const latest=1788022500000,expiry=1788024300000,prepDeadline=1788021351499;
function pin(filename,expected){
  const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>134217728)throw Error('REGULAR_BOUND');
  if(expected&&(stat.size!==expected.bytes||(expected.mode!==undefined&&(stat.mode&4095)!==expected.mode)))throw Error('PIN_METADATA');
  const descriptor=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),digest=createHash('sha256'),buffer=Buffer.alloc(65536);let count=0;
  try{const opened=fs.fstatSync(descriptor);if(opened.dev!==stat.dev||opened.ino!==stat.ino)throw Error('PIN_IDENTITY');for(;;){const size=fs.readSync(descriptor,buffer,0,buffer.length,null);if(!size)break;count+=size;if(count>stat.size)throw Error('PIN_GROWTH');digest.update(buffer.subarray(0,size));}}finally{fs.closeSync(descriptor);}
  const value={path:filename,bytes:count,mode:stat.mode&4095,sha256:digest.digest('hex')};if(count!==stat.size||expected&&value.sha256!==expected.sha256)throw Error('PIN_HASH');return value;
}
function json(filename,expected){pin(filename,expected);if(expected.bytes>1048576)throw Error('METADATA_BOUND');const bytes=fs.readFileSync(filename);if(bytes.length!==expected.bytes||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw Error('SAME_READ_HASH');return JSON.parse(bytes);}
const now=Date.now();if(now>latest-900000||now>=prepDeadline||expiry-latest!==1800000||expiry>Date.parse('2026-08-29T17:45:00Z'))throw Error('WINDOW');
const sealPin={bytes:795793,sha256:'f61b8fb41db61be3ed89fba296f5cbb9a6e8b4c80dd019202b065fe4f5a093d5'};
const seal=json(own+'/SEAL-v2.json',sealPin);if(seal.sources.length!==307||seal.sourceProjection!=='74fec4d4e26d9c0b2d27613c15af7a88cb56f628'||seal.limits.totalKnownStarts!==93||seal.limits.peak!==3)throw Error('COMPOSITION');
const checks=[];for(const row of seal.files)checks.push(pin(row.path,row));checks.push(pin(seal.bootstrap.path,seal.bootstrap));checks.push(pin(seal.archive.path,seal.archive));checks.push(pin(seal.node.path,seal.node));
const manifest=json(seal.packageManifest.path,seal.packageManifest);if(manifest.count!==1010||manifest.sha256!=='6c60e2d766fa675b7972afdc0eb6f5304f99231abceff1daf5cb196b897346a5')throw Error('PACKAGE');
checks.push(pin('/bin/zsh'));checks.push(pin('/usr/bin/shasum'));
const slots=[seal.actualRoot,seal.actualRoot+'-outer',seal.actualRoot+'.startup.stdout',seal.actualRoot+'.startup.stderr',seal.actualRoot+'.node.sha256'];
for(const slot of slots){try{fs.lstatSync(slot);throw Error('USED_SLOT '+slot);}catch(error){if(error.code!=='ENOENT')throw error;}}
const template=json(own+'/GRANT-v2.template.json',pin(own+'/GRANT-v2.template.json'));
if(Object.keys(template).join(',')!=='action,sealSha256,rootReceipt,started,deadline')throw Error('GRANT_SCHEMA');
const grant={...template,started:latest,deadline:expiry};
function write(name,text){if(Date.now()>=prepDeadline)throw Error('PREP_DEADLINE');fs.writeFileSync(own+'/'+name,text,{flag:'wx',mode:0o644});return pin(own+'/'+name);}
const grantPin=write('GRANT-window-v1.template.json',JSON.stringify(grant,null,2)+'\n');
const command="PIPE_BOOTSTRAP_SHA='"+seal.bootstrap.sha256+"'\nPIPE_SEAL='"+own+"/SEAL-v2.json'\nPIPE_SEAL_BYTES='795793'\nPIPE_SEAL_SHA256='"+sealPin.sha256+"'\nPIPE_GRANT='REQUIRES_ROOT_AUTHORIZED_REGULAR_GRANT_PATH'\nPIPE_GRANT_BYTES='REQUIRES_EXACT_GRANTED_BYTE_SIZE'\nPIPE_GRANT_SHA256='REQUIRES_EXACT_GRANTED_SHA256'\nexport PIPE_BOOTSTRAP_SHA PIPE_SEAL PIPE_SEAL_BYTES PIPE_SEAL_SHA256 PIPE_GRANT PIPE_GRANT_BYTES PIPE_GRANT_SHA256\nexec /bin/zsh "+own+"/launch-v2.sh\n";
const commandPin=write('COMMAND-window-v1.txt',command);
checks.push(pin(own+'/WINDOW-QUALIFICATION-v1.md'),pin(own+'/bind-window-v1.mjs'),grantPin,commandPin);
write('BINDINGS-window-v1.json',JSON.stringify(checks,null,2)+'\n');
console.log(JSON.stringify({checkedAt:new Date(now).toISOString(),latestStart:new Date(latest).toISOString(),expiry:new Date(expiry).toISOString(),seal:pin(own+'/SEAL-v2.json',sealPin),command:commandPin,template:grantPin,unusedSlots:slots,packageMembers:manifest.count,sourceInputs:seal.sources.length,productExecutions:0,Workers:0,grantActive:false}));
