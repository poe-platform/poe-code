import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {runHost,runVisibleCases} from './host-protocols.mjs';
const role=JSON.parse(fs.readFileSync(process.env.SURFACE_ROLE,'utf8'));
const api=await import(role.layout==='source-built'?pathToFileURL(role.productRoot+'/dist/index.js').href:'virtual-bash');
const disposals=[];
class ObservedShell extends api.Shell {
  dispose(){const row={entered:true,settled:false,rejected:false};disposals.push(row);const exact=super.dispose();void exact.then(()=>{row.settled=true;},()=>{row.settled=true;row.rejected=true;});return exact;}
}
const observed={...api,Shell:ObservedShell};let pass=false,reason;
try {if(role.case.id.startsWith('H'))await runHost(role.case.id,observed);else await runVisibleCases(observed,[role.case]);pass=true;}
catch(error){reason=error===undefined?{kind:'undefined'}:error===null?{kind:'null'}:typeof error==='object'?{kind:'object',name:error.name,message:String(error.message??'').slice(0,2048),assertion:error instanceof assert.AssertionError}:{kind:typeof error,value:error};}
const cleanupQualified=disposals.length>0&&disposals.every(row=>row.settled&&!row.rejected);
process.stdout.write(JSON.stringify({schema:'pipestatus-case-v1',id:role.case.id,layout:role.layout,pass,reason,disposals,cleanupQualified,observer:'exact dispose Promise forwarding subclass'})+'\n');
process.exitCode=pass&&cleanupQualified?0:1;
