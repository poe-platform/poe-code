import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function admit(filename,pin,maximum=16777216){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==pin.bytes||stat.size>maximum)throw Error('BUILD_PIN_TYPE_SIZE');const bytes=fs.readFileSync(filename);if(bytes.length!==pin.bytes||digest(bytes)!==pin.sha256)throw Error('BUILD_PIN_HASH');return bytes;}
const sealPath=process.argv[2],sealBytes=Number(process.argv[3]),sealHash=process.argv[4];
if(typeof sealPath!=='string'||!Number.isSafeInteger(sealBytes)||sealBytes<=0||!/^[a-f0-9]{64}$/.test(sealHash??''))throw Error('BUILD_ARGUMENTS');
const seal=JSON.parse(admit(sealPath,{bytes:sealBytes,sha256:sealHash},262144));
const started=Date.now();if(started>=seal.deadline-60000)throw Error('BUILD_WINDOW');
for(const [name,pin]of Object.entries(seal.helpers))admit(path.join(seal.helpersRoot,name),pin);
const {readPinned,pinExecutable,publish,errorRecord}=await import(pathToFileURL(path.join(seal.helpersRoot,'auth.mjs')));
const {write,inventory,sample}=await import(pathToFileURL(path.join(seal.helpersRoot,'package.mjs')));
const {runDirect}=await import(pathToFileURL(path.join(seal.helpersRoot,'direct-child.mjs')));
const {finalize}=await import(pathToFileURL(path.join(seal.helpersRoot,'finalization.mjs')));
const ledger={starts:1,maximum:2,active:0,stopped:false,captureBytes:0,captureMaximum:131072,rows:[]};
const result={schema:'k08-strict-build-result-v1',sourceCommit:seal.sourceCommit,started,inputs:[],ledger,productCalls:0,workerJobs:0,consumerChecks:0};let primaryPresent=false,primary;
try{
 if(fs.realpathSync(seal.root)!==seal.root||!seal.root.startsWith('/private/tmp/'))throw Error('BUILD_CANONICAL_ROOT');
 pinExecutable(seal.node);
 const paths=new Set();for(const row of seal.inputs){if(paths.has(row.path)||row.path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('BUILD_SOURCE_PATH');paths.add(row.path);const bytes=readPinned(row.origin,row);write(path.join(seal.app,row.path),bytes,420);result.inputs.push({path:row.path,bytes:bytes.length,sha256:digest(bytes)});}
 if(result.inputs.length!==306)throw Error('BUILD_SOURCE_CARDINALITY');
 const tools=JSON.parse(readPinned(seal.tools.path,seal.tools));for(const tool of tools.packages){for(const row of tool.rows){const source=path.join(tool.resolved,row.path),bytes=readPinned(source,row);if((fs.lstatSync(source).mode&4095)!==row.mode)throw Error('BUILD_TOOL_MODE');write(path.join(seal.root,'tools',tool.name,row.path),bytes,row.mode);if(tool.name!=='typescript')write(path.join(seal.app,'node_modules',tool.name,row.path),bytes,row.mode);}}
 for(const directory of ['home','tmp','empty-path'])fs.mkdirSync(path.join(seal.root,directory),{mode:448});
 result.inputManifestSha256=digest(Buffer.from(JSON.stringify(result.inputs)+'\n'));
 publish(path.join(seal.root,'SOURCE-BINDING.json'),Buffer.from(JSON.stringify(result.inputs,null,2)+'\n'),seal.deadline);
 result.before=sample(seal.root,536870912);
 const child=await runDirect({id:'strict-build',node:seal.node,args:seal.compilerArgs,cwd:seal.app,env:seal.env,capture:path.join(seal.root,'capture/strict-build'),timeoutMs:120000,bodyDeadline:seal.deadline-60000,finalDeadline:seal.deadline},ledger);
 result.compiler=child.row;
 if(!child.row.qualified){if(child.primary.present)throw child.primary.reason;throw Error('BUILD_LIFECYCLE');}
 if(child.row.status!==0)throw Error('BUILD_DIAGNOSTICS');
 result.dist=inventory(path.join(seal.app,'dist'));
}catch(reason){primaryPresent=true;primary=reason;}
const final=finalize({primaryPresent,primary,census:()=>sample(seal.root,536870912),publish(state){result.primaryPresent=state.primaryPresent;if(state.primaryPresent)result.primary=errorRecord(state.primary);result.secondary=state.secondary.map(row=>({phase:row.phase,present:row.present,reason:errorRecord(row.reason)}));result.sampledWorkPresent=state.sampledWorkPresent;result.sampledWork=state.sampledWork;result.finished=Date.now();result.status=state.primaryPresent?'STOP':'STRICT_BUILD_COMPLETED';publish(path.join(seal.root,'BUILD-RESULT.json'),Buffer.from(JSON.stringify(result,null,2)+'\n'),seal.deadline);}});
process.stdout.write(JSON.stringify({status:final.primaryPresent?'STOP':'STRICT_BUILD_COMPLETED',primaryPresent:final.primaryPresent,primary:final.primaryPresent?errorRecord(final.primary):undefined,publicationSucceeded:final.publicationSucceeded})+'\n');if(final.primaryPresent)process.exitCode=1;
