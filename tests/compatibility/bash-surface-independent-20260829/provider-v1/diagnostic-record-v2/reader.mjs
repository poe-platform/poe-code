import { assessHeader, processImagePath } from './matcher.mjs';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const stringEnd = (text, start) => { let escaped = false; for (let index = start + 1; index < text.length; index++) { const char = text[index]; if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') return index + 1; } return -1; };
export function headerFields(text) {
  const newline = text.indexOf('\n'); if (newline < 0) fail('HEADER_INCOMPLETE');
  const metadata = JSON.parse(text.slice(0, newline));
  const kept = { metadataName: metadata.name ?? metadata.app_name, metadataTimestamp: metadata.timestamp, bugType: metadata.bug_type };
  const allowed = new Set(['pid','procName','procPath','procLaunch','captureTime','parentPid']);
  let cursor = newline + 1; while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++;
  if (text[cursor++] !== '{') fail('HEADER_SHAPE');
  while (cursor < text.length) {
    while (cursor < text.length && /[\s,]/.test(text[cursor])) cursor++;
    if (text[cursor] !== '"') break;
    const keyEnd = stringEnd(text, cursor); if (keyEnd < 0) break;
    const key = JSON.parse(text.slice(cursor, keyEnd)); cursor = keyEnd;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
    if (text[cursor++] !== ':') fail('HEADER_SYNTAX');
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
    const start = cursor; let depth = 0, ended = false;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === '"') { const end = stringEnd(text, cursor); if (end < 0) break; cursor = end; continue; }
      if (char === '[' || char === '{') depth++;
      else if (char === ']' || char === '}') { if (depth === 0) { ended = true; break; } depth--; }
      else if (char === ',' && depth === 0) { ended = true; break; }
      cursor++;
    }
    if (!ended) break;
    if (allowed.has(key)) { if (Object.hasOwn(kept, key)) fail('DUPLICATE_HEADER_KEY'); kept[key] = JSON.parse(text.slice(start,cursor)); }
    if (text[cursor] === '}') break;
  }
  return kept;
}
export function stamp(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s*([+-]\d{2}):?(\d{2})$/.exec(value);
  if (match) return Date.parse(match[1]+'T'+match[2]+'.'+(match[3]??'').padEnd(3,'0').slice(0,3)+match[4]+':'+match[5]);
  return Date.parse(value);
}
function selectedPath(value, plan) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  if (value === plan.node || value === '/usr/bin/sandbox-exec' || value.startsWith('/usr/lib/') || value.startsWith('/System/Library/')) return value;
  return '[non-whitelisted path omitted]';
}
function selectedReason(value, plan, trustedContext = false) {
  if (typeof value !== 'string' || value.length > 4096 || (!trustedContext && !/dyld|sandbox|library not loaded|library missing/i.test(value))) return undefined;
  return value.replace(/\/(?:[^\s"'<>(),;])+ /g, token => selectedPath(token.trim(),plan)+' ').replace(/\/(?:[^\s"'<>(),;])+/g, token => selectedPath(token,plan)).slice(0,4096);
}
export async function acquire(plan, publish) {
  const output = { schema:'d03-selected-diagnostic-v1', status:'STARTED', inventory:[], headers:[], fullRecordsRead:0, headerBytesRead:0, rawRecordCaptured:false, errors:[] };
  const handles = []; const check = () => { if (Date.now() >= plan.deadline) fail('DEADLINE'); };
  try {
    check(); await publish({event:'ADMISSION', planSha256:digest(Buffer.from(JSON.stringify(plan))), noRawHeaderCapture:true});
    const candidates = []; let names = 0;
    for (const root of plan.roots) {
      const rootStat = await fs.lstat(root); if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await fs.realpath(root) !== root) fail('ROOT_IDENTITY');
      for await (const name of fs.glob(plan.patterns, {cwd:root})) {
        check(); if (++names > 100) fail('INVENTORY_LIMIT');
        const match = /^(node|sandbox-exec)-(2026-08-29)-(\d{2})(\d{2})(\d{2})(?:[-_][A-Za-z0-9-]+)?\.ips$/.exec(name);
        if (!match) continue;
        const base = Date.parse(match[2]+'T'+match[3]+':'+match[4]+':'+match[5]+'Z');
        if (![base,base+18000000].some(time=>time>=plan.started-120000&&time<=plan.finished+120000)) continue;
        const file = root+'/'+name; const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) fail('CANDIDATE_NOT_REGULAR');
        const entry = {root,name,bytes:stat.size,mtimeMs:stat.mtimeMs,device:stat.dev,inode:stat.ino};
        output.inventory.push(entry); candidates.push({file,stat,entry});
      }
    }
    output.inventoryCount = output.inventory.length; output.filteredGlobNames = names;
    await publish({event:'FILTERED_INVENTORY', entries:output.inventory});
    if (!candidates.length) fail('NO_CANDIDATE'); if (candidates.length > 4) fail('HEADER_CANDIDATE_LIMIT');
    const matched = [];
    for (const candidate of candidates) {
      check(); const handle = await fs.open(candidate.file,constants.O_RDONLY|constants.O_NOFOLLOW); handles.push(handle);
      const stat = await handle.stat(); if (stat.dev!==candidate.stat.dev||stat.ino!==candidate.stat.ino||stat.size!==candidate.stat.size) fail('CANDIDATE_CHANGED');
      const prefix = Buffer.alloc(Math.min(stat.size,8192)); const read = await handle.read(prefix,0,prefix.length,0); output.headerBytesRead += read.bytesRead;
      const fields = headerFields(prefix.subarray(0,read.bytesRead).toString('utf8')); prefix.fill(0);
      const assessment = assessHeader(fields,plan);
      const record = {name:candidate.entry.name,bytesRead:read.bytesRead,...assessment,...(assessment.matched?{pid:fields.pid,procName:fields.procName,procPath:processImagePath(fields.procPath),procLaunch:fields.procLaunch,captureTime:fields.captureTime,parentPid:fields.parentPid}:{})};
      output.headers.push(record); await publish({event:'SELECTED_HEADER',...record});
      if (record.matched) matched.push({...candidate,handle,fields});
    }
    if (matched.length !== 1) fail(matched.length?'AMBIGUOUS_MATCH':'NO_EXACT_PID_EVENT_MATCH');
    const match = matched[0]; if (match.stat.size>2097152) fail('MATCHED_RECORD_OVERSIZE');
    const bytes = Buffer.alloc(match.stat.size), hash=createHash('sha256'); let position=0;
    while(position<bytes.length){check();const read=await match.handle.read(bytes,position,Math.min(65536,bytes.length-position),position);if(!read.bytesRead)fail('SHORT_RECORD');hash.update(bytes.subarray(position,position+read.bytesRead));position+=read.bytesRead;}
    output.fullRecordsRead=1;
    const after=await match.handle.stat();if(after.dev!==match.stat.dev||after.ino!==match.stat.ino||after.size!==match.stat.size||after.mtimeMs!==match.stat.mtimeMs)fail('RECORD_CHANGED');
    const newline=bytes.indexOf(10);if(newline<0)fail('IPS_FORMAT');const metadata=JSON.parse(bytes.subarray(0,newline).toString('utf8'));if(String(metadata.bug_type)!=='309')fail('NOT_CRASH_REPORT');
    const report=JSON.parse(bytes.subarray(newline+1).toString('utf8'));
    if(!assessHeader({...report,bugType:metadata.bug_type},plan).matched)fail('FULL_RECORD_PREDICATE_MISMATCH');
    if(report.pid!==plan.pid||report.procName!==match.fields.procName||report.procPath!==match.fields.procPath||report.procLaunch!==match.fields.procLaunch||report.captureTime!==match.fields.captureTime)fail('HEADER_BODY_MISMATCH');
    const reasons=[];for(const value of report.termination?.reasons??[]){const reason=selectedReason(value,plan);if(reason)reasons.push(reason);}
    if(report.asi&&typeof report.asi==='object')for(const [key,values]of Object.entries(report.asi)){if(!/dyld|sandbox|secinit/i.test(key)||!Array.isArray(values))continue;for(const value of values){const reason=selectedReason(value,plan,true);if(reason)reasons.push({context:key.replace(/^.*\//,''),text:reason});}}
    if(reasons.length>8)fail('REASON_SELECTION_LIMIT');
    const images=(Array.isArray(report.usedImages)?report.usedImages:[]).filter(image=>['node','sandbox-exec','dyld','libsandbox.1.dylib','libsystem_secinit.dylib'].includes(image.name)).map(image=>({name:image.name,path:selectedPath(image.path,plan),uuid:typeof image.uuid==='string'?image.uuid:undefined}));if(images.length>8)fail('IMAGE_SELECTION_LIMIT');
    output.selected={procName:report.procName,procPath:processImagePath(report.procPath),pid:report.pid,procLaunch:report.procLaunch,captureTime:report.captureTime,parentPid:report.parentPid,exception:{type:report.exception?.type,signal:report.exception?.signal,codes:report.exception?.codes},termination:{namespace:report.termination?.namespace,code:report.termination?.code,signal:report.termination?.signal,indicator:typeof report.termination?.indicator==='string'&&/^[A-Za-z0-9 :_-]{0,128}$/.test(report.termination.indicator)?report.termination.indicator:undefined},reasons,images};
    output.rawIdentity={root:match.entry.root,name:match.entry.name,bytes:bytes.length,sha256:hash.digest('hex'),mode:after.mode&511,device:after.dev,inode:after.ino};bytes.fill(0);
    output.status=typeof report.procName==='string'&&report.procName.length>0&&processImagePath(report.procPath)?'SELECTED_FIELDS_ACQUIRED':'STOP';if(output.status==='STOP')output.errors.push({code:'IMAGE_IDENTITY_MISSING'});await publish({event:'SELECTED_RECORD',selected:output.selected,rawIdentity:output.rawIdentity});
  } catch(error) {output.status='STOP';output.errors.push({code:typeof error.code==='string'?error.code:'PARSE_OR_HELPER_FAILURE'});await publish({event:'STOP',codes:output.errors.map(row=>row.code)});}
  finally {let closed=0;for(const handle of handles){await handle.close();closed++;}output.closedHandles=closed;output.openHandles=0;await publish({event:'READER_CLOSED',closedHandles:closed});}
  return output;
}
