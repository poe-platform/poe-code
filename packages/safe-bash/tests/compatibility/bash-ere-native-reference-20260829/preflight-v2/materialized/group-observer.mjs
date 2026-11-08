import {kill as trustedKill} from 'node:process';
import {classifyGroup,errorFields} from './observer-state.mjs';
export const binding=Object.freeze({module:'node:process',export:'kill',ambientProcessUsed:false});
export function observeOwnedGroup(pid){if(!Number.isSafeInteger(pid)||pid<=1)return {state:'unknown',error:{kind:'INVALID_OWNED_PID'}};try{trustedKill(-pid,0);return classifyGroup(false);}catch(reason){return classifyGroup(true,reason);}}
export function signalOwnedGroup(pid,signal){if(!Number.isSafeInteger(pid)||pid<=1||!['SIGTERM','SIGKILL'].includes(signal))return {sent:false,error:{kind:'SIGNAL_ARGUMENT_REFUSED'}};try{trustedKill(-pid,signal);return {sent:true,error:null};}catch(reason){return {sent:false,error:errorFields(reason)};}}
