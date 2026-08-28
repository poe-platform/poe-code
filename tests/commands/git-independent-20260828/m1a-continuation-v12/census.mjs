import assert from 'node:assert/strict';
import { readdirSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const utf8 = value => {
  assert.equal(typeof value, 'string');
  const bytes = Buffer.from(value, 'utf8');
  assert.equal(bytes.toString('utf8'), value, 'nonrepresentable UTF8 string');
  assert.ok(!value.includes('\0'));
  return bytes;
};
const own = (value, keys) => {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort());
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); assert.ok(descriptor && 'value' in descriptor, 'own data only'); }
};
export function canonicalBytes(rows) {
  assert.ok(Array.isArray(rows));
  assert.equal(Reflect.ownKeys(rows).length, rows.length + 1, 'no holes/extras');
  const entries = [], seen = new Set();
  for (let index = 0; index < rows.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(rows, String(index)); assert.ok(descriptor && 'value' in descriptor, 'no holes/accessors');
    const row = descriptor.value;
    const typeDescriptor = Object.getOwnPropertyDescriptor(row, 'type'); assert.ok(typeDescriptor && 'value' in typeDescriptor);
    const type = typeDescriptor.value;
    const keys = type === 'file' ? ['path','type','mode','bytes','sha256'] : type === 'directory' ? ['path','type','mode'] : ['path','type','mode','link','realpath'];
    assert.ok(['file','directory','link'].includes(type)); own(row, keys);
    const bytes = utf8(row.path), path = bytes.toString('hex'); assert.ok(!seen.has(path), 'duplicate pathname'); seen.add(path);
    assert.ok(Number.isInteger(row.mode) && row.mode >= 0 && row.mode <= 4095);
    let tuple = [path,type,row.mode];
    if (type === 'file') { assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0); assert.match(row.sha256,/^[0-9a-f]{64}$/); tuple.push(row.bytes,row.sha256); }
    if (type === 'link') tuple.push(utf8(row.link).toString('hex'),utf8(row.realpath).toString('hex'));
    entries.push({ bytes, tuple });
  }
  entries.sort((left,right)=>Buffer.compare(left.bytes,right.bytes));
  return Buffer.from('M1A-CENSUS-v12\0'+JSON.stringify(entries.map(row=>row.tuple))+'\n','utf8');
}
export function physicalCensus(root) {
  const rows=[];
  const walk = directory => {
    for(const raw of readdirSync(directory,{encoding:'buffer'})) {
      const name=raw.toString('utf8'); assert.ok(Buffer.from(name,'utf8').equals(raw),'invalid UTF8 filename');
      assert.ok(name!=='AGENTS.md','no instruction snapshot');
      const path=directory+'/'+name, info=lstatSync(path), mode=info.mode&4095;
      if(info.isSymbolicLink()) { const target=readlinkSync(path,{encoding:'buffer'}), resolved=realpathSync(path,{encoding:'buffer'}); assert.ok(Buffer.from(target.toString('utf8'),'utf8').equals(target)); assert.ok(Buffer.from(resolved.toString('utf8'),'utf8').equals(resolved)); rows.push({path,type:'link',mode,link:target.toString('utf8'),realpath:resolved.toString('utf8')}); }
      else if(info.isDirectory()) { rows.push({path,type:'directory',mode}); walk(path); }
      else { assert.ok(info.isFile(),'regular files only'); rows.push({path,type:'file',mode,bytes:info.size,sha256:digest(readFileSync(path))}); }
    }
  };
  walk(root); return rows;
}
export function expectedFromOld(rows,modes) {
  const seen=new Set();
  const enriched=rows.map(row=>{
    assert.ok(!seen.has(row.path));seen.add(row.path);assert.ok(Object.hasOwn(modes,row.path));
    if(row.directory) { own(row,['path','directory','bytes']);assert.equal(row.directory,true);assert.equal(row.bytes,0);return {path:row.path,type:'directory',mode:modes[row.path]}; }
    if(Object.hasOwn(row,'link')) { own(row,['path','link','realpath']);return {...row,type:'link',mode:modes[row.path]}; }
    own(row,['path','bytes','sha256']);return {...row,type:'file',mode:modes[row.path]};
  });
  assert.equal(seen.size,Object.keys(modes).length); return enriched;
}
