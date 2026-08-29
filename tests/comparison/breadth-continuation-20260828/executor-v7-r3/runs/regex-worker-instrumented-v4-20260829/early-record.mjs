import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ownedWriter } from './owned-writer.mjs';

const native = Object.fromEntries(['lstatSync','realpathSync','openSync','fstatSync','readSync','closeSync','existsSync'].map(name=>[name,fs[name].bind(fs)]));
const hash = value => createHash('sha256').update(value).digest('hex');
const insist = (value, code) => {if(!value)throw Object.assign(new Error(code),{code});};
export const witnessNames = Object.freeze([...Array.from({length:8},(_,index)=>['worker-'+(index+1)+'.json','worker-'+(index+1)+'.jsonl']).flat(),'bounded.jsonl']);
export function snapshot(filename, maximum=262144) {
  const info=native.lstatSync(filename);
  insist(info.isFile() && !info.isSymbolicLink() && native.realpathSync(filename)===filename && info.size<=maximum && (info.mode & 0o7777)===0o600,'EARLY_FILE_BINDING');
  const descriptor=native.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let data;
  try {
    const opened=native.fstatSync(descriptor);insist(opened.ino===info.ino&&opened.dev===info.dev&&opened.size===info.size,'EARLY_INODE');
    data=Buffer.alloc(info.size);let offset=0;
    while(offset<data.length){const amount=native.readSync(descriptor,data,offset,data.length-offset,offset);insist(amount>0,'EARLY_SHORT_READ');offset+=amount;}
  } finally {native.closeSync(descriptor);}
  return {path:filename,bytes:data.length,mode:0o600,dev:info.dev,ino:info.ino,sha256:hash(data)};
}
export function publishEarly(directory, record) {
  const filename=path.join(directory,'EARLY.json');
  const data=Buffer.from(JSON.stringify(record)+'\n');insist(data.length<=65536,'EARLY_RECORD_CAP');
  const owner=ownedWriter({root:directory,entries:[{path:filename,kind:'create',mode:0o600,maximum:65536}]});
  try {owner.write(filename,data);}finally{owner.close();}
  const binding=snapshot(filename,65536);
  process.stdout.write(JSON.stringify({event:'early-operation',binding})+'\n');
  return binding;
}
export function observeWitnesses(directory, operation) {
  const rows=[];
  const expectedPaths=new Set([...operation.receipt.writer.rows.filter(row=>row.opened).map(row=>row.path),...operation.journals.map(row=>row.path)]);
  for(const filename of expectedPaths)insist(path.dirname(filename)===directory && witnessNames.includes(path.basename(filename)) && native.existsSync(filename),'WITNESS_REQUIRED_MISSING');
  for(const name of witnessNames){
    const filename=path.join(directory,name);
    if(!native.existsSync(filename))continue;
    const binding=snapshot(filename,65536);
    if(name!=='bounded.jsonl'){
      const created=operation.receipt.writer.rows.find(row=>row.path===filename && row.binding);
      const journal=operation.journals.find(row=>row.path===filename);
      const expected=journal??created?.binding;
      insist(expected && expected.bytes===binding.bytes && expected.sha256===binding.sha256,'WITNESS_EXISTING_COMMITMENT');
      if(created?.binding)insist(created.binding.dev===binding.dev&&created.binding.ino===binding.ino,'WITNESS_CREATED_INODE');
    }
    rows.push(binding);
  }
  return rows;
}
export function missingRow(receipt, ordinal=0) {
  return !receipt || !Array.isArray(receipt.rows) || !receipt.rows[ordinal] || !Array.isArray(receipt.rows[ordinal].witnesses);
}
