import {Worker} from 'node:worker_threads';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=process.argv[2];if(root!=='/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-diagnosis-v1')throw Error('owned output root');
const descriptor=Object.getOwnPropertyDescriptor(Worker.prototype,'terminate');if(!descriptor||typeof descriptor.value!=='function'||descriptor.get||descriptor.set)throw Error('terminate own-data method');
const source=Function.prototype.toString.call(descriptor.value);const bytes=Buffer.byteLength(source,'utf8');if(bytes>8192)throw Error('method source cap');
const receipt={schema:1,role:'SOURCE_METADATA_ONLY_PUBLIC_PROTOTYPE_METHOD',toolSha256:'5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011',method:'Worker.prototype.terminate',bytes,sha256:createHash('sha256').update(source).digest('hex'),source,methodInvoked:false,WorkerConstructed:false,privateBindingUsed:false,productImported:false,qualification:'No Worker constructor, terminate method, native handles, or operating-system lifecycle operation is invoked. This bounded public method source is not a binary executable dump or OS proof.'};
writeFileSync(root+'/TERMINATE-SOURCE.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({bytes,sha256:receipt.sha256,WorkerConstructed:false}));
