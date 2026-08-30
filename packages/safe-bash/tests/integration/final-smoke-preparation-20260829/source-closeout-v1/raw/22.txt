import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {admitFile} from '../producer-binding-r3/admission.mjs';
export function validateLink(row,root){
  assert(row&&typeof row==='object'&&!Array.isArray(row));
  const keys=['path','kind','mode','text','target','targetSha256','targetSize'];
  assert.deepEqual(Reflect.ownKeys(row).sort(),keys.sort());
  for(const key of keys)assert(Object.hasOwn(Object.getOwnPropertyDescriptor(row,key),'value'));
  assert.equal(row.kind,'link');assert(Number.isSafeInteger(row.mode)&&row.mode>=0&&row.mode<=511);
  for(const key of ['path','target'])assert(typeof row[key]==='string'&&row[key].length>0&&!path.isAbsolute(row[key])&&!row[key].split('/').includes('..')&&!row[key].includes('\0'));
  assert(typeof row.text==='string'&&!row.text.includes('\0'));assert(Number.isSafeInteger(row.targetSize)&&row.targetSize>=0&&row.targetSize<=16777216);assert.match(row.targetSha256,/^[0-9a-f]{64}$/);
  const filename=path.resolve(root,row.path),target=path.resolve(root,row.target);
  assert(filename.startsWith(root+'/')&&target.startsWith(root+'/'));assert.equal(path.resolve(path.dirname(filename),row.text),target);
  return {filename,target};
}
export function admitLink(row,root){const {filename,target}=validateLink(row,root);const stat=fs.lstatSync(filename);assert(stat.isSymbolicLink());assert.equal(stat.mode&0o777,row.mode);assert.equal(fs.readlinkSync(filename),row.text);assert.equal(fs.realpathSync(filename),target);admitFile({path:target,bytes:row.targetSize,sha256:row.targetSha256},16777216);}
export function administrativeTime(epoch=Date.now()){assert(Number.isSafeInteger(epoch)&&epoch>=0);return {epochMs:epoch,utc:new Date(epoch).toISOString()};}
