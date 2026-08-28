import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as host from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import * as vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { gunzipSync } from 'node:zlib';

const root='/Users/kjopek/Workspace/safe-bash';
assert.equal(process.cwd(),root);
assert.equal(process.version,'v24.11.1');
const directory=path.dirname(url.fileURLToPath(import.meta.url));
const launcher=path.resolve(directory,'../launcher-v3');
const baseline=JSON.parse(host.readFileSync(path.join(directory,'BASELINE.json')));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const results=[],started=Date.now();
let dispatches=0,productImportsExecuted=0;
const fault=new Error('presealed synthetic fault');
const git='/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const gitCore='/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core';
const npm='/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm/bin/npm-cli.js';
const external=JSON.parse(gunzipSync(Buffer.from(host.readFileSync(path.join(launcher,'EXTERNAL.json.gz.base64'),'utf8'),'base64')));
const pinned=new Map([[git,host.readFileSync(git)],[npm,host.readFileSync(npm)]]);
const loadBindings=new Map();
const equal=(left,right)=>assert.equal(JSON.stringify(left),JSON.stringify(right));

function state(options={}){
  const entries=new Map(),events=[],children=[],registered=[],after=[];
  let sequence=0;
  const normalize=value=>path.resolve(value instanceof URL?url.fileURLToPath(value):String(value));
  const record=(kind,name,extra={})=>{assert.ok(events.length<8192);events.push({kind,path:normalize(name),...extra});};
  const seed=(name,bytes,mode=0o644)=>{
    name=normalize(name);
    if(name!=='/'&&!entries.has(path.dirname(name)))seed(path.dirname(name));
    entries.set(name,{kind:bytes===undefined?'directory':'file',bytes:bytes===undefined?undefined:Buffer.from(bytes),mode:bytes===undefined?0o755:mode,ino:++sequence});
  };
  seed('/');seed('/gate/tmp');seed(root);seed(gitCore);
  for(const[name,bytes]of pinned)seed(name,bytes,0o755);
  const fail=code=>Object.assign(new Error(code),{code});
  const get=name=>{const entry=entries.get(normalize(name));if(!entry)throw fail('ENOENT');return entry;};
  const stat=name=>{const entry=get(name);return{size:entry.bytes?.length??0,mode:entry.mode,ino:entry.ino,dev:1,nlink:1,mtimeNs:1n,ctimeNs:1n,isFile:()=>entry.kind==='file',isDirectory:()=>entry.kind==='directory',isSymbolicLink:()=>false};};
  const read=(name,encoding)=>{const entry=get(name);assert.equal(entry.kind,'file');return encoding?entry.bytes.toString(typeof encoding==='string'?encoding:encoding.encoding):Buffer.from(entry.bytes);};
  const mkdir=(name,settings={})=>{
    name=normalize(name);record('mkdir',name);if(options.mkdirFault?.(name))throw fault;
    if(entries.has(name)){if(settings.recursive)return;throw fail('EEXIST');}
    if(!entries.has(path.dirname(name))&&!settings.recursive)throw fail('ENOENT');seed(name);
  };
  const mkdtemp=prefix=>{const name=normalize(prefix+'synthetic-'+(++sequence));seed(name);record('mkdtemp',name);options.created?.(name,api);return name;};
  const readdir=(name,settings={})=>{
    name=normalize(name);get(name);const names=[...entries.keys()].filter(key=>key!==name&&path.dirname(key)===name).map(key=>path.basename(key)).sort();
    if(settings.withFileTypes)return names.map(child=>({name:child,...stat(path.join(name,child))}));
    return api.realm(names);
  };
  const write=(name,bytes)=>{record('write',name);if(options.writeFault?.(normalize(name)))throw fault;seed(name,bytes);};
  const rm=name=>{name=normalize(name);record('rm',name);for(const key of entries.keys())if(key===name||key.startsWith(name+'/'))entries.delete(key);};
  const rmdir=name=>{name=normalize(name);record('rmdir',name);if(readdir(name).length)throw fail('ENOTEMPTY');entries.delete(name);};
  const fs={constants:{X_OK:1},existsSync:name=>entries.has(normalize(name)),accessSync:name=>{get(name);},lstatSync:stat,statSync:stat,
    realpathSync:name=>{get(name);return normalize(name);},readFileSync:read,writeFileSync:write,mkdirSync:mkdir,mkdtempSync:mkdtemp,readdirSync:readdir,rmSync:rm,rmdirSync:rmdir};
  const promises={mkdir:async(...args)=>mkdir(...args),mkdtemp:async(...args)=>mkdtemp(...args),readFile:async(...args)=>read(...args),
    readdir:async(...args)=>readdir(...args),writeFile:async(...args)=>write(...args),lstat:async(...args)=>stat(...args),
    rm:async(name)=>{if(options.delayRemoval)await options.delayRemoval();rm(name);},rmdir:async(...args)=>rmdir(...args)};
  const spawn=(command,args,settings={})=>{
    assert.ok(++dispatches<=120);const row={command,args:[...args],cwd:settings.cwd,env:{...settings.env},input:settings.input,argv0:settings.argv0};children.push(row);
    if(options.spawn)return options.spawn(row,api);
    let text='';if(args.includes('--version'))text=command.includes('comm')?'comm (GNU coreutils) 9.7\n':command.includes('paste')?'paste (GNU coreutils) 9.7\n':command.includes('join')?'join (GNU coreutils) 9.7\n':'GNU patch 2.8\n';
    return{status:0,signal:null,error:undefined,stdout:settings.encoding==='utf8'?text:Buffer.from(text),stderr:settings.encoding==='utf8'?'':Buffer.alloc(0)};
  };
  const register=(name,...args)=>{registered.push({name,callback:args.at(-1)});};
  const syntheticProcess={env:{FULL_GATE_ROOT:'/gate',PATH:'/gate/native:/gate/tool-bin',GIT_EXEC_PATH:gitCore,NODE_TEST_CONTEXT:'synthetic',...options.env},
    argv:['/admitted/node','/synthetic/not-an-entrypoint'],execPath:'/admitted/node',platform:'darwin',arch:'arm64',version:'v24.11.1',cwd:()=>root,
    stdout:{write:text=>{api.stdout+=text;}},stderr:{write:text=>{api.stderr+=text;}}};
  const api={entries,events,children,registered,after,seed,fs,promises,spawn,register,process:syntheticProcess,stdout:'',stderr:'',realm:value=>value};
  return api;
}

