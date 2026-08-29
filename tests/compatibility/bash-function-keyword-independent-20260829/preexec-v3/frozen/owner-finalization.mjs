import fs from 'node:fs';
import {finalize} from './finalization.mjs';
import {hash,errorRecord} from './auth.mjs';
export function wire(state){return {primaryPresent:state.primaryPresent,primary:state.primaryPresent?errorRecord(state.primary):undefined,secondaryPresent:state.secondaryPresent,secondary:state.secondary.map(row=>({phase:row.phase,present:true,reason:errorRecord(row.reason)})),sampledWorkPresent:state.sampledWorkPresent,sampledWork:state.sampledWork,publicationAttempted:state.publicationAttempted,publicationSucceeded:state.publicationSucceeded};}
export function finishOwner({initial,captures,census,publish,operations=fs}){
 let primaryPresent=initial.primaryPresent,primary=initial.primary;const secondary=[...(initial.secondary??[])],captureRows=[];
 const action=(phase,callback)=>{const next=finalize({primaryPresent,primary,census:()=>undefined,publish:callback});primaryPresent=next.primaryPresent;primary=next.primary;secondary.push(...next.secondary.map(row=>({...row,phase})));};
 for(const capture of captures){const row={path:capture.path,flush:false,closed:false};captureRows.push(row);action('capture-flush',()=>{operations.fsyncSync(capture.fd);const stat=operations.fstatSync(capture.fd);if(!stat.isFile()||stat.size>65536)throw Error('OWNER_CAPTURE_BOUND');const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const count=operations.readSync(capture.fd,bytes,offset,bytes.length-offset,offset);if(!count)throw Error('OWNER_CAPTURE_SHORT');offset+=count;}row.bytes=bytes.length;row.sha256=hash(bytes);row.flush=true;});action('capture-close',()=>{operations.closeSync(capture.fd);row.closed=true;});}
 const end=finalize({primaryPresent,primary,census,publish(state){publish({...state,secondaryPresent:secondary.length>0||state.secondaryPresent,secondary:[...secondary,...state.secondary]},captureRows);}});
 return {...end,secondaryPresent:secondary.length>0||end.secondaryPresent,secondary:[...secondary,...end.secondary],captureRows};
}
