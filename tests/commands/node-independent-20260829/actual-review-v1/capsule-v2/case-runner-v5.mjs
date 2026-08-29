import {readFileSync,lstatSync} from 'node:fs';
import {runFocused} from './focused-v5.mjs';
import {runIndependent} from './independent.mjs';
import {runWorkerCase} from './workers-v5.mjs';
const inputPath=process.argv[2];const stat=lstatSync(inputPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw new Error('case input admission');
const input=JSON.parse(readFileSync(inputPath,'utf8'));let final;
const publish=async result=>{const text=JSON.stringify({role:'case-receipt-v1',...result})+'\n';if(Buffer.byteLength(text)>65536)throw new Error('receipt bytes');await new Promise((resolve,reject)=>process.stdout.write(text,error=>error?reject(error):resolve()));};
if(input.role==='focused'){const results=await runFocused(input.moduleRoot,publish);final={role:'focused-summary',pass:results.every(row=>row.pass),count:results.length};}
else if(input.role==='worker'){const result=await runWorkerCase(input,input.id,publish);final={role:'worker-summary',pass:result.pass,clean:result.clean,count:1};}
else if(input.role==='independent'){const rows=await runIndependent(input,publish);final={role:'independent-summary',pass:rows.every(row=>row.pass),clean:rows.every(row=>row.clean),count:rows.length};}
else throw new Error('case role');
await publish(final);process.exitCode=final.pass?0:1;
