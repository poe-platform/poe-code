import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ops = Object.fromEntries(['lstatSync','realpathSync','openSync','fstatSync','readSync','writeSync','ftruncateSync','fsyncSync','closeSync'].map(name => [name, fs[name].bind(fs)]));
const digest = value => createHash('sha256').update(value).digest('hex');
const insist = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
const describe = value => value === undefined ? {type:'undefined'} : value === null ? {type:'null'} : ['string','number','boolean'].includes(typeof value) ? {type:typeof value,value} : {type:'object',code:typeof value?.code === 'string' ? value.code : null,message:String(value?.message ?? value).slice(0,1024)};

export function ownedWriter({ root, entries, role = 'HARNESS_WITNESS', fault = 'none', onEvent = () => {} }) {
  insist(typeof root === 'string' && path.resolve(root) === root && entries.length > 0 && entries.length <= 32, 'WRITER_AUTHORITY');
  insist(['HARNESS_WITNESS','HARMLESS_FIXTURE'].includes(role) && (fault === 'none' || role === 'HARMLESS_FIXTURE'), 'WRITER_FAULT_ROLE');
  const allowed = new Map(entries.map(entry => [entry.path, entry]));
  insist(allowed.size === entries.length && entries.every(entry => typeof entry.path === 'string' && path.dirname(entry.path) === root && ['create','append','replace'].includes(entry.kind) && [0o600,0o644].includes(entry.mode) && Number.isInteger(entry.maximum) && entry.maximum >= 0 && entry.maximum <= 65536), 'WRITER_PATHS');
  const rows = [];
  let busy = false, retired = false, unknown = false;
  const inject = stage => {
    if (fault === stage || (fault === 'write-zero-close-after' && stage === 'close-after')) throw Object.assign(new Error('INJECTED_' + stage), { code: 'INJECTED_' + stage });
  };
  return {
    write(filename, input, expected = null, progress = () => {}) {
      insist(!retired && !busy && !unknown && rows.length < 256, 'WRITER_ADMISSION_CLOSED');
      const row = { path:filename,enrolled:true,opened:false,closed:false,bytes:0,fsynced:false,primaryPresent:false,primary:{type:'undefined'},cleanup:[],stages:[] };
      rows.push(row); busy = true;
      let descriptor = null, primary, present = false, existingIdentity = null;
      const fail = error => { if (!present) { present = true; primary = error; row.primaryPresent = true; row.primary = describe(error); } else row.cleanup.push(describe(error)); };
      const stage = name => { row.stages.push(name); progress(name,row.bytes); onEvent({stage:name,path:filename,opened:row.opened,closed:row.closed,bytes:row.bytes}); };
      try {
        stage('enrolled'); inject('enrolled');
        const entry = allowed.get(filename);
        insist(entry && Buffer.isBuffer(input) && input.length <= entry.maximum, 'WRITER_PATH_OR_BOUND');
        const parent = ops.lstatSync(root);
        insist(parent.isDirectory() && !parent.isSymbolicLink() && ops.realpathSync(root) === root, 'WRITER_PARENT');
        if (entry.kind !== 'create') {
          const existing = ops.lstatSync(filename); existingIdentity = existing;
          insist(existing.isFile() && !existing.isSymbolicLink() && (existing.mode & 0o777) === entry.mode && expected && Number.isInteger(expected.bytes) && expected.bytes >= 0 && expected.bytes <= entry.maximum && existing.size === expected.bytes && /^[a-f0-9]{64}$/.test(expected.sha256), 'WRITER_EXISTING');
        }
        inject('open-before');
        const flags = fs.constants.O_NOFOLLOW | (entry.kind === 'create' ? fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL : fs.constants.O_RDWR | (entry.kind === 'append' ? fs.constants.O_APPEND : 0));
        descriptor = ops.openSync(filename, flags, entry.mode); row.opened = true;
        stage('opened'); inject('opened');
        const info = ops.fstatSync(descriptor);
        insist(info.isFile() && (info.mode & 0o777) === entry.mode, 'WRITER_DESCRIPTOR');
        const currentPath = ops.lstatSync(filename);
        insist(currentPath.isFile() && !currentPath.isSymbolicLink() && currentPath.ino === info.ino && currentPath.dev === info.dev && (!existingIdentity || (existingIdentity.ino === info.ino && existingIdentity.dev === info.dev)), 'WRITER_OPEN_IDENTITY');
        if (entry.kind === 'create') insist(info.size === 0, 'WRITER_NEW_SIZE');
        else {
          insist(info.size === expected.bytes, 'WRITER_EXISTING_SIZE');
          const previous = Buffer.alloc(info.size);
          let offset = 0;
          while (offset < previous.length) { const amount = ops.readSync(descriptor, previous, offset, previous.length-offset, offset); insist(amount > 0, 'WRITER_READ_SHORT'); offset += amount; }
          insist(digest(previous) === expected.sha256, 'WRITER_EXISTING_HASH');
          if (entry.kind === 'replace') { ops.ftruncateSync(descriptor,0); stage('truncated'); }
          else insist(info.size + input.length <= entry.maximum, 'WRITER_APPEND_CAP');
        }
        let iterations = 0;
        while (row.bytes < input.length) {
          insist(iterations++ < 128, 'WRITER_WRITE_ITERATIONS');
          const short = fault === 'write-short' || fault === 'write-after';
          const amount = fault === 'write-zero' || fault === 'write-zero-close-after' ? 0 : ops.writeSync(descriptor,input,row.bytes,short ? 1 : input.length-row.bytes);
          insist(Number.isInteger(amount) && amount > 0 && amount <= input.length-row.bytes, 'WRITER_SHORT_WRITE');
          row.bytes += amount; stage('writing'); inject('write-after');
        }
        stage('written'); inject('fsync-before');
        ops.fsyncSync(descriptor); row.fsynced = true; stage('synced'); inject('fsync-after');
      } catch (error) { fail(error); }
      finally {
        if (descriptor !== null) {
          try { ops.closeSync(descriptor); row.closed = true; stage('closed'); inject('close-after'); }
          catch (error) { if (!row.closed) unknown = true; fail(error); }
        } else row.closed = true;
        busy = false;
      }
      if (present) throw primary;
      return {bytes:row.bytes,sha256:digest(input),mode:allowed.get(filename).mode};
    },
    close() { retired = true; insist(!busy && !unknown && rows.every(row => row.closed), 'WRITER_RETIREMENT_UNKNOWN'); },
    receipt() { return {schema:'OWNED_DESCRIPTOR_WRITER_V1',role,retired,unknown,closed:!busy&&!unknown&&rows.every(row=>row.closed),rows:rows.map(row=>({...row,cleanup:[...row.cleanup],stages:[...row.stages]}))}; },
  };
}