async function load(relative,state_,extra={}){
  const filename=path.resolve(root,relative);
  const bytes=host.readFileSync(filename);loadBindings.set(relative,sha(bytes));
  const source=relative.endsWith('.ts')?stripTypeScriptTypes(bytes.toString(),{mode:'strip'}):bytes.toString();
  const context=vm.createContext({Buffer,URL,TextEncoder,TextDecoder,AbortController,AbortSignal,performance,process:state_.process,
    console:{log:()=>{},error:()=>{}},setTimeout:()=>{throw new Error('unapproved synthetic timer');},clearTimeout:()=>{}});
  state_.realm=value=>vm.runInContext('('+JSON.stringify(value)+')',context);
  const imports=new Map();
  for(const match of source.matchAll(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gmu)){
    const clause=match[1].trim(),names=[];const braces=/\{([^}]+)\}/u.exec(clause);
    if(braces)for(const part of braces[1].split(','))if(part.trim())names.push(part.trim().split(/\s+as\s+/u)[0]);
    if(!clause.startsWith('{')&&!clause.startsWith('*'))names.push('default');
    imports.set(match[2],names);
  }
  const builtins={
    'node:assert/strict':{...assert,default:assert},'node:crypto':crypto,'node:path':path,'node:url':url,
    'node:fs':state_.fs,'node:fs/promises':state_.promises,'node:os':{tmpdir:()=>extra.tmpdir??'/gate/tmp'},
    'node:child_process':{spawnSync:state_.spawn,execFileSync:()=>{throw new Error('unapproved execFileSync');},spawn:()=>{throw new Error('unapproved spawn');}},
    'node:test':{default:state_.register,test:state_.register},'node:stream/promises':{},
  };
  const module=new vm.SourceTextModule(source,{context,identifier:url.pathToFileURL(filename).href,
    initializeImportMeta:meta=>{meta.url=url.pathToFileURL(filename).href;}});
  await module.link(specifier=>{
    const selected=extra[specifier]??builtins[specifier]??{};
    const names=imports.get(specifier)??[];
    return new vm.SyntheticModule(names,function(){for(const name of names){this.setExport(name,selected[name]??function(){productImportsExecuted++;throw new Error('unapproved imported code: '+specifier+' '+name);});}},{context});
  });
  await module.evaluate({timeout:3000});
  return{namespace:module.namespace,context,fixture:value=>state_.realm(value)};
}

