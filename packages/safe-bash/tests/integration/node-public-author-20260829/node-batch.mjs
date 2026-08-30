import fs from 'node:fs';
import {runFocused} from './focused-v5.mjs';
import {runWorkerCase} from './workers-v5.mjs';
import {runPublic} from './public-node.mjs';
const filename=process.argv[2];const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.size>16384)throw Error('batch input');
const input=JSON.parse(fs.readFileSync(filename,'utf8'));const rows=[],unhandled=[];
process.on('unhandledRejection',reason=>unhandled.push(String(reason)));
const publish=async row=>{rows.push(row);const text=JSON.stringify({...row,role:row.role??'node-module-case'})+'\n';if(Buffer.byteLength(text)>262144)throw Error('case capture bound');await new Promise((resolve,reject)=>process.stdout.write(text,error=>error?reject(error):resolve()));if(row.clean===false)throw Error('NODE_UNKNOWN_CLEANUP_STOP');};
let timer;let failed=false;
try{if(input.role==='focused'){timer=setTimeout(()=>process.exit(78),30000);await runFocused(input.moduleRoot,publish);clearTimeout(timer);}else for(const id of input.ids){timer=setTimeout(()=>process.exit(78),30000);if(input.role==='worker')await runWorkerCase(input,id,publish);else if(input.role==='public')await runPublic(input,id,publish);else throw Error('batch role');clearTimeout(timer);}}
catch(reason){failed=true;console.error(String(reason?.stack??reason));}
finally{clearTimeout(timer);}
await new Promise(resolve=>setImmediate(resolve));
const summary={role:'node-batch-summary',cases:rows.length,pass:rows.filter(row=>row.pass).length,fail:rows.filter(row=>!row.pass).length,clean:!failed&&rows.every(row=>row.clean!==false)&&unhandled.length===0,unhandled};
console.log(JSON.stringify(summary));process.exitCode=!summary.clean?78:summary.fail?1:0;
