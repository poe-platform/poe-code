import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
const root = new URL('./', import.meta.url);
const author = new URL('../../../bash-surface-independent-20260829/virtual-comparison-direct-activation-v2/actual-run-v1/', root);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const checks = [];
function check(name, condition) { checks.push({name, pass: condition === true}); }
function admitted(url, bytes, sha256) {
  const stat = fs.lstatSync(url);
  if (!stat.isFile() || stat.size !== bytes) throw Error('regular/exact-size admission');
  const buffer = fs.readFileSync(url);
  if (buffer.length !== bytes || hash(buffer) !== sha256) throw Error('hash admission');
  return buffer;
}
function bytes(record) {
  if (!record || typeof record.base64 !== 'string' || !Number.isSafeInteger(record.bytes)) throw Error('invalid byte record');
  const value = Buffer.from(record.base64, 'base64');
  if (value.toString('base64') !== record.base64 || value.length !== record.bytes || hash(value) !== record.sha256) throw Error('byte record mismatch');
  return value;
}
const manifest = JSON.parse(admitted(new URL('capture/manifest.raw', root), 2684, 'b67a32f83a604a948e18f87fffbe327eb7fc20196fe540ede7ec0cbd86593976'));
const load = name => { const pin = manifest.files[name]; return JSON.parse(admitted(new URL(name, author), pin.bytes, pin.sha256)); };
const outcomes = load('OUTCOME-MATRIX.json'), membership = load('MEMBERSHIP.json');
const envelope = manifest.captureArchive;
const encoded = admitted(new URL('RAW-CAPTURE.json.gz.base64', author), envelope.encodedBytes, envelope.encodedSha256);
const compressed = Buffer.from(encoded.toString('ascii').trim(), 'base64');
if (compressed.length !== envelope.gzipBytes || hash(compressed) !== envelope.gzipSha256) throw Error('compressed identity');
const decoded = zlib.gunzipSync(compressed, {maxOutputLength:envelope.decodedBytes});
if (decoded.length !== envelope.decodedBytes || hash(decoded) !== envelope.decodedSha256) throw Error('decoded identity');
const archive = JSON.parse(decoded.toString('utf8'));
const frames = new Map();
let total = 0;
for (const frame of archive.files) {
  if (frames.has(frame.path)) throw Error('duplicate frame');
  const content = bytes(frame); total += content.length;
  frames.set(frame.path, {record:frame,content});
}
check('678 exact frames and aggregate bytes', frames.size === 678 && total === envelope.rawFileBytes);
const byHash = new Map([...frames.values()].map(frame=>[frame.record.sha256,frame]));
const controls = [];
const good = {bytes:1,base64:'AA==',sha256:hash(Buffer.from([0]))};
for (const [name, value] of [['wrong bytes',{...good,bytes:2}],['wrong hash',{...good,sha256:'0'.repeat(64)}],['noncanonical framing',{...good,base64:'AA==\n'}],['missing presence',{bytes:1,sha256:good.sha256}]]) {
  let refused = false; try { bytes(value); } catch { refused = true; } controls.push({name,pass:refused});
}
controls.push({name:'valid NUL byte',pass:bytes(good).equals(Buffer.from([0]))});
controls.push({name:'false status is not zero',pass:!isDeepStrictEqual(false,0)});
controls.push({name:'file mode difference retained',pass:!isDeepStrictEqual([{mode:420}],[{mode:438}])});
controls.push({name:'stderr difference retained',pass:!Buffer.from('a').equals(Buffer.from('b'))});
const differences = [], summary = [];
for (const row of outcomes.rows) {
  const child = membership.childRows.find(child=>child.id===row.id);
  const receiptFrame = byHash.get(row.receiptSha256);
  check(row.id+' receipt frame authenticated', Boolean(receiptFrame));
  if (!receiptFrame || !child) continue;
  const receipt = JSON.parse(receiptFrame.content.toString('utf8'));
  check(row.id+' receipt equals published virtual outcome', isDeepStrictEqual(receipt.observation,row.virtual));
  const stdout = child.captures.find(record=>record.kind==='stdout');
  const stderr = child.captures.find(record=>record.kind==='stderr');
  check(row.id+' raw stdout exactly receipt', bytes(stdout).equals(receiptFrame.content));
  check(row.id+' raw helper stderr empty', bytes(stderr).length===0);
  check(row.id+' raw program hash',hash(Buffer.from(row.program))===row.programSha256);
  const comparison = {stdout:bytes(row.native.stdout).equals(bytes(row.virtual.stdout)),stderr:bytes(row.native.stderr).equals(bytes(row.virtual.stderr)),status:isDeepStrictEqual(row.native.status,row.virtual.status),filesBefore:isDeepStrictEqual(row.native.filesBefore,row.virtual.filesBefore),filesAfter:isDeepStrictEqual(row.native.filesAfter,row.virtual.filesAfter)};
  const equal = Object.values(comparison).every(value=>value===true);
  check(row.id+' independent comparison',isDeepStrictEqual(comparison,row.comparison)&&equal===row.allRawEqual);
  check(row.id+' public settlement',row.virtual.publicSettlement.execObserved===true&&row.virtual.publicSettlement.disposeSettled===true&&row.virtual.publicSettlement.disposeRejected===false&&isDeepStrictEqual(row.virtual.publicSettlement.events,['exec-started','exec-resolved','dispose-started','dispose-resolved'])&&row.virtual.cleanup.settled===true&&!row.virtual.hasPrimary&&!row.virtual.hasCleanupError);
  summary.push({id:row.id,equal});
  if (!equal&&row.layout==='source-built') differences.push({id:row.caseId,program:row.program,programSha256:row.programSha256,comparison,native:{status:row.native.status,stdoutUtf8:bytes(row.native.stdout).toString('utf8'),stderrUtf8:bytes(row.native.stderr).toString('utf8'),stdout:row.native.stdout,stderr:row.native.stderr,filesAfter:row.native.filesAfter},virtual:{status:row.virtual.status,stdoutUtf8:bytes(row.virtual.stdout).toString('utf8'),stderrUtf8:bytes(row.virtual.stderr).toString('utf8'),stdout:row.virtual.stdout,stderr:row.virtual.stderr,filesAfter:row.virtual.filesAfter}});
}
for (const child of membership.childRows) {
  const names = child.events.map(event=>event.name);
  check(child.id+' retired lifecycle',child.exit===true&&child.close===true&&child.stdoutEOF===true&&child.stderrEOF===true&&child.knownOutstanding===0&&!child.forced&&child.signals.length===0&&child.status===0&&child.signal===null&&!child.primaryPresent&&child.secondary.length===0);
  check(child.id+' capture before spawn',names.indexOf('capture-open')>=0&&names.indexOf('capture-open')<names.indexOf('spawn')&&names.indexOf('listeners-enrolled')<names.indexOf('spawn'));
  for (const capture of child.captures) check(child.id+' '+capture.kind+' raw frame',byHash.has(hash(bytes(capture)))&&capture.closed===true&&capture.flushed===true);
}
for (const trace of membership.caseTraces) {
  const frame = byHash.get(trace.traceSha256);
  check(trace.id+' trace frame identity',Boolean(frame)&&frame.record.bytes===trace.traceBytes);
  check(trace.id+' no unexpected trace',trace.unexpectedEvents===0 || (Array.isArray(trace.unexpectedEvents)&&trace.unexpectedEvents.length===0));
}
const jsonSummaries = [];
for (const [name,frame] of frames) {
  if (/^(ARCHIVE-ADMISSION|SOURCE|POSTFLIGHT|TOOLS|BINDING|TERMINAL|OWNER|LEDGER)/.test(name) && name.endsWith('.json') && frame.content.length<2000000) {
    const parsed = JSON.parse(frame.content.toString('utf8'));
    jsonSummaries.push({name,bytes:frame.content.length,sha256:frame.record.sha256,keys:Object.keys(parsed),value:frame.content.length<6000?parsed:undefined});
  }
}
const result = {at:new Date().toISOString(),rawFrames:frames.size,rawBytes:total,observations:summary.length,equal:summary.filter(row=>row.equal).length,different:summary.filter(row=>!row.equal).length,controls,checks:checks.length,failed:checks.filter(row=>!row.pass),knownChildRows:membership.childRows.length,sourceDiffIds:differences.map(row=>row.id),membership:{postflight:membership.postflight,archiveAdmission:membership.archiveAdmission,permissions:membership.permissions,knownExecutionRoles:membership.knownExecutionRoles,ownerStarted:membership.ownerStarted,ownerDeadline:membership.ownerDeadline,publicationConservativeDeadline:membership.publicationConservativeDeadline},jsonSummaries,frameIndex:[...frames].map(([path,frame])=>({path,bytes:frame.record.bytes,sha256:frame.record.sha256})),qualification:'Only existing raw DATA authenticated; no new semantic execution or complete campaign compliance. Invalid final accounting remains HOLD.'};
fs.writeFileSync(new URL('DIFFERENCES.json',root),JSON.stringify(differences,null,2)+'\n',{flag:'wx'});
fs.writeFileSync(new URL('AUDIT.json',root),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...result,frameIndex:undefined,jsonSummaries:undefined},null,2));
if(result.failed.length||controls.some(row=>!row.pass))process.exitCode=1;