async function check(id,operation){
  assert.ok(Date.now()-started<120000,'author data/synthetic time bound');
  try{await operation();results.push({id,status:'PASS',kind:'synthetic-or-source-control'});}
  catch(error){results.push({id,status:'FAIL',error:{name:error?.name,message:error?.message,stack:error?.stack}});}
}
const table='tests/commands/table-text-stress/support.ts';
const shared='tests/commands/table-text-stress/shared-stdin-fix/support.ts';
const fixture={name:'synthetic',command:'comm',args:[],files:{left:'610a',right:'610a'},stdinHex:''};
const createdRoots=state_=>state_.events.filter(event=>event.kind==='mkdtemp').map(event=>event.path);
const cleared=state_=>{for(const name of createdRoots(state_))assert.equal(state_.entries.has(name),false,name);};

for(const [id,options]of [['C01-success',{}],['C01-spawn-error',{spawn:()=>{throw fault;}}],['C01-write-error',{writeFault:name=>name.endsWith('/sentinel')}],['C01-adjacent-foreign',{}]])await check(id,async()=>{
  const current=state(options);current.seed('/gate/tmp/foreign/data','preserve');const linked=await load(table,current);
  if(id.includes('error'))await assert.rejects(linked.namespace.native(linked.fixture(fixture)),error=>error===fault);
  else await linked.namespace.native(linked.fixture(fixture));
  cleared(current);assert.equal(current.fs.readFileSync('/gate/tmp/foreign/data','utf8'),'preserve');
});
await check('C01-awaited-cleanup',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const current=state({delayRemoval:()=>pending});const linked=await load(table,current);
  let settled=false;const result=linked.namespace.native(linked.fixture(fixture)).finally(()=>{settled=true;});
  for(let tick=0;tick<30;tick++)await Promise.resolve();assert.equal(settled,false);release();await result;cleared(current);
});

for(const id of ['C02-native-success','C02-native-error','C02-foreign-parent','C02-overlap'])await check(id,async()=>{
  const current=state({...(id==='C02-native-error'?{spawn:()=>{throw fault;}}:{}),...(id==='C02-foreign-parent'?{created:(name,api)=>{if(name.includes('table-shared-'))api.seed(name+'/foreign','leave');}}:{})});
  const linked=await load(shared,current);
  const invoke=()=>linked.namespace.native(linked.fixture(fixture));
  if(id==='C02-native-error')await assert.rejects(invoke(),error=>error===fault);
  else if(id==='C02-foreign-parent'){await assert.rejects(invoke(),error=>error.code==='ENOTEMPTY');const parent=createdRoots(current)[0];assert.equal(current.fs.readFileSync(parent+'/foreign','utf8'),'leave');assert.ok(!current.events.some(event=>event.kind==='rm'&&event.path===parent));return;}
  else if(id==='C02-overlap')await Promise.all([invoke(),invoke()]);else await invoke();cleared(current);
});
await check('C02-version-error-cleanup',async()=>{
  const current=state();const linked=await load(shared,current);await assert.rejects(linked.namespace.verifyOracle(),error=>error.code==='ENOENT');cleared(current);
});

