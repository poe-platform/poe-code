import {errorRecord} from './auth.mjs';
export function preauthRecord(primaryPresent,primary,secondary=[]){return {status:'PREAUTH_STOP',primaryPresent,primary:primaryPresent?errorRecord(primary):undefined,secondaryPresent:secondary.length>0,secondary:secondary.map(row=>({phase:row.phase,present:true,reason:errorRecord(row.reason)}))};}
