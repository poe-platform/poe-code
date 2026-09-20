import {native} from './native.js';
import {admit,checked,selected} from './host.js';
export function transformHooks(source,from,to,opts){
 const result=checked(JSON.parse(native.hookTransform(admit(source.map(entry=>selected(entry))),from,to,opts.runId)));
 for(const entry of result.entries){if(entry.matcher===null)entry.matcher=undefined;if(typeof entry.handler.timeout==='string')entry.handler.timeout=Number(entry.handler.timeout==='inf'?'Infinity':entry.handler.timeout==='-inf'?'-Infinity':entry.handler.timeout);}
 result.drops=result.drops.map(({sourceIndex,...drop})=>({...drop,source:source[sourceIndex]}));return result;
}
