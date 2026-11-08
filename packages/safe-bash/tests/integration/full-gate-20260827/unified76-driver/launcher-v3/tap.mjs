import assert from 'node:assert/strict';
import {createReadStream} from 'node:fs';
import {BOUNDS,enforceCharge} from './policy.mjs';

export async function accountFile(file){
  const summary={},cases=[];let pending='',lineNumber=0,totalBytes=0,active,diagnosticIndent;
  const finish=()=>{if(!active)return;const match=active.match,fields={};for(const key of ['type','failureType','location','code','error'])fields[key]=active.fields[key]??null;
    const skip=/ # SKIP\b(.*)$/iu.exec(match[4]),todo=/ # TODO\b(.*)$/iu.exec(match[4]);
    const status=skip?'skipped':todo?'todo':['cancelledByParent','testTimeoutFailure','testAborted'].includes(fields.failureType)?'cancelled':match[2]==='ok'?'pass':'fail';
    assert.ok(cases.length<100000,'bounded TAP case inventory');cases.push({id:`tap-line-${active.line}`,line:active.line,indent:match[1].length,ordinal:Number(match[3]),name:match[4],status,reason:skip?.[1]?.trim()??todo?.[1]?.trim(),...fields,...status==='pass'?{}:{detail:active.detail.join('\n')}});active=undefined;
  };
  const line=value=>{
    lineNumber++;const total=/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)$/u.exec(value);if(total)summary[total[1]]=Number(total[2]);
    if(active){if(value.trim()&&value.length-value.trimStart().length<=active.match[1].length)finish();else{active.detailBytes=enforceCharge(active.detailBytes,Buffer.byteLength(value)+1,BOUNDS.maximumLineBytes);active.detail.push(value);for(const key of ['type','failureType','location','code','error']){const found=new RegExp('^\\s*'+key+': (.*)$','u').exec(value);if(found&&active.fields[key]===undefined)active.fields[key]=found[1].replace(/^['"]|['"]$/gu,'');}}}
    if(diagnosticIndent!==undefined){if(value===' '.repeat(diagnosticIndent)+'...')diagnosticIndent=undefined;return;}
    if(value.trim()==='---'){diagnosticIndent=value.length-value.trimStart().length;return;}
    const match=/^( *)(not ok|ok) (\d+) - (.*)$/u.exec(value);if(match){finish();active={match,line:lineNumber,fields:{},detail:[],detailBytes:0};}
  };
  const decoder=new TextDecoder();for await(const chunk of createReadStream(file,{highWaterMark:BOUNDS.chunkBytes})){totalBytes=enforceCharge(totalBytes,chunk.length,BOUNDS.phaseOutputBytes);pending+=decoder.decode(chunk,{stream:true});let end;while((end=pending.indexOf('\n'))!==-1){const text=pending.slice(0,end).replace(/\r$/u,'');assert.ok(Buffer.byteLength(text)<=BOUNDS.maximumLineBytes);line(text);pending=pending.slice(end+1);}assert.ok(Buffer.byteLength(pending)<=BOUNDS.maximumLineBytes);}
  pending+=decoder.decode();if(pending)line(pending);finish();
  const tests=cases.filter(entry=>entry.type!=='suite'),counts={pass:0,fail:0,skipped:0,todo:0,cancelled:0};for(const entry of tests)counts[entry.status]++;
  const reconciliation={completeFooter:Number.isInteger(summary.tests),testInstances:tests.length===summary.tests,statuses:Object.fromEntries(Object.entries(counts).map(([name,value])=>[name,value===summary[name]]))};
  return{summary,counts,reconciled:reconciliation.completeFooter&&reconciliation.testInstances&&Object.values(reconciliation.statuses).every(Boolean),reconciliation,cases:tests,suites:cases.filter(entry=>entry.type==='suite'),nonpassing:tests.filter(entry=>entry.status!=='pass'),qualification:'Streamed bounded TAP with unchanged status classification; skip/TODO/characterization is never feature acceptance'};
}
