import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const home=path.dirname(fileURLToPath(import.meta.url));
const raw=JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(home+'/m04-RAW.json.gz.base64','utf8').trim(),'base64'),{maxOutputLength:1048576}));
assert.equal(raw.code,0);assert.equal(raw.closed,true);assert.equal(raw.signal,null);assert.equal(raw.stderr,'');
const bytes=Buffer.from(raw.stdout,'base64'),rows=[];
let offset=0;
for(let index=0;index<4;index++){
 const end=bytes.indexOf(10,offset),match=/^([a-f0-9]{40}) blob (\d+)$/u.exec(bytes.subarray(offset,end).toString());assert(match);
 const size=Number(match[2]);assert(size<=65536);const body=bytes.subarray(end+1,end+1+size);assert.equal(body.length,size);assert.equal(bytes[end+1+size],10);assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from('blob '+size+'\0'),body])).digest('hex'),match[1]);rows.push({oid:match[1],bytes:size,sha256:createHash('sha256').update(body).digest('hex'),body:body.toString('base64')});offset=end+2+size;
}
assert.equal(bytes.subarray(offset).toString(),'aed62f65:tests/integration/agent-bash-coherent-author-20260829/v3/PUBLIC-ENGINE-RECEIPT.json missing\n');
fs.writeFileSync(home+'/m04-RECOVERED.json.gz.base64',gzipSync(Buffer.from(JSON.stringify(rows))).toString('base64')+'\n',{flag:'wx'});
console.log(JSON.stringify({recovered:4,originalFailure:'incorrect v3 receipt locator; closed Git batch contained four complete blobs and exact missing-path line',targetExecution:0}));
