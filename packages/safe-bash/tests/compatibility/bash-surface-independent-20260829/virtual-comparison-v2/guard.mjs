import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {register,syncBuiltinESMExports} from 'node:module';
import threads from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
const filename=process.env.SURFACE_ROLE;const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2097152)throw Error('ROLE_TYPE_SIZE');const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const raw=Buffer.alloc(stat.size);try{let offset=0;while(offset<raw.length){const count=fs.readSync(fd,raw,offset,Math.min(65536,raw.length-offset),offset);if(!count)throw Error('ROLE_SHORT');offset+=count;}if(fs.readSync(fd,Buffer.alloc(1),0,1,offset))throw Error('ROLE_LONG');}finally{fs.closeSync(fd);}if(createHash('sha256').update(raw).digest('hex')!==process.env.SURFACE_ROLE_SHA256)throw Error('ROLE_HASH');const policy=JSON.parse(raw);if(policy.regexWorkerPermission!==0)throw Error('WORKER_AUTHORITY');
function trace(event){const bytes=Buffer.from(JSON.stringify({event,role:policy.id})+'\n');if(fs.statSync(policy.mainTrace).size+bytes.length>65536)throw Error('MAIN_TRACE_LIMIT');fs.appendFileSync(policy.mainTrace,bytes);}
threads.Worker=class RefusedWorker{constructor(){trace('regex-worker-refused-before-acquisition');throw Error('REGEX_WORKER_REFUSED');}};syncBuiltinESMExports();trace('worker-refusal-installed');
register(pathToFileURL(policy.loader),{data:policy});trace('loader-registration-requested');
