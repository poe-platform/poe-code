import fs from 'node:fs';
import {createHash} from 'node:crypto';
export function finalizeCaptures(handles,maximum=65536,operations=fs){
 const captures=[],errors=[];
 for(const handle of handles){const result={name:handle.name,flush:false,size:false,hash:false,close:false,bytes:null,sha256:null,base64:null};
  try{operations.fsyncSync(handle.fd);result.flush=true;}catch(error){errors.push({phase:'flush',name:handle.name,code:error.code??null,message:String(error.message).slice(0,128)});}
  try{const stat=operations.fstatSync(handle.fd);result.bytes=stat.size;if(!stat.isFile()||stat.ino!==handle.ino||stat.nlink!==1||stat.size>maximum)throw Error('CAPTURE_IDENTITY_OR_SIZE');result.size=true;const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){const amount=operations.readSync(handle.fd,bytes,offset,bytes.length-offset,offset);if(amount===0)throw Error('CAPTURE_SHORT_READ');offset+=amount;}const after=operations.fstatSync(handle.fd);if(after.size!==stat.size||after.ino!==stat.ino||after.mtimeMs!==stat.mtimeMs)throw Error('CAPTURE_CHANGED');result.sha256=createHash('sha256').update(bytes).digest('hex');result.base64=bytes.toString('base64');result.hash=true;}catch(error){errors.push({phase:'size-hash',name:handle.name,code:error.code??null,message:String(error.message).slice(0,128)});}
  try{operations.closeSync(handle.fd);result.close=true;}catch(error){errors.push({phase:'close',name:handle.name,code:error.code??null,message:String(error.message).slice(0,128)});try{operations.closeSync(handle.fd);result.cleanupClose=true;}catch(secondary){result.cleanupClose=false;errors.push({phase:'close-cleanup',name:handle.name,code:secondary.code??null,message:String(secondary.message).slice(0,128)});}}
  captures.push(result);
 }
 return {captures,errors,success:errors.length===0&&captures.every(row=>row.flush&&row.size&&row.hash&&row.close)};
}
