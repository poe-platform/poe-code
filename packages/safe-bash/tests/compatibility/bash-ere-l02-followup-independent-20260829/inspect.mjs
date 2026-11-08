import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
const owned = 'tests/compatibility/bash-ere-l02-followup-independent-20260829';
const files = new Map();
let requests = 0;
let totalBytes = 0;
for await (const line of readline.createInterface({ input: process.stdin })) {
  try {
    const request = JSON.parse(line); requests++;
    const filename = path.resolve(request.file);
    if (!filename.startsWith(process.cwd() + '/') || !/\.(mjs|js|ts|json|md|txt|data)$/.test(filename)) throw Error('PATH');
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.size > 4*1024*1024) throw Error('TYPE_SIZE');
    const bytes = fs.readFileSync(filename); totalBytes += bytes.length;
    if (totalBytes > 48*1024*1024) throw Error('READ_CAP');
    files.set(request.file, { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    let output;
    if (request.tree) output = bytes.toString().split('\0').filter(Boolean).map(record => record.slice(record.indexOf('\t')+1)).join('\n');
    else if (request.keys) { const data = JSON.parse(bytes); output = JSON.stringify(Object.fromEntries(request.keys.map(key => [key,key==='*'?Object.keys(data):data[key]])),null,2); }
    else output = bytes.toString().split('\n').slice((request.start??1)-1,request.end??80).map((value,index)=>`${(request.start??1)+index}: ${value}`).join('\n');
    if (Buffer.byteLength(output)>26000) throw Error('DISPLAY_CAP');
    console.log(output); console.log(JSON.stringify({ requests,totalBytes }));
  } catch(reason) { console.log(JSON.stringify({ error:String(reason),requests,totalBytes })); }
}
fs.writeFileSync(owned+'/admissions.json',JSON.stringify({ requests,totalBytes,files:Object.fromEntries(files) },null,2)+'\n');
