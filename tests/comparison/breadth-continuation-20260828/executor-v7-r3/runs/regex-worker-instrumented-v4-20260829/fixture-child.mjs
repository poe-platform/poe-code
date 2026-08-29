import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownedWriter } from './owned-writer.mjs';
import { publishEarly, snapshot, missingRow } from './early-record.mjs';
import { installOffline } from '../../../executor-v3/offline.mjs';
import { reason } from './common.mjs';

const directory=process.argv[2], kind=process.argv[3];
if(!['FALSE_PRIMARY','UNDEFINED_PRIMARY'].includes(kind))throw Error('FIXTURE_ID');
process.stdout.write(JSON.stringify({event:'fixture-bootstrap',kind})+'\n');process.stderr.write('');
const filename=path.join(directory,'worker-1.jsonl');
const owner=ownedWriter({root:directory,entries:[{path:filename,kind:'create',mode:0o600,maximum:64}]});
const guard=installOffline({root:directory,files:[]},()=>{});
let primary, present=false;
try {owner.write(filename,Buffer.from('owned-witness\n'));throw kind==='FALSE_PRIMARY'?false:undefined;}
catch(error){present=true;primary=error;}
finally{owner.close();guard.close();}
const operation={primaryPresent:present,primary:reason(primary),receipt:{created:0,rows:[]},knownRetired:owner.receipt().closed};
const witness=snapshot(filename,64);
const early=publishEarly(directory,{schema:'EARLY_OPERATION_V1',id:kind,operationPresent:true,resultPresent:false,primaryPresent:present,primary:reason(primary),countsPresent:true,created:0,knownRetired:operation.knownRetired});
let failed=false;
try{if(missingRow(operation.receipt))throw Object.assign(new Error('CONTROL_PREREQUISITE_ROW_ABSENT'),{code:'CONTROL_PREREQUISITE_ROW_ABSENT'});operation.receipt.rows[0].exitCode=0;}
catch(error){failed=error.code==='CONTROL_PREREQUISITE_ROW_ABSENT';}
const record={schema:'SMALL_FIXTURE_RESULT_V1',id:kind,pass:false,ordinaryFailure:failed,primaryPresent:present,primary:reason(primary),early,witness,writer:owner.receipt(),offline:guard.receipt(),workersKnownRetired:true,workersCreated:0};
const resultPath=path.join(directory,'RESULT.json'), resultOwner=ownedWriter({root:directory,entries:[{path:resultPath,kind:'create',mode:0o600,maximum:65536}]});
try{resultOwner.write(resultPath,Buffer.from(JSON.stringify(record)+'\n'));}finally{resultOwner.close();}
process.stdout.write(JSON.stringify({event:'fixture-result',binding:snapshot(resultPath),ordinaryFailure:failed})+'\n');
process.exitCode=1;
