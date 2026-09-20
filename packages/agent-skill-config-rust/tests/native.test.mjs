import {test} from 'node:test';import assert from 'node:assert/strict';
import * as native from '../dist/index.js';import * as sdk from '../../agent-skill-config/dist/index.js';
test('own skill catalog aliases and independent configuration objects match SDK',()=>{
 assert.deepEqual(native.supportedAgents,sdk.supportedAgents);assert.ok(Object.isFrozen(native.supportedAgents));
 for(const input of ['claude',' CLAUDE ','Codex','goose','poe-agent','missing','constructor','\ud800'])assert.deepEqual(native.resolveAgentSupport(input),sdk.resolveAgentSupport(input));
 for(const input of native.supportedAgents){assert.deepEqual(native.getAgentConfig(input),sdk.getAgentConfig(input));const first=native.getAgentConfig(input);first.localSkillDir='redirected';assert.deepEqual(native.getAgentConfig(input),sdk.getAgentConfig(input));}
 for(const path of ['~','~/','~./foo','~.foo','~\\foo','ordinary'])for(const scope of ['local','global']){const config={globalSkillDir:path,localSkillDir:path};assert.equal(native.resolveSkillDir(config,scope,'/repo','/home'),sdk.resolveSkillDir(config,scope,'/repo','/home'));}
});

