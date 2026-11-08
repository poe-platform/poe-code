import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.dirname(new URL(import.meta.url).pathname);
const capture = fs.openSync(path.join(root,'SEAL.capture.data'),'wx',0o600);
const emit = value => fs.writeSync(capture,JSON.stringify(value)+'\n');
function record(location) {
  const stat = fs.lstatSync(location);
  if (!stat.isFile() || stat.size > 128*1024*1024) throw Error('regular bounded file '+location);
  const handle = fs.openSync(location,'r'); const hash = crypto.createHash('sha256'); const buffer = Buffer.alloc(65536);
  let size = 0;
  try { let read; while ((read=fs.readSync(handle,buffer,0,buffer.length,null))>0) {hash.update(buffer.subarray(0,read));size+=read;} } finally {fs.closeSync(handle);}
  if (size!==stat.size) throw Error('read changed');
  return { path:location, size, mode:stat.mode&0o777, sha256:hash.digest('hex') };
}
try {
  emit({event:'start',at:new Date().toISOString()});
  const witnessManifest = JSON.parse(fs.readFileSync(path.join(root,'witnesses/MANIFEST.json')));
  for (const row of witnessManifest.rows) {
    const observed=record(path.join(root,'witnesses',row.capture));
    if (observed.sha256!==row.sha256 || observed.size!==row.bytes) throw Error('witness changed');
  }
  const author=JSON.parse(fs.readFileSync(path.join(root,'witnesses/SEAL-v3.json.data')));
  for (const row of [author.node,...author.tools]) {
    const observed=record(row.path);
    if (observed.sha256!==row.sha256 || observed.size!==row.size || observed.mode!==row.mode) throw Error('tool changed '+row.path);
  }
  const sourceManifest=JSON.parse(fs.readFileSync(path.join(root,'engine/MANIFEST.json')));
  const sources=sourceManifest.rows.map(row=>{
    const captured=record(path.join(root,'engine',row.capture));
    const original=author.sources.find(item=>item.path.endsWith(row.name));
    if (!original || original.sha256!==captured.sha256 || captured.size!==original.size) throw Error('source authority');
    const body=fs.readFileSync(captured.path,'utf8');
    const imports=[...body.matchAll(/from\s+"([^"]+)"/g)].map(match=>match[1]);
    if (imports.some(name=>name!=='node:timers/promises' && !/^\.\/(types|errors|limits|syntax|matcher)\.js$/.test(name))) throw Error('source import closure');
    return {...captured,name:path.basename(row.name),gitBlob:row.blob,imports};
  });
  if (sources.length!==5) throw Error('source membership');
  const inputs=['run.mjs','entry.mjs','independent.mjs','RECIPE.md','seal.mjs','witnesses/suite.mjs.data','witnesses/cases.json.data','witnesses/consumer.mts.data','witnesses/negative.mts.data'].map(name=>record(path.join(root,name)));
  const syntax=[];
  for (const name of ['run.mjs','entry.mjs','independent.mjs']) {
    const stdout=fs.openSync(path.join(root,name+'.syntax.stdout.data'),'wx',0o600);
    const stderr=fs.openSync(path.join(root,name+'.syntax.stderr.data'),'wx',0o600);
    const started=Date.now();
    let outcome;
    try { outcome=spawnSync(author.node.path,['--check',path.join(root,name)],{env:{PATH:'',HOME:root,LANG:'C'},stdio:['ignore',stdout,stderr],timeout:10000}); }
    finally {fs.closeSync(stdout);fs.closeSync(stderr);}
    syntax.push({name,status:outcome.status,signal:outcome.signal,pid:outcome.pid,elapsedMs:Date.now()-started});
    if (outcome.error || outcome.status!==0 || outcome.signal) throw Error('syntax refusal '+name);
  }
  const seal={source:'f97fd06024cb63edfd01873d81d84576a22189db',evidence:witnessManifest.commit,node:author.node,tools:author.tools,flags:author.tscFlags,sources,inputs,syntax,layouts:['source-compiled','installed-regular-copy','physically-moved'],groups:{author:66,independent:24},typeChecks:6,mutations:6,bindingRefusals:2,bounds:{overallMs:3600000,bodyMs:30000,buildMs:120000,children:32,captureBytes:201326592,workBytes:1073741824},sealedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(root,'SEAL.json'),JSON.stringify(seal,null,2)+'\n',{mode:0o600,flag:'wx'});
  emit({event:'sealed',seal:record(path.join(root,'SEAL.json')),sources:sources.length,tools:author.tools.length,syntax});
  console.log(JSON.stringify({seal:record(path.join(root,'SEAL.json')),sources:sources.length,tools:author.tools.length}));
} catch(error) {emit({event:'refused',message:String(error?.stack??error)});process.exitCode=1;}
finally {fs.closeSync(capture);}
