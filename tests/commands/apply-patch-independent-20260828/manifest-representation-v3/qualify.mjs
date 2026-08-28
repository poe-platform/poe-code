import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const own = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(own, 'qualification-01');
assert.ok(!fs.existsSync(root), 'one attempt only'); fs.mkdirSync(root, { mode: 0o700 });
const stdout = fs.openSync(path.join(root, 'stdout.raw'), 'wx', 0o600), stderr = fs.openSync(path.join(root, 'stderr.raw'), 'wx', 0o600);
const journal = fs.openSync(path.join(root, 'OWNER.jsonl'), 'wx', 0o600);
const started = Date.now(); let observed = 0, retained = 0, primary, selected = false, handle, timer, killTimer, closed = false;
const receipt = { schema:'manifest-qualification-owner-v1',owner:process.pid,child:null,allOwnedProcesses:1,totalPeak:1,closed:false,absent:false,code:null,signal:null,observedBytes:0,retainedBytes:0,sourceAuthenticated:false,primary:null };
const event = value => { const bytes = Buffer.from(JSON.stringify(value)+'\n'); assert.ok(bytes.length <= 8192); fs.writeSync(journal,bytes); };
event({event:'capture-ready-before-admission',owner:process.pid,at:started});
function stop(error) { if(!selected){selected=true;primary={name:error.name,message:error.message};} if(handle && !closed){handle.kill('SIGTERM'); killTimer ??= setTimeout(()=>{if(!closed)handle.kill('SIGKILL');},200);} }
try {
  const sealFile=path.join(own,'CONTROL-PRESEAL.json'), stat=fs.lstatSync(sealFile); assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=32768);
  const sealBytes=fs.readFileSync(sealFile), seal=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(sealBytes));
  for(const [name, expected] of Object.entries(seal.files)){
    assert.match(name,/^[A-Za-z0-9_.-]+\.(mjs|json|md|patch)$/); const filename=path.join(own,name), info=fs.lstatSync(filename);
    assert.ok(info.isFile()&&!info.isSymbolicLink());assert.equal(info.size,expected.bytes);assert.equal(info.mode&511,expected.mode);
    const digest=createHash('sha256');for await(const chunk of fs.createReadStream(filename,{highWaterMark:65536}))digest.update(chunk);assert.equal(digest.digest('hex'),expected.sha256);
  }
  assert.equal(createHash('sha256').update(sealBytes).digest('hex'),process.argv[2]); receipt.sourceAuthenticated=true;
  const scratch=path.join(root,'scratch');fs.mkdirSync(scratch,{mode:0o700});
  handle=spawn('/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node',['--unhandled-rejections=strict','--max-old-space-size=256',path.join(own,'controls.mjs'),scratch],{cwd:own,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C',TZ:'UTC'},detached:false});
  if(handle.pid){receipt.child=handle.pid;receipt.allOwnedProcesses=2;receipt.totalPeak=2;}
  event({event:'spawn',pid:handle.pid});
  timer=setTimeout(()=>stop(Error('120s control watchdog')),120000);
  const capture=descriptor=>bytes=>{observed+=bytes.length;try{assert.ok(retained+bytes.length<=8*1024*1024,'qualification combined capture');let offset=0;while(offset<bytes.length)offset+=fs.writeSync(descriptor,bytes,offset,bytes.length-offset);retained+=bytes.length;}catch(error){stop(error);}};
  handle.stdout.on('data',capture(stdout));handle.stderr.on('data',capture(stderr));handle.on('error',stop);
  await new Promise(resolve=>handle.once('close',(code,signal)=>{closed=true;receipt.closed=true;receipt.code=code;receipt.signal=signal;resolve();}));
  clearTimeout(timer);clearTimeout(killTimer);
  try{process.kill(handle.pid,0);}catch(error){if(error.code==='ESRCH')receipt.absent=true;else throw error;}
  assert.ok(receipt.absent,'known exact child retirement');
  event({event:'closed',pid:handle.pid,code:receipt.code,absent:receipt.absent});
}catch(error){stop(error);}
finally{
  clearTimeout(timer);clearTimeout(killTimer);receipt.observedBytes=observed;receipt.retainedBytes=retained;receipt.primary=selected?primary:null;receipt.elapsedMs=Date.now()-started;
  event({event:'terminal',...receipt});for(const descriptor of [stdout,stderr,journal]){fs.fsyncSync(descriptor);fs.closeSync(descriptor);}
  fs.writeFileSync(path.join(root,'RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(receipt));process.exitCode=selected||receipt.code!==0||!receipt.absent?1:0;
}