test('filesystem missing codes are classified only on same-realm Error instances',async()=>{
 const builtin=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module'),{runInNewContext}=await import('node:vm');const original=builtin.default.statSync;
 const fn=()=>{};fn.code='ENOENT';const otherRealm=runInNewContext("Object.assign(new Error('foreign realm'),{code:'ENOENT'})");
 try{for(const fault of [{code:'ENOENT'},fn,otherRealm]){builtin.default.statSync=()=>{throw fault;};syncBuiltinESMExports();for(const api of [sdk,native]){let caught;try{api.resolveSkillReference('foo','/repo','/home');}catch(error){caught=error;}assert.equal(caught,fault);}}}finally{builtin.default.statSync=original;syncBuiltinESMExports();}
});
test('native skill apply preserves SDK byte output, observers, user files and dry runs',async()=>{
 assert.equal(typeof native.configure,'function');assert.equal(typeof native.installSkill,'function');
 const {Volume}=await import('memfs');
 for(const agent of native.supportedAgents)for(const scope of ['local','global'])for(const dryRun of [false,true]){
  const results=[];
  for(const api of [sdk,native]){
   const vol=new Volume();vol.fromJSON({'/repo/.keep':'repo','/home/.keep':'home'},'/');const fs=vol.promises,events=[];
   const observers={onStart:details=>events.push(['start',details]),onComplete:(details,outcome)=>events.push(['complete',details,outcome]),onError:(details,error)=>events.push(['error',details,error.message])};
   const options={fs,cwd:'/repo',homeDir:'/home',scope,dryRun,observers};
   await api.configure(agent,options);await api.configure(agent,options);
   const result=await api.installSkill(agent,{name:'😀',content:'---\nname: 😀\n---\nbody\n'},options);
   await api.unconfigure(agent,{...options,force:true});results.push({files:vol.toJSON(),events,result});
  }
  assert.deepEqual(results[1],results[0]);
 }
 for(const api of [sdk,native]){
  const vol=new Volume();vol.fromJSON({'/repo/.claude/skills/poe-generate.md':'user','/home/.keep':'home'},'/');
  const options={fs:vol.promises,cwd:'/repo',homeDir:'/home',scope:'local'};
  await assert.rejects(api.configure('claude',options),error=>error.name==='UserError'&&error.message.includes('Move or delete'));
  await api.unconfigure('claude',{...options,force:false});assert.equal(vol.readFileSync('/repo/.claude/skills/poe-generate.md','utf8'),'user');
  await assert.rejects(api.installSkill('claude',{name:'../escape',content:'body'},options),/Invalid skill name/);
  await assert.rejects(api.configure('unknown',options),api.UnsupportedAgentError);
  const fault=new Error('denied');await assert.rejects(api.configure('claude',{...options,fs:{...options.fs,stat:async()=>{throw fault;}}}),error=>error===fault);
 }
});
test('native template loader retains bundled byte content and missing-template admission',async()=>{
 const own=await import('../dist/templates.js'),reference=await import('../../agent-skill-config/dist/templates.js');
 for(const id of ['poe-generate.md','terminal-pilot.md'])assert.equal(await own.loadTemplate(id),await reference.loadTemplate(id));
 for(const api of [own,reference])await assert.rejects(api.loadTemplate('missing.md'),error=>error.message==='Template not found: missing.md');
});
test('native active skill lifecycles match SDK manifests, binary output and repeated cleanup',async()=>{
 const {fs,vol}=await import('memfs'),builtin=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module');
 const keys=['statSync','lstatSync','readFileSync','writeFileSync','mkdirSync','renameSync','unlinkSync','rmdirSync','rmSync','readdirSync','copyFileSync'];const original=Object.fromEntries(keys.map(key=>[key,builtin.default[key]]));
 const restores=[sdk,native].map(api=>api.setGitDirRunnerForTest(()=>'/bridge/.git'));
 try{for(const key of keys)builtin.default[key]=fs[key];syncBuiltinESMExports();
  for(let round=0;round<32;round++){
   const outputs=[];
   for(const api of [sdk,native]){
    vol.reset();vol.fromJSON({'/bridge/.poe-code/skills/alpha/SKILL.md':'# alpha '+round+' 😀\n','/bridge/.poe-code/skills/alpha/assets/.keep':'asset','/bridge/.claude/skills/beta/SKILL.md':'# beta\n','/bridge/.codex/skills/alpha/SKILL.md':'# codex\n','/home/.config/opencode/skills/native/SKILL.md':'# native\n','/bridge/.git/info/exclude':'keep\n'},'/');
    const binary=Buffer.from(Array.from({length:257},(_,index)=>(index*17+round)&255));vol.writeFileSync('/bridge/.poe-code/skills/alpha/assets/blob.bin',binary);
    const refs=['alpha','claude/beta','codex/alpha','opencode/native'];const first=api.bridgeActiveSkills('OpenCode','/bridge',refs,'/home','same'),second=api.bridgeActiveSkills('OpenCode','/bridge',refs,'/home','same');
    const copied=vol.readFileSync('/bridge/.opencode/skills/alpha/assets/blob.bin');assert.deepEqual(copied,binary);
    const liveExclude=vol.readFileSync('/bridge/.git/info/exclude','utf8');api.cleanupBridgedSkills(first);const mid=vol.readFileSync('/bridge/.git/info/exclude','utf8');
    api.cleanupBridgedSkills(JSON.parse(JSON.stringify(second)));api.cleanupBridgedSkills(second);api.cleanupBridgedSkills(second);
    outputs.push({first,second,copied,liveExclude,mid,cleaned:vol.toJSON()});
   }
   assert.deepEqual(outputs[1],outputs[0]);
  }
 }finally{for(const restore of restores)restore();Object.assign(builtin.default,original);syncBuiltinESMExports();vol.reset();}
});
test('native fingerprint reads retain thrown values without inspecting error-code accessors',async()=>{
 const {fs,vol}=await import('memfs'),builtin=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module'),{runInNewContext}=await import('node:vm');
 const keys=['statSync','lstatSync','readFileSync','readdirSync'];const original=Object.fromEntries(keys.map(key=>[key,builtin.default[key]]));
 const accessor=Object.defineProperty(new Error('fingerprint denied'),'code',{get(){throw new Error('unexpected error-code getter');}});
 const fn=()=>{};fn.code='ENOENT';
 try{for(const key of keys)builtin.default[key]=fs[key];
  for(const fault of [{code:'ENOENT'},fn,runInNewContext("Object.assign(new Error('foreign'),{code:'ENOENT'})"),accessor]){
   vol.reset();vol.fromJSON({'/reads/.poe-code/skills/foo/SKILL.md':'# foo\n'},'/');builtin.default.readFileSync=(path,encoding)=>{if(String(path)==='/reads/.poe-code/skills/foo/SKILL.md'&&encoding===undefined)throw fault;return fs.readFileSync(path,encoding);};syncBuiltinESMExports();
   for(const api of [sdk,native]){let caught;try{api.bridgeActiveSkills('codex','/reads',['foo'],'/home','read');}catch(error){caught=error;}assert.equal(caught,fault);assert.equal(vol.existsSync('/reads/.codex'),false);}
  }
 }finally{Object.assign(builtin.default,original);syncBuiltinESMExports();vol.reset();}
});
test('native active skill ownership rejects filesystem callback reentry',async()=>{
 const {fs,vol}=await import('memfs'),builtin=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module');
 const keys=['statSync','lstatSync','readFileSync','writeFileSync','mkdirSync','renameSync','unlinkSync','rmdirSync','rmSync','readdirSync','copyFileSync'];const original=Object.fromEntries(keys.map(key=>[key,builtin.default[key]]));const restore=native.setGitDirRunnerForTest(()=>undefined);
 try{for(const key of keys)builtin.default[key]=fs[key];vol.reset();vol.fromJSON({'/nested/.poe-code/skills/foo/SKILL.md':'# foo\n'},'/');let nested;
  builtin.default.copyFileSync=(source,target)=>{if(!nested){try{native.bridgeActiveSkills('codex','/nested',['foo'],'/home','nested');}catch(error){nested=error;}}return fs.copyFileSync(source,target);};syncBuiltinESMExports();
  const result=native.bridgeActiveSkills('codex','/nested',['foo'],'/home','outer');assert.match(nested?.message??'',/already running/);native.cleanupBridgedSkills(result);
  const next=native.bridgeActiveSkills('codex','/nested',['foo'],'/home','nested');assert.equal(next.entries.length,1);native.cleanupBridgedSkills(next);
 }finally{restore();Object.assign(builtin.default,original);syncBuiltinESMExports();vol.reset();}
});
test('native bridge copy failures retain primary errors without reading unrelated code getters',async()=>{
 const {fs,vol}=await import('memfs'),builtin=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module');
 const keys=['statSync','lstatSync','readFileSync','writeFileSync','mkdirSync','renameSync','unlinkSync','rmdirSync','rmSync','readdirSync','copyFileSync'];const original=Object.fromEntries(keys.map(key=>[key,builtin.default[key]]));const restores=[sdk,native].map(api=>api.setGitDirRunnerForTest(()=>undefined));
 try{for(const key of keys)builtin.default[key]=fs[key];
  for(const api of [sdk,native]){vol.reset();vol.fromJSON({'/fault/.poe-code/skills/foo/SKILL.md':'# foo\n'},'/');let inspected=0;const fault=Object.defineProperty(new Error('copy denied'),'code',{get(){inspected++;throw new Error('unexpected code getter');}});builtin.default.copyFileSync=()=>{throw fault;};syncBuiltinESMExports();let caught;try{api.bridgeActiveSkills('codex','/fault',['foo'],'/home','fault');}catch(error){caught=error;}assert.equal(caught,fault);assert.equal(inspected,0);assert.equal(vol.existsSync('/fault/.codex'),false);}
 }finally{for(const restore of restores)restore();Object.assign(builtin.default,original);syncBuiltinESMExports();vol.reset();}
});
