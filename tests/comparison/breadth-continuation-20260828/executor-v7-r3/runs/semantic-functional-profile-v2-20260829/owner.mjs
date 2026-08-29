import fs from 'node:fs/promises';
import path from 'node:path';
import { writeSync } from 'node:fs';
import { captureLaunch, LIMITS, reasonRecord, publishTerminal } from '../admission-20260829-v7r3-02-preparation/outer-adapter-v2/capture.mjs';
import { home, baseRoot, repository, runId, verifySuccessor, digest, requireThat } from './profile.mjs';
import { envelopeData } from '../../../executor-v7-r2/contracts.mjs';
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const authPath = path.join(home,'runs','activation','AUTH.json');
const [suppliedAuth, suppliedAuthSha, suppliedSealSha] = process.argv.slice(2);
const guard = async () => {
  requireThat(process.argv.length === 5 && suppliedAuth === authPath && typeof suppliedAuthSha === 'string' && /^[0-9a-f]{64}$/.test(suppliedAuthSha) && typeof suppliedSealSha === 'string' && /^[0-9a-f]{64}$/.test(suppliedSealSha),'OUTER_ARGUMENTS');
  requireThat(process.execPath === node && JSON.stringify(process.execArgv) === JSON.stringify(['--unhandled-rejections=strict','--max-old-space-size=256']) && process.umask() === 18,'OUTER_NODE_POLICY');
  requireThat(verifySuccessor() === suppliedSealSha,'OUTER_PROFILE_HASH');
  const info = await fs.lstat(authPath);requireThat(info.isFile() && !info.isSymbolicLink() && info.size<=65536 && (info.mode&4095)===420,'OUTER_AUTH_METADATA');
  const raw = await fs.readFile(authPath);requireThat(digest(raw)===suppliedAuthSha,'OUTER_AUTH_HASH');
  const auth = envelopeData(JSON.parse(raw));requireThat(auth && auth.grant.path===path.relative(repository,path.join(home,'runs','activation','ROOT-GRANT.json')),'OUTER_AUTH_SCHEMA');
};
const directory = path.join(home,'runs','outer-capture');
const started=Date.now();
const result=await captureLaunch({directory,runId,totalMs:4500000,termMs:2000,killMs:1000,command:{file:node,args:['--unhandled-rejections=strict','--max-old-space-size=256',path.join(home,'launch.mjs'),'cohort',runId,suppliedAuth,suppliedAuthSha],cwd:repository,env:{PATH:'',LANG:'C',LC_ALL:'C',TZ:'UTC',HOME:home,TMPDIR:home}}},{beforeLaunch:guard});
let postflight=false,postflightFailure=null;
try{if(result.qualified){await guard();requireThat(Date.now()-started<=4500000,'OUTER_TOTAL_DEADLINE');postflight=true;}}catch(error){postflightFailure=reasonRecord(error);}
const terminal={schema:'BREADTH_SEMANTIC_OWNER_V1',captureQualified:result.qualified&&postflight,semanticQualified:null,primaryPresent:result.primaryPresent,primary:result.receipt.primary,publicationPresent:result.publicationPresent,postflight,postflightFailure,child:result.receipt.child,streams:result.receipt.streams,profileSealSha256:suppliedSealSha??null,receipt:null,limits:LIMITS,qualification:'Capture/protocol completion only; inspect exact semantic counts, mismatches and unqualified rows independently'};
if(!result.publicationPresent){try{const bytes=await fs.readFile(path.join(directory,'RECEIPT.json'));requireThat(bytes.length<=LIMITS.receipt,'OUTER_RECEIPT_BOUND');terminal.receipt={path:path.join(directory,'RECEIPT.json'),bytes:bytes.length,sha256:digest(bytes)};}catch(error){terminal.captureQualified=false;terminal.receiptFailure=reasonRecord(error);}}
process.exitCode=terminal.captureQualified?0:1;
const publication=publishTerminal(terminal,(bytes,offset,length)=>writeSync(1,bytes,offset,length));if(!publication.ok)process.exitCode=1;

