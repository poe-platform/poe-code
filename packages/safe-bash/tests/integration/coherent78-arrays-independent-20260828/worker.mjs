import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
const emit = row => process.stdout.write(JSON.stringify(row) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const [manifestPath, manifestHash, mode, idsJson] = process.argv.slice(2);
let api, manifest;
try {
  const bytes = fs.readFileSync(manifestPath); assert.equal(sha(bytes), manifestHash, 'manifest binding mismatch'); manifest = JSON.parse(bytes);
  assert.equal(process.execPath, manifest.node.path); assert.equal(process.version, 'v22.22.2');
  assert.equal(sha(fs.readFileSync(manifest.node.path)), manifest.node.sha256);
  for(const tree of manifest.trees){
    const actual={};let count=0;const walk=directory=>{for(const name of fs.readdirSync(directory).sort()){assert.ok(++count<20000);const filename=path.join(directory,name),stat=fs.lstatSync(filename),relative=path.relative(tree.root,filename);assert.ok(!stat.isSymbolicLink());if(stat.isDirectory()){actual[relative+'/']={directory:true,mode:stat.mode&0o777};walk(filename);}else actual[relative]={bytes:stat.size,mode:stat.mode&0o777,sha256:sha(fs.readFileSync(filename))};}};walk(tree.root);assert.deepEqual(actual,tree.entries,'tree census mismatch');
  }
  assert.equal(import.meta.resolve('virtual-bash'), pathToFileURL(path.join(manifest.product, 'dist/index.js')).href);
  const denied = () => { throw new Error('unconfigured network forbidden'); }; http.request = denied; https.request = denied; globalThis.fetch = denied; syncBuiltinESMExports();
  registerHooks({ load(url, context, nextLoad) { if (!url.startsWith('file:')) return nextLoad(url, context); const filename = fileURLToPath(url); const expected = manifest.files[filename]; assert.ok(expected, `outside executable closure: ${filename}`); assert.ok(!/\.(?:ts|mts)$/u.test(filename), 'source fallback forbidden'); assert.equal(fs.realpathSync(filename), filename); const result = nextLoad(url, context); const source = typeof result.source === 'string' ? Buffer.from(result.source) : Buffer.from(result.source); assert.equal(sha(source), expected.sha256, `loaded bytes drift: ${filename}`); if(filename.startsWith(manifest.product+'/dist/')) emit({load:{path:filename,sha256:sha(source)}}); return result; } });
  api = await import('virtual-bash');
  if (mode === 'author-core' || mode === 'author-array') { await import(mode === 'author-core' ? './probe.mjs' : './arrays.mjs'); }
  else {
    const data = JSON.parse(fs.readFileSync(new URL('./CASES-independent.json', import.meta.url)));
    const ids = JSON.parse(idsJson); const outcomes = [];
    const encoder = new TextEncoder(); const deferred = () => { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; };
    const clock = () => { const value={time:0,handles:new Map(),sequence:0,now(){assert.equal(this,value);return this.time;},setTimeout(callback,delay){assert.equal(this,value);const key=++this.sequence;this.handles.set(key,callback);return key;},clearTimeout(key){assert.equal(this,value);this.handles.delete(key);},fire(){this.time=1;const calls=[...this.handles.values()];this.handles.clear();for(const call of calls)call();}};return value; };
    for (const id of ids) {
      const result = {id,pass:false,disposed:false}; let shell;
      try {
        if(id==='G-fallback'){await assert.rejects(import(manifest.outside),error=>String(error).includes('outside executable closure'));result.pass=true;result.disposed=true;outcomes.push(result);emit({observation:result});continue;}
        const filesystem = new api.MemoryFileSystem(); for(const directory of ['/w','/scripts','/search/project'])await filesystem.mkdir(directory,{recursive:true});for(const[name,value]of Object.entries(data.files))await filesystem.writeFile(name,encoder.encode(value));
        const scheduler=clock(); shell=new api.Shell({fs:filesystem,cwd:'/w',env:{HOME:'/w',PATH:''},...(id==='D02-shared-limit'?{limits:{maxCommands:3}}:{})}).use(api.agentCommands({timeout:{scheduler}}));
        const literal=data.literal.find(row=>row.id===id);
        if(literal){const actual=await shell.exec(literal.script);result.actual=actual;assert.equal(actual.exitCode,literal.exitCode);assert.equal(actual.stdout,literal.stdout);if(literal.stderrContains)assert.ok(actual.stderr.includes(literal.stderrContains));else assert.equal(actual.stderr,'');}
        else if(id==='D00-registry'){const{expectedNames}=await import('./names.mjs');assert.deepEqual(api.createAgentCommands().map(row=>row.name).sort(),expectedNames);assert.equal(expectedNames.length,78);const timeout=await import('virtual-bash/commands/timeout');assert.equal(timeout.timeoutCommands,api.timeoutCommands);for(const key of ['curl','safejs','js','declare','mapfile'])assert.ok(!expectedNames.includes(key));result.count=78;}
        else if(id==='D01-invoke'){let cleanup=0;shell.register({name:'relay',async execute(context){assert.ok(context.invoke&&context.registerCleanup);context.registerCleanup(async()=>{cleanup++;});return context.invoke('f',['child'],{signal:undefined});}});const actual=await shell.exec('a=(parent); f(){ local a; a=("$@"); printf "%s\\n" "${a[@]}"; }; relay; printf "%s\\n" "$a"');result.actual=actual;assert.equal(actual.stdout,'child\nparent\n');assert.equal(actual.exitCode,0);assert.equal(actual.stderr,'');assert.equal(cleanup,1);result.cleanup=cleanup;}
        else if(id==='D02-shared-limit'){let invoked=0,cleanup=0;shell.register({name:'relay',async execute(context){assert.ok(context.invoke&&context.registerCleanup);context.registerCleanup(async()=>{cleanup++;});await context.invoke('printf',['%s','first']);invoked++;await context.invoke('printf',['%s','second']);return{exitCode:0};}});await assert.rejects(shell.exec('a=(value); relay'),error=>error instanceof api.ShellLimitError&&error.limit==='maxCommands');assert.equal(invoked,1);assert.equal(cleanup,1);result.invoked=invoked;result.cleanup=cleanup;}
        else if(id==='D03-preabort'){const reason=Object.freeze({case:id}),caller=new AbortController();caller.abort(reason);await assert.rejects(shell.exec('a=($(printf side)); printf nope',{signal:caller.signal}),error=>error===reason);result.identity=true;}
        else if(id==='D06-backpressure'){const entered=deferred(),release=deferred();let settled=false,offered;const running=shell.exec('a=(雪😀); printf "%s" "$a"',{stdout:{async write(bytes){offered=[...bytes];entered.resolve();await release.promise;}}}).finally(()=>{settled=true;});try{assert.equal(await Promise.race([entered.promise.then(()=>true),running.then(()=>false,()=>false)]),true);assert.equal(settled,false);}finally{release.resolve();}const actual=await running;assert.equal(actual.stdout,'雪😀');assert.equal(actual.exitCode,0);assert.deepEqual(offered,[...encoder.encode('雪😀')]);result.backpressure=true;}
        else if(id==='D07-empty-argv'){const calls=[];shell.register({name:'capture',async execute(context){calls.push([...context.args]);return{exitCode:0};}});const actual=await shell.exec('a=(); b=(); capture "${a[@]}${b[@]}"; capture """${a[@]}${b[@]}"');assert.equal(actual.exitCode,0);assert.equal(actual.stderr,'');assert.deepEqual(calls,[[],['']]);result.calls=calls;}
        else if(id==='D04-curl-jq'||id==='D05-timeout-curl'){
          const started=deferred();const events={requests:0,authorized:0,acquired:0,returned:0,disposed:0,pending:0,listeners:0};let active,requestSignal,position=0;
          const finish=()=>{if(active){requestSignal.removeEventListener('abort',active.abort);events.listeners--;events.pending--;active=undefined;}};
          shell.use(api.networkCommands({
            authorize(request){assert.equal(new URL(request.url).origin,'https://unit.invalid');events.authorized++;return true;},
            async transport(request){
              events.requests++;requestSignal=request.signal;
              return {
                status:200,statusText:'OK',headers:[['X-Independent','yes']],
                body:{[Symbol.asyncIterator](){
                  events.acquired++;
                  return {
                    async next(){if(id==='D04-curl-jq')return position++===0?{done:false,value:encoder.encode('{"ok":true}')}:{done:true};const gate=deferred();const abort=()=>{const reason=request.signal.reason;finish();gate.reject(reason);};active={gate,abort};events.pending++;events.listeners++;request.signal.addEventListener('abort',abort,{once:true});started.resolve();return gate.promise;},
                    async return(){events.returned++;if(active){const gate=active.gate;finish();gate.resolve({done:true});}return{done:true};}
                  };
                }},
                async dispose(){events.disposed++;if(active){const gate=active.gate;finish();gate.resolve({done:true});}}
              };
            }
          }));
          const caller=new AbortController();const script=id==='D04-curl-jq'?'urls=(https://unit.invalid/body); timeout 0 curl -sS -D /headers "${urls[0]}" | jq .ok':'urls=(https://unit.invalid/slow); timeout .001 curl -sS "${urls[0]}"';const running=shell.exec(script,{signal:caller.signal});
          if(id==='D05-timeout-curl'){assert.equal(await Promise.race([started.promise.then(()=>true),running.then(()=>false,()=>false)]),true);scheduler.fire();}
          const actual=await running;result.actual=actual;assert.equal(actual.exitCode,id==='D04-curl-jq'?0:124);assert.equal(actual.stdout,id==='D04-curl-jq'?'true\n':'');assert.equal(actual.stderr,'');assert.equal(events.authorized,1);assert.equal(events.requests,1);assert.equal(events.acquired,1);assert.equal(events.disposed,1);assert.equal(events.pending,0);assert.equal(events.listeners,0);assert.equal(caller.signal.aborted,false);assert.equal(scheduler.handles.size,0);if(id==='D05-timeout-curl'){assert.equal(events.returned,1);assert.equal(requestSignal.aborted,true);}else assert.ok(new TextDecoder().decode(await filesystem.readFile('/headers')).includes('X-Independent: yes'));result.events=events;
        } else throw new Error(`unknown case ${id}`);
        result.pass=true;
      } catch(reason){result.error=String(reason?.stack??reason);}
      finally{if(shell){try{await shell.dispose();result.disposed=true;}catch(reason){emit({unsafeCleanup:String(reason)});throw reason;}}}
      outcomes.push(result);emit({observation:result});
    }
    if(manifest.mutant)emit({activation:{id:manifest.mutant.id,hits:globalThis.__coherentMutationHits??0,path:manifest.mutant.path,sha256:manifest.files[manifest.mutant.path].sha256}});
    emit({summary:{cases:outcomes.length,pass:outcomes.filter(row=>row.pass).length,disposed:outcomes.filter(row=>row.disposed).length}});process.exitCode=outcomes.every(row=>row.pass)?0:1;
  }
} catch(reason){emit({diagnostic:String(reason?.stack??reason)});process.exitCode=78;}
