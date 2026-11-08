import fs from 'node:fs';
import {finishOwner,wire} from './owner-finalization.mjs';
import {sample} from './package.mjs';
import {publish} from './auth.mjs';
export function finishBootstrap({root,stdout,stderr,exitReceipt,deadline,receipt}){
 if(!exitReceipt?.exit||!exitReceipt?.close||exitReceipt.error)throw Error('COLLECTOR_RETIREMENT_UNQUALIFIED');const captures=[];let primaryPresent=false,primary;
 try{for(const name of [stdout,stderr]){if(!name.startsWith(root+'/'))throw Error('COLLECTOR_CAPTURE_PATH');const stat=fs.lstatSync(name);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('COLLECTOR_CAPTURE_BOUND');const fd=fs.openSync(name,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);captures.push({path:name,fd});const opened=fs.fstatSync(fd);if(stat.ino!==opened.ino||stat.dev!==opened.dev)throw Error('COLLECTOR_CAPTURE_IDENTITY');}}catch(reason){primaryPresent=true;primary=reason;}
 return finishOwner({initial:{primaryPresent,primary},captures,census:()=>sample(root,201326592),publish(state,captureRows){publish(receipt,Buffer.from(JSON.stringify({finalization:wire(state),captureRows,exitReceipt,qualification:'regular-file completion after directly observed exit/close; not stream EOF or group census'})+'\n'),deadline);}});
}
