import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {resultExitCode} from './run.mjs';
const load=name=>JSON.parse(JSON.parse(gunzipSync(Buffer.from(readFileSync(new URL(name+'.json.gz.base64',import.meta.url),'utf8').trim(),'base64'))).entries.find(entry=>entry.name==='REPORT.json').content);
const original=load('RUN-V1'),focused=load('RUN-V2');
const rows=[];
function check(name,report,expected){assert.equal(resultExitCode(report),expected);rows.push({name,expected,status:'PASS'});}
check('original9/10 remains failure',original,1);
check('focused actual1/1 maps success not ten-group acceptance',focused,0);
for(const [name,mutate]of [
  ['unknown status',report=>{report.status='PASS';}],
  ['missing group',report=>{report.groups=[];}],
  ['failure count',report=>{report.failed=1;}],
  ['forced cleanup',report=>{report.groups[0].signals=['SIGTERM'];}],
  ['nonzero child',report=>{report.groups[0].status=1;}],
  ['claim full rerun',report=>{report.notExecuted=0;}],
]){const report=structuredClone(focused);mutate(report);check(name,report,1);}
console.log(JSON.stringify({scope:'offline reporter-only checks on sealed receipts; zero Git/worker/product execution; historical CLIexit1 unchanged',rows}));