const mount='tests/fs/mount/identity-authority-review/implementation/public-comparison.test.ts';
for(const id of ['C03-success','C03-child-create-error','C03-registered-before-child','C03-foreign-parent'])await check(id,async()=>{
  const current=state({...(id==='C03-foreign-parent'?{created:(name,api)=>{if(name.includes('identity-comparison-')&&!name.includes('/native-'))api.seed(name+'/foreign','leave');}}:{})});
  let acquired=0;
  const mkdtemp=current.promises.mkdtemp;current.promises.mkdtemp=async prefix=>{if(prefix.endsWith('/native-')){assert.equal(current.after.length,1);if(id==='C03-child-create-error')throw fault;}return mkdtemp(prefix);};
  const filesystem={writeFile:async()=>{},link:async()=>{}};
  await load(mount,current,{'../../../../../src/fs/real/index.js':{createRealFileSystem:async()=>{acquired++;return filesystem;}},
    '../../../../../src/fs/readonly/index.js':{createReadOnlyFileSystem:value=>value},'./support.js':{bytes:value=>Buffer.from(value),comparison:async(...args)=>args.at(-1)==='/alias'?'same':'distinct'}});
  const selected=current.registered.find(entry=>entry.name.includes('over real:'));
  if(id==='C03-child-create-error')await assert.rejects(selected.callback({after:fn=>current.after.push(fn)}),error=>error===fault);
  else await selected.callback({after:fn=>current.after.push(fn)});
  if(id==='C03-foreign-parent'){await assert.rejects(current.after[0](),error=>error.code==='ENOTEMPTY');assert.equal(current.fs.readFileSync(createdRoots(current)[0]+'/foreign','utf8'),'leave');}
  else{await current.after[0]();cleared(current);}assert.equal(acquired,id==='C03-child-create-error'?0:2);
});

const execute=path.relative(root,path.join(launcher,'execute.mjs'));
for(const id of ['C04-exact-route','C04-missing-entry','C04-wrong-hash','C04-args-build-accounting'])await check(id,async()=>{
  const current=state();const source='/gate/source';for(const name of ['package.json','bin/tsc','lib/tsc.js','lib/_tsc.js']){
    const record=external.directories.main.entries.find(entry=>entry.path==='typescript/'+name);current.seed(source+'/node_modules/typescript/'+name,host.readFileSync(root+'/node_modules/typescript/'+name),record.mode);
  }
  if(id==='C04-missing-entry')current.entries.delete(source+'/node_modules/typescript/bin/tsc');
  if(id==='C04-wrong-hash')current.seed(source+'/node_modules/typescript/bin/tsc',Buffer.alloc(45),0o755);
  const linked=await load(execute,current,{'./external-admission.mjs':{externalReceipt:()=>({report:external})},'./common.mjs':{sha}});
  if(id.includes('missing')||id.includes('wrong'))assert.throws(()=>linked.namespace.benchmarkTypeInvocation(source));
  else{const invocation=linked.namespace.benchmarkTypeInvocation(source);equal(invocation.args,[source+'/node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.json']);assert.equal(invocation.cwd,source+'/benchmarks');assert.equal(invocation.bindings.length,4);}
  assert.equal(current.children.length,0);assert.ok(!current.events.some(entry=>entry.kind==='write'));
});

const editflows='tests/commands/diff-patch-stress/editflows/helpers.ts';
for(const wrong of [false,true])await check('C05-editflow-'+(wrong?'wrong-hash':'exact'),async()=>{
  const current=state();if(wrong)current.seed(git,Buffer.alloc(3704880),0o755);const linked=await load(editflows,current);
  if(wrong)assert.throws(()=>linked.namespace.native('/gate/fixture','git',['apply','--no-index','-'],''));
  else{linked.namespace.native('/gate/fixture','git',['apply','--no-index','-'],'');assert.equal(current.children[0].command,git);assert.equal(current.children[0].env.GIT_EXEC_PATH,gitCore);equal(current.children[0].args,['apply','--no-index','-']);}assert.equal(current.children.length,wrong?0:1);
});
for(const wrong of [false,true])await check('C05-s3-'+(wrong?'wrong-hash':'exact'),async()=>{
  const current=state({spawn:(row,api)=>{if(api.children.length>1)throw fault;return{status:0,signal:null,stdout:'f5e9fc49\n',stderr:''};}});if(wrong)current.seed(git,Buffer.alloc(3704880),0o755);
  await load('tests/integration/s3-http-exports/verify.mjs',current);
  if(wrong)assert.equal(current.children.length,0);else{assert.equal(current.children[0].command,git);equal(current.children[0].args,['rev-parse','--verify','HEAD^{commit}']);assert.equal(current.children[0].env.PATH,'/gate/native:/gate/tool-bin');assert.equal(current.children[0].env.GIT_EXEC_PATH,gitCore);}cleared(current);
});

