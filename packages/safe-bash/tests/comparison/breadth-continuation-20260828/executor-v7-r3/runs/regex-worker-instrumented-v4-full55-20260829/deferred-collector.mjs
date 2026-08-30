import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { types } from 'node:util';

const insist = (value, code) => { if (!value) throw Object.assign(new Error(code), {code}); };
const hash = value => createHash('sha256').update(value).digest('hex');
const shape = (value, keys) => {
  insist(value && typeof value === 'object' && !Array.isArray(value) && !types.isProxy(value), 'COLLECTOR_SCHEMA');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  insist(Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => Object.hasOwn(descriptors,key) && Object.hasOwn(descriptors[key],'value')), 'COLLECTOR_OWN_DATA');
  return value;
};
export function validateBinding(binding, root, allowed) {
  shape(binding,['path','bytes','mode','dev','ino','sha256']);
  insist(typeof binding.path === 'string' && path.dirname(binding.path) === root && path.resolve(binding.path) === binding.path && allowed.includes(path.basename(binding.path)), 'COLLECTOR_PATH');
  insist(Number.isSafeInteger(binding.bytes) && binding.bytes >= 0 && binding.bytes <= 262144 && binding.mode === 0o600 && Number.isSafeInteger(binding.dev) && Number.isSafeInteger(binding.ino) && binding.ino > 0 && typeof binding.sha256 === 'string' && /^[a-f0-9]{64}$/.test(binding.sha256), 'COLLECTOR_BINDING');
  return binding;
}
export function collectDeferred(input) {
  const {root,allowed,bindings,lifecycle}=shape(input,['root','allowed','bindings','lifecycle']);
  shape(lifecycle,['childClosed','signal','workersKnownRetired']);
  insist(lifecycle.childClosed === true && lifecycle.signal === null && lifecycle.workersKnownRetired === true, 'COLLECTOR_LIFECYCLE');
  insist(typeof root === 'string' && path.resolve(root) === root && Array.isArray(allowed) && allowed.length <= 20 && new Set(allowed).size === allowed.length && allowed.every(name => typeof name === 'string' && path.basename(name) === name), 'COLLECTOR_AUTHORITY');
  insist(Array.isArray(bindings) && bindings.length <= 20 && new Set(bindings.map(row=>row.path)).size === bindings.length, 'COLLECTOR_INVENTORY');
  for (const binding of bindings) validateBinding(binding,root,allowed);
  const rootInfo = fs.lstatSync(root);
  insist(rootInfo.isDirectory() && !rootInfo.isSymbolicLink() && fs.realpathSync(root) === root, 'COLLECTOR_ROOT');
  const actual = fs.readdirSync(root).filter(name=>allowed.includes(name)).sort();
  insist(JSON.stringify(actual) === JSON.stringify(bindings.map(row=>path.basename(row.path)).sort()), 'COLLECTOR_COMPLETE_CENSUS');
  const rows = [];
  let primary, present = false;
  const cleanup = [];
  for (const binding of bindings) {
    if (present) break;
    const row = {path:binding.path,enrolled:true,opened:false,authenticated:false,fsynced:false,closed:false};
    rows.push(row);
    let descriptor;
    try {
      const before = fs.lstatSync(binding.path);
      insist(before.isFile() && !before.isSymbolicLink() && fs.realpathSync(binding.path) === binding.path && before.dev === binding.dev && before.ino === binding.ino && before.size === binding.bytes && (before.mode & 0o7777) === binding.mode, 'COLLECTOR_PATH_IDENTITY');
      descriptor = fs.openSync(binding.path,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); row.opened = true;
      const current = fs.fstatSync(descriptor);
      insist(current.isFile() && current.dev === binding.dev && current.ino === binding.ino && current.size === binding.bytes && (current.mode & 0o7777) === binding.mode, 'COLLECTOR_DESCRIPTOR_IDENTITY');
      const data = Buffer.alloc(binding.bytes);
      let offset = 0;
      while (offset < data.length) { const amount=fs.readSync(descriptor,data,offset,data.length-offset,offset); insist(amount>0,'COLLECTOR_SHORT_READ');offset+=amount; }
      insist(hash(data) === binding.sha256, 'COLLECTOR_HASH'); row.authenticated = true;
      fs.fsyncSync(descriptor); row.fsynced = true;
      const after=fs.lstatSync(binding.path), descriptorAfter=fs.fstatSync(descriptor);
      insist(after.ino===binding.ino && after.dev===binding.dev && after.size===binding.bytes && !after.isSymbolicLink() && (after.mode & 0o7777)===binding.mode && descriptorAfter.size===binding.bytes && descriptorAfter.mtimeMs===current.mtimeMs && descriptorAfter.ctimeMs===current.ctimeMs, 'COLLECTOR_POST_IDENTITY');
    } catch (error) { present=true;primary=error; }
    finally {
      if (descriptor !== undefined) { try {fs.closeSync(descriptor);row.closed=true;} catch (error) {if(!present){present=true;primary=error;}else cleanup.push({code:error?.code ?? null,message:String(error).slice(0,512)});} }
      else row.closed=true;
    }
  }
  const receipt={schema:'PARENT_DEFERRED_DURABILITY_V1',qualified:!present && rows.length===bindings.length && rows.every(row=>row.authenticated&&row.fsynced&&row.closed),rows,primaryPresent:present,primary:present?{code:primary?.code ?? null,message:String(primary).slice(0,1024)}:null,cleanup,crashDurableBeforeAcquisition:false};
  if(present) { const failure=Object.assign(new Error('DEFERRED_DURABILITY_UNQUALIFIED'),{code:'DEFERRED_DURABILITY_UNQUALIFIED',receipt});throw failure; }
  return receipt;
}
