import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { collectDeferred } from './composition/executor-v7-r3/runs/v4/deferred-collector.mjs';
import { snapshot, publishEarly } from './composition/executor-v7-r3/runs/v4/early-record.mjs';
import { canonicalURL, options } from './composition/executor-v7-r3/runs/v4/common.mjs';
import { closure, candidate, packSha256, profileBinding } from './composition/executor-v7-r3/runs/v4/policy.mjs';
import { mutationExpected } from './composition/executor-v7-r3/runs/v4/mutation.mjs';
export async function runFaults(home) {
  const root = path.join(home, 'faults'); fs.mkdirSync(root, { mode: 0o700 });
  const output = fs.openSync(path.join(root, 'OBSERVATIONS.ndjson'), 'wx', 0o600);
  const native = Object.fromEntries(['openSync','closeSync','fstatSync','fsyncSync'].map(key => [key, fs[key]]));
  const rows = [];
  const record = row => { const bytes = Buffer.from(JSON.stringify(row) + '\n'); assert(bytes.length <= 65536); fs.writeSync(output, bytes); fs.fsyncSync(output); };
  try {
    for (let ordinal = 1; ordinal <= 10; ordinal++) {
      const directory = path.join(root, 'N' + String(ordinal).padStart(2, '0')); fs.mkdirSync(directory, { mode: 0o700 });
      const filename = path.join(directory, 'witness.data'); fs.writeFileSync(filename, 'original\n', { flag: 'wx', mode: 0o600 });
      const binding = snapshot(filename); const handles = new Set(); let opened = 0, closed = 0, flushed = 0, value, failure;
      const lifecycle = { childClosed: ordinal !== 2, signal: null, workersKnownRetired: true };
      if (ordinal === 3) fs.unlinkSync(filename);
      if (ordinal === 4) fs.writeFileSync(filename, 'changed!\n');
      if (ordinal === 5) { fs.unlinkSync(filename); fs.writeFileSync(path.join(directory, 'target.data'), 'original\n', { flag: 'wx', mode: 0o600 }); fs.symlinkSync('target.data', filename); }
      fs.openSync = (...args) => { const descriptor = native.openSync(...args); if (args[0] === filename) { handles.add(descriptor); opened++; } return descriptor; };
      fs.fstatSync = descriptor => { const result = native.fstatSync(descriptor); return ordinal === 6 && handles.has(descriptor) ? Object.assign(Object.create(Object.getPrototypeOf(result)), result, { ino: result.ino + 1 }) : result; };
      fs.fsyncSync = descriptor => {
        if (!handles.has(descriptor)) return native.fsyncSync(descriptor);
        flushed++;
        if (ordinal === 7) throw undefined;
        if (ordinal === 9) throw false;
        native.fsyncSync(descriptor);
        if (ordinal === 10) { const writer = native.openSync(filename, 'r+'); try { fs.writeSync(writer, Buffer.from('changed!\n'), 0, 9, 0); } finally { native.closeSync(writer); } const before = fs.statSync(filename); fs.utimesSync(filename, before.atime, new Date(before.mtimeMs + 2000)); }
      };
      fs.closeSync = descriptor => {
        if (!handles.has(descriptor)) return native.closeSync(descriptor);
        native.closeSync(descriptor); handles.delete(descriptor); closed++;
        if (ordinal === 8) throw false;
        if (ordinal === 9) throw undefined;
      };
      try { value = collectDeferred({ root: directory, allowed: ['witness.data'], bindings: [binding], lifecycle }); }
      catch (error) { failure = error; }
      finally { for (const key of Object.keys(native)) fs[key] = native[key]; }
      const leftover = [...handles];
      for (const descriptor of leftover) native.closeSync(descriptor);
      record({ id: 'N' + String(ordinal).padStart(2, '0'), value: value ?? null, error: failure ? { code: failure.code ?? null, receipt: failure.receipt ?? null } : null, opened, closed, flushed, leftoverHandles: leftover.length, physicalCloseBeforeInjectedFailure: [8,9].includes(ordinal) });
      if (leftover.length) throw Error('FAULT_HANDLE_CLEANUP_REQUIRED_STOP');
      try {
        if (ordinal === 1) { assert.equal(value.qualified, true); assert.equal(value.rows[0].closed, true); }
        else {
          assert(failure);
          if (ordinal === 2) { assert.equal(failure.code, 'COLLECTOR_LIFECYCLE'); assert.equal(opened, 0); }
          if (ordinal === 3) assert.equal(failure.code, 'COLLECTOR_COMPLETE_CENSUS');
          if ([4,5,6,10].includes(ordinal)) assert.equal(failure.receipt.primary.code, ({4:'COLLECTOR_HASH',5:'COLLECTOR_PATH_IDENTITY',6:'COLLECTOR_DESCRIPTOR_IDENTITY',10:'COLLECTOR_POST_IDENTITY'})[ordinal]);
          if ([7,8,9].includes(ordinal)) { assert.equal(failure.receipt.qualified, false); assert.equal(failure.receipt.primaryPresent, true); assert.equal(failure.receipt.primary.message, ordinal === 7 ? 'undefined' : 'false'); assert.equal(closed, 1); }
          if (ordinal === 9) assert.equal(failure.receipt.cleanup[0].message, 'undefined');
        }
        rows.push({ id: 'N' + String(ordinal).padStart(2, '0'), pass: true });
      } catch (error) { rows.push({ id: 'N' + String(ordinal).padStart(2, '0'), pass: false, message: error.message }); }
    }
    try {
      let getters = 0; const url = pathToFileURL(path.join(root, 'not-loaded.mjs'));
      canonicalURL(url, url.href); assert.throws(() => canonicalURL({ href: url.href }, url.href), error => error.code === 'URL_BRAND');
      options({ execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
      const bad = { resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } }; Object.defineProperty(bad, 'execArgv', { enumerable: true, get() { getters++; return []; } });
      assert.throws(() => options(bad), error => error.code === 'ACCESSOR'); assert.equal(getters, 0);
      const imports = [['node:worker_threads','./matching.js','../expr/bre-worker.js','./protocol.js'],[],['node:buffer'],['node:worker_threads','../regex-execution/protocol.js']];
      const members = Object.entries(closure).map(([relative,[sha256,bytes]], index) => ({ url: pathToFileURL(path.join(root,relative)).href, sha256, bytes, mode: 0o644, role:'product', imports: imports[index] }));
      const profile = {kind:'TARGET',candidate,packSha256,packageRoot:root,operationId:'case-10',priorAuthorityRequired:true};
      profileBinding(profile,members[0].url,members,'case-10',8);
      assert.throws(() => profileBinding(profile,members[0].url,members,'case-10',9));
      const changed = structuredClone(members); changed[0].imports.push('node:fs'); assert.throws(() => profileBinding(profile,members[0].url,changed,'case-10',8));
      record({id:'N11',getters,metadataOnly:true,productLoaded:false}); rows.push({id:'N11',pass:true});
    } catch (error) { rows.push({id:'N11',pass:false,message:error.message}); }
    try {
      for (const [name,present,created,primary] of [['unknown',false,null,{type:'undefined'}],['zero',true,0,{type:'boolean',value:false}]]) {
        const directory=path.join(root,name);fs.mkdirSync(directory,{mode:0o700});
        const data={schema:'EARLY_OPERATION_V1',id:name,operationPresent:true,resultPresent:false,primaryPresent:true,primary,countsPresent:present,created,knownRetired:true};
        const bound=publishEarly(directory,data);const info=fs.lstatSync(bound.path);assert(info.isFile()&&info.size===bound.bytes&&info.size<=65536);
        const raw=fs.readFileSync(bound.path);assert.equal(createHash('sha256').update(raw).digest('hex'),bound.sha256);assert.deepEqual(JSON.parse(raw),data);
      }
      for(const [state,count,expected]of [['NOT_ENTERED',0,'old'],['ENTERED',0,'old'],['TRUNCATED',0,''],['WRITING',2,'ne'],['WRITTEN',3,'new'],['COMMITTED',3,'new']])assert.equal(mutationExpected({state,bytesWritten:count,primaryPresent:false,primary:null},'old','new').toString(),expected);
      assert.throws(()=>mutationExpected({state:'COMMITTED',bytesWritten:3,primaryPresent:true,primary:'false'},'old','new'));
      record({id:'N12',unknownDistinctFromZero:true,mutationStages:6,invalidCommitRefused:true});rows.push({id:'N12',pass:true});
    } catch(error) {rows.push({id:'N12',pass:false,message:error.message});}
  } finally { for(const key of Object.keys(native))fs[key]=native[key];fs.fsyncSync(output);fs.closeSync(output); }
  return {rows,passed:rows.filter(row=>row.pass).length,total:rows.length,Workers:0,children:0};
}