for(const wrong of [false,true])await check('C06-npm-'+(wrong?'wrong-hash':'exact'),async()=>{
  const current=state();if(wrong)current.seed(npm,Buffer.alloc(54),0o755);const linked=await load('tests/plugins/qualified-current-release-native-data/helpers.ts',current);
  if(wrong)assert.throws(()=>linked.namespace.run('/gate/fixture','npm',['test','--','--test-reporter=tap']));
  else{linked.namespace.run('/gate/fixture','npm',['test','--','--test-reporter=tap']);assert.equal(current.children[0].command,current.process.execPath);equal(current.children[0].args,[npm,'test','--','--test-reporter=tap']);assert.equal(current.children[0].env.NODE_TEST_CONTEXT,undefined);assert.equal(current.children[0].env.PATH,current.process.env.PATH);}assert.equal(current.children.length,wrong?0:1);
});

for(const [file,count]of [['safety',10],['streaming',6]])for(const good of [true,false])await check(`C07-${file}-${good?'tap':'wrong-report'}`,async()=>{
  const current=state();let captured;
  await load(`tests/commands/search-stress/${file}.test.ts`,current,{'./harness.js':{directory:'/gate/test',bounded:(command,args)=>{captured=args;return{code:0,stdout:Buffer.from(good?`# pass ${count}\n`:`ℹ pass ${count}\n`).toString('base64'),stderr:''};},text:value=>Buffer.from(value,'base64').toString()}});
  const callback=current.registered[0].callback;if(good)callback();else assert.throws(callback);
  assert.ok(captured.indexOf('--test-reporter=tap')<captured.findIndex(value=>value.endsWith('.ts')));
});

