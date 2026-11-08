import fs from 'node:fs';
import {marker} from './loaded.mjs';
const role=JSON.parse(fs.readFileSync(process.env.SURFACE_ROLE));
if(marker!=='BOUND_HARMLESS_MODULE')throw Error('MODULE_VALUE');
const refusals=[];
for(const [name,expected] of [['./wrong.mjs','AUTH_HASH'],['./unlisted.mjs','EDGE_REFUSED']]){
  let rejected=false;try{await import(name);}catch(reason){if(reason.message!==expected)throw reason;rejected=true;refusals.push(expected);}if(!rejected)throw Error('LOAD_NOT_REFUSED');
}
process.stdout.write(JSON.stringify({id:'H03',refusals,extraOwnedChildren:0,extraWorkers:0,publicSettlement:{execObserved:true,disposeSettled:true,disposeRejected:false},profile:role.profile})+'\n');
