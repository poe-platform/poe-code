import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { resolve, relative } from 'node:path';
import { recipe, inventory, fileHash, sha, save, write } from './common.mjs';
export function archiveEvidence({run,raw,work,children,remove=false}) {
  assert.ok(run.startsWith(`${recipe}/runs/`)&&work.startsWith(`${recipe}/node_modules/`));
  assert.ok(children.every(row=>row.reaped),'ARCHIVE_BEFORE_REAP');
  const workInventory=inventory(work,{allowEmpty:true}), rawInventory=inventory(raw), rows=[];
  const retain=(root,row)=>{const bytes=fs.readFileSync(resolve(root,row.path));assert.equal(sha(bytes),row.sha256);rows.push({path:relative(recipe,resolve(root,row.path)),mode:row.mode,bytes:bytes.length,sha256:row.sha256,base64:bytes.toString('base64')});};
  for(const row of rawInventory)retain(raw,row);
  for(const row of workInventory)if(!/^(?:source|tools|dependencies|N\d\d|M\d\d)(?:\/|$)/u.test(row.path)&&!row.path.includes('/node_modules/virtual-bash/')&&!row.path.startsWith('npm-cache/'))retain(work,row);
  const plain=Buffer.from(JSON.stringify({schema:'timeout-public-compact-receipts/1',rows}));assert.ok(plain.length<=128*1024**2,'RECEIPT_ARCHIVE_LIMIT');const compressed=gzipSync(plain,{level:9});
  write(resolve(run,'RECEIPTS.json.gz'),compressed);const decoded=JSON.parse(gunzipSync(compressed,{maxOutputLength:128*1024**2}));assert.equal(decoded.rows.length,rows.length);
  for(const row of decoded.rows){const bytes=Buffer.from(row.base64,'base64');assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);}
  save(resolve(run,'CLOSURE.json'),{schema:'timeout-public-runtime-closure/1',work:workInventory,raw:rawInventory,archive:{path:'RECEIPTS.json.gz',sha256:fileHash(resolve(run,'RECEIPTS.json.gz')),bytes:compressed.length,retainedFiles:rows.length},omittedBytes:'Pinned Git materialization, authenticated installed pack, tools and declared mutants remain reconstructible from candidate/recipe bindings; inventories retained, not relabeled as full archives.',removed:false});
  if(remove){fs.rmSync(raw,{recursive:true});fs.rmSync(work,{recursive:true});save(resolve(run,'RESOURCE-CLEANUP.json'),{at:new Date().toISOString(),allChildrenReaped:true,archiveVerified:true,removed:[relative(recipe,raw),relative(recipe,work)],rawFiles:rawInventory.length,workFiles:workInventory.length});}
  return {archiveSha256:sha(compressed),retainedFiles:rows.length,workFiles:workInventory.length,rawFiles:rawInventory.length,removed:remove};
}