const oracle='tests/commands/diff-patch-stress/gnu-target/oracle.ts';
for(const id of ['C08-identity-success','C08-identity-error','C08-wrong-temp-root'])await check(id,async()=>{
  const current=state();current.seed('/outside');const linked=await load(oracle,current,{tmpdir:id.endsWith('root')?'/outside':'/gate/tmp'});
  const operation=temporary=>{assert.ok(temporary.startsWith('/gate/tmp/'));if(id.endsWith('error'))throw fault;return 7;};
  if(id.endsWith('root'))assert.throws(()=>linked.namespace.withNativeScratch(operation),/outside/u);else if(id.endsWith('error'))assert.throws(()=>linked.namespace.withNativeScratch(operation),error=>error===fault);else assert.equal(linked.namespace.withNativeScratch(operation),7);
  cleared(current);
});
for(const id of ['C08-followup-success','C08-followup-error','C08-auxiliary-source-route'])await check(id,async()=>{
  if(id.endsWith('source-route')){
    const text=host.readFileSync(root+'/tests/commands/diff-patch-stress/gnu-auxiliary/helpers.ts','utf8');
    assert.match(text,/withNativeScratch\(temporary => spawnSync\(identity\.realpath, nativeArgs/u);assert.match(text,/PATCH_GET: "0", TMPDIR: temporary/u);return;
  }
  const current=state({...(id.endsWith('error')?{spawn:()=>{throw fault;}}:{})});const linkedOracle=await load(oracle,current);
  const linked=await load('tests/commands/diff-patch-stress/gnu-target-followup/helpers.ts',current,{'../gnu-target/oracle.js':{withNativeScratch:linkedOracle.namespace.withNativeScratch,oracleIdentity:()=>({path:'/pinned/patch'})},'../safety/helpers.js':{cwd:'/sandbox/work'}});
  const probe=linked.fixture({args:[],input:'literal patch',files:{'/sandbox/work/target':'old'}});
  if(id.endsWith('error'))await assert.rejects(linked.namespace.nativeProbe(probe),error=>error===fault);else await linked.namespace.nativeProbe(probe);
  assert.notEqual(current.children[0].cwd,current.children[0].env.TMPDIR);assert.equal(current.children[0].input,'literal patch');cleared(current);
});

for(const failure of [false,true])await check('C09-tac-'+(failure?'error':'success'),async()=>{
  const current=state({...(failure?{spawn:()=>{throw fault;}}:{})});const linked=await load('tests/commands/stream-inspection/oracle.ts',current);
  const specimen=linked.fixture({id:'literal',command:'tac',args:['-s','::'],files:{input:'610a'},stdinHex:'00ff'});
  if(failure)assert.throws(()=>linked.namespace.capture(specimen,'/pinned/tac','tac'),error=>error===fault);else linked.namespace.capture(specimen,'/pinned/tac','tac');
  assert.notEqual(current.children[0].cwd,current.children[0].env.TMPDIR);equal(current.children[0].args,['-s','::']);assert.equal(current.children[0].input.toString('hex'),'00ff');cleared(current);
});

for(const id of ['C10-separated','C10-extra-semantic-file','C10-child-error'])await check(id,async()=>{
  const current=state();const linked=await load('tests/shell-stress/helpers.ts',current,{'./process.js':{isolatedSpawn:async(command,args,options)=>{
    assert.notEqual(options.cwd,options.env.TMPDIR);current.seed(options.env.TMPDIR+'/sh-thd-synthetic','scratch');current.seed(options.cwd+'/errors','expected');
    if(id==='C10-extra-semantic-file')current.seed(options.cwd+'/unexpected','must remain');if(id==='C10-child-error')throw fault;
    return{status:1,signal:null,stdout:'',stderr:''};
  }}});
  if(id.endsWith('error'))await assert.rejects(linked.namespace.runBash(linked.fixture({name:'synthetic',script:'literal'})),error=>error===fault);
  else{const observation=await linked.namespace.runBash(linked.fixture({name:'synthetic',script:'literal'}));equal(Object.keys(observation.files).sort(),id.includes('extra')?['errors','unexpected']:['errors']);}cleared(current);
});

await check('C11-exact-scope',async()=>{
  const permitted=new Set(baseline.files.map(row=>row.path));for(const filename of loadBindings.keys())assert.ok(permitted.has(filename),filename);
  assert.equal([...loadBindings.keys()].some(name=>name.startsWith('src/')),false);
});
await check('C11-unchanged-assertions',async()=>{
  for(const name of ['safety','streaming']){const text=host.readFileSync(`${root}/tests/commands/search-stress/${name}.test.ts`,'utf8');assert.match(text,/assert\.equal\(result\.code, 0/u);assert.match(text,name==='safety'?/# pass 10\b/u:/# pass 6\b/u);}
  const shell=host.readFileSync(root+'/tests/shell-stress/helpers.ts','utf8');assert.match(shell,/files: hostSnapshot\(directory\)/u);assert.equal(shell.includes('filter('),false);
});
await check('C11-missing-tools-not-admitted',async()=>{
  for(const name of ['cut','sort','tee','xargs','cat'])assert.equal(external.tools.some(tool=>path.basename(tool.origin)===name),false);
});
await check('C12-r3-artifact-bindings',async()=>{
  const previous=path.resolve(directory,'../released-run-v3-qualified-h11');const sealed=JSON.parse(host.readFileSync(path.join(previous,'RESULT-SEAL.json')));for(const file of sealed.files)assert.equal(sha(host.readFileSync(path.join(root,file.path))),file.sha256);
});
await check('C12-fixed-product-source',async()=>{
  const observations=JSON.parse(host.readFileSync(path.resolve(directory,'../r3-diagnosis-v1/OBSERVATIONS.json')));for(const file of observations.sourceBindings.filter(row=>row.path.startsWith('src/')))assert.equal(sha(host.readFileSync(path.join(observations.retainedRoot,file.path))),file.sha256);
});
await check('C12-no-execution-or-host-fixture',async()=>{assert.equal(productImportsExecuted,0);assert.ok(dispatches<=120);});

assert.equal(results.length,45);
const output={schema:1,mode:'whole-module synthetic/source controls; no actual native/product/build/private execution',
  preseal:'d627747d',runtime:{version:process.version,executable:process.execPath},at:new Date().toISOString(),milliseconds:Date.now()-started,
  results,pass:results.filter(row=>row.status==='PASS').length,fail:results.filter(row=>row.status==='FAIL').length,
  syntheticDispatches:dispatches,actualChildProcesses:0,productImportsExecuted,
  sourceBindings:[...loadBindings].map(([filename,sha256])=>({path:filename,sha256})),
  qualifications:['C02 version control exercises failure cleanup, not successful real version verification.','C08 auxiliary control is source-only routing; no auxiliary native/product probe.','No OS fence/real filesystem/tool semantics certified by in-memory imports.','No compiler/checker, R3 rescore or gate launch.']};
process.stdout.write(JSON.stringify(output,null,2)+'\n');
process.exitCode=output.fail?1:0;
