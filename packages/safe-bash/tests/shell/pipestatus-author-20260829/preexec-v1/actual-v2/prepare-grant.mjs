import fs from 'node:fs';
import {createHash} from 'node:crypto';
const own='/Users/kjopek/Workspace/safe-bash/tests/shell/pipestatus-author-20260829/preexec-v1';
const target=own+'/actual-v2';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function read(filename,size,expected){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==size)throw Error('PREP_FILE_SIZE');const bytes=fs.readFileSync(filename);if(bytes.length!==size||hash(bytes)!==expected)throw Error('PREP_FILE_HASH');return bytes;}
function absent(filename){try{fs.lstatSync(filename);throw Error('PREP_USED_SLOT '+filename);}catch(error){if(error.code!=='ENOENT')throw error;}}
const capture=fs.lstatSync('/private/tmp/safe-bash-pipestatus-actual-v2-preparation.stdout');
if(!capture.isFile()||capture.isSymbolicLink())throw Error('OUTER_CAPTURE');
const now=Date.now(),started=Math.trunc(capture.birthtimeMs),deadline=started+1800000;
if(!Number.isSafeInteger(now)||!Number.isSafeInteger(started)||!Number.isSafeInteger(deadline)||started>now||now-started>120000||now>=Date.UTC(2026,7,29,16,55)||deadline>Date.UTC(2026,7,29,17,25))throw Error('PREP_WINDOW');
const template=read(own+'/COMMAND-window-v1.txt',689,'ecc2df67bf1cb05656014e3aa8f0c6c4c334545c7fea3faec1049cde3dc8e5d8').toString('utf8');
read(own+'/SEAL-v2.json',795793,'f61b8fb41db61be3ed89fba296f5cbb9a6e8b4c80dd019202b065fe4f5a093d5');
read(own+'/BOOTSTRAP-v2.sha256',2796,'c16da3ceff48df98fca0ae09acb84048c4b1e5bc17da05ab29759139398b4037');
const commitPath='/private/tmp/safe-bash-pipestatus-actual-v2-authorization-commit.stdout',commitStat=fs.lstatSync(commitPath);if(!commitStat.isFile()||commitStat.isSymbolicLink()||commitStat.size>32768)throw Error('COMMIT_CAPTURE');
const commitText=fs.readFileSync(commitPath,'utf8'),matches=[...commitText.matchAll(/^\[[^ \n]+ ([0-9a-f]{40})\]/gm)];if(matches.length!==1)throw Error('ROOT_RECEIPT');
const rootReceipt=matches[0][1];
const grantPath=target+'/grant.json';
const slots=['/private/tmp/safe-bash-pipestatus-actual-78-v1','/private/tmp/safe-bash-pipestatus-actual-78-v1-outer','/private/tmp/safe-bash-pipestatus-actual-78-v1.startup.stdout','/private/tmp/safe-bash-pipestatus-actual-78-v1.startup.stderr','/private/tmp/safe-bash-pipestatus-actual-78-v1.node.sha256',grantPath];
slots.forEach(absent);
const grant={action:'execute-pipestatus-78-v1',sealSha256:'f61b8fb41db61be3ed89fba296f5cbb9a6e8b4c80dd019202b065fe4f5a093d5',rootReceipt,started,deadline};
if(Object.keys(grant).join(',')!=='action,sealSha256,rootReceipt,started,deadline'||grant.deadline-grant.started!==1800000||!Number.isSafeInteger(grant.started)||!Number.isSafeInteger(grant.deadline))throw Error('GRANT_SCHEMA');
const bytes=Buffer.from(JSON.stringify(grant)+'\n');fs.writeFileSync(grantPath,bytes,{flag:'wx',mode:0o644});
if(!fs.readFileSync(grantPath).equals(bytes))throw Error('GRANT_READBACK');
const size=String(bytes.length),digest=hash(bytes);
const replacements=[['REQUIRES_ROOT_AUTHORIZED_REGULAR_GRANT_PATH',grantPath],['REQUIRES_EXACT_GRANTED_BYTE_SIZE',size],['REQUIRES_EXACT_GRANTED_SHA256',digest]];
let command=template;for(const [before,after] of replacements){if(command.split(before).length!==2)throw Error('TEMPLATE_CARDINALITY');command=command.replace(before,after);}
if(!command.endsWith('exec /bin/zsh '+own+'/launch-v2.sh\n'))throw Error('OUTER_EXEC');
fs.writeFileSync(target+'/COMMAND.txt',command,{flag:'wx',mode:0o644});
fs.writeFileSync('/private/tmp/safe-bash-pipestatus-actual-v2-grant-size.txt',size+'\n',{flag:'wx'});fs.writeFileSync('/private/tmp/safe-bash-pipestatus-actual-v2-grant-sha.txt',digest+'\n',{flag:'wx'});
slots.slice(0,5).forEach(absent);
if(Date.now()>=Date.UTC(2026,7,29,16,55)||Date.now()>=deadline-180000)throw Error('FINAL_WINDOW');
console.log(JSON.stringify({rootReceipt,started,deadline,startedISO:new Date(started).toISOString(),deadlineISO:new Date(deadline).toISOString(),grant:{path:grantPath,bytes:bytes.length,sha256:digest},command:{bytes:Buffer.byteLength(command),sha256:hash(Buffer.from(command))},timestampSchemaChecks:1,actualSlotsUnused:5,productExecutions:0,phaseStart:'new outer capture birthtime, integer milliseconds; Date.now validated',knownStartsThroughPreparation:6}));
