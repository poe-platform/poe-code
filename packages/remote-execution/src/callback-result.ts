import type {CallbackResult, FileOperation} from './wire.generated.js';
import {validateWire} from './wire-validation.js';

/** Shape validation alone cannot authorize a receipt for another operation.
 * Transfer/END settlement is checked by the channel owner independently. */
export function validateCallbackResult(operation:FileOperation,result:CallbackResult):void {
 validateWire('FileOperation',operation);validateWire('CallbackResult',result);
 if(result.state==='applied'&&result.error!==undefined || result.state!=='applied'&&(!result.error||!result.error.code))throw new TypeError('Callback state contradicts its failure receipt');
 if(result.state==='unknown'&&(result.error?.phase!=='unknown'||!result.error.recovery))throw new TypeError('Unknown callback result requires recovery information');
 const fields:Partial<Record<FileOperation['op'],readonly (keyof CallbackResult)[]>>={
  open:['handleId','identityId'],stat:['stat','identityId'],lstat:['stat','identityId'],
  read:['acknowledgedBytes'],write:['acknowledgedBytes'],seek:['position'],
  readlink:['target'],readdir:['entries'],
 };
 const allowed=fields[operation.op]??[];
 const common=['type','callbackId','operationId','state','error'];
 if(Object.keys(result).some(key=>!common.includes(key)&&!allowed.includes(key as keyof CallbackResult)))throw new TypeError('Callback result contradicts its operation');
 if(result.state==='applied'&&allowed.length&&!Object.hasOwn(result,allowed[0]))throw new TypeError('Callback result is missing its operation receipt');
 if((operation.op==='read'||operation.op==='write')&&result.acknowledgedBytes!==undefined&&BigInt(result.acknowledgedBytes)>BigInt(operation.length))throw new TypeError('Callback progress exceeds its operation');
 if(operation.op==='readdir'&&result.entries!==undefined&&result.entries.length>operation.maxEntries)throw new TypeError('Callback listing exceeds its operation');
}
