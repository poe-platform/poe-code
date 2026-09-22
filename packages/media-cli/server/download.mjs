import {createHash}from'node:crypto';
import {createWriteStream}from'node:fs';
import {readFile}from'node:fs/promises';
import {Readable,Transform}from'node:stream';
import {pipeline}from'node:stream/promises';
const lock=JSON.parse(await readFile('/app/container-lock.json','utf8'));
for(const artifact of lock.artifacts){
 const response=await fetch(artifact.url);if(!response.ok||!response.body)throw new Error('Pinned artifact unavailable');
 const digest=createHash('sha256');let bytes=0;
 const verify=new Transform({transform(chunk,_encoding,next){bytes+=chunk.length;if(bytes>artifact.bytes){next(new Error('Artifact length exceeded'));return;}digest.update(chunk);next(null,chunk);}});
 await pipeline(Readable.fromWeb(response.body),verify,createWriteStream(artifact.path,{flags:'wx'}));
 if(bytes!==artifact.bytes||digest.digest('hex')!==artifact.sha256)throw new Error('Pinned artifact digest/length mismatch');
}
