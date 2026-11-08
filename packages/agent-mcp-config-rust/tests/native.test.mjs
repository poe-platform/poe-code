import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as own from '../dist/index.js';
import {standardShape,opencodeShape,gooseShape} from '../dist/shapes.js';
import {createMockFs} from '../dist/config/testing.js';
import * as sdkShapes from '../../agent-mcp-config/dist/shapes.js';
import * as sdk from '../../agent-mcp-config/dist/index.js';
import {native} from '../dist/native.js';
import {Worker} from 'node:worker_threads';
test('support distinguishes aliases, unavailable agents and unknown names',()=>{
 assert.deepEqual(own.supportedAgents,['claude-code','claude-desktop','codex','cursor','opencode','goose']);
 assert.equal(own.resolveAgentSupport(' CLAUDE ').id,'claude-code');
 assert.equal(own.resolveAgentSupport('gemini').status,'unsupported');
 assert.equal(own.resolveAgentSupport('constructor').status,'unknown');
});
test('shape keeps references and custom args iteration',()=>{
 const args=['a'],env={A:'b'},entry={name:'test',config:{transport:'stdio',command:'cmd',args,env}};
 const standard=standardShape(entry);assert.equal(standard.args,args);assert.equal(standard.env,env);
 args[Symbol.iterator]=function*(){yield 'custom';};
 assert.deepEqual(opencodeShape(entry).command,['cmd','custom']);
 assert.equal(gooseShape(entry).envs,env);
});
test('unsupported configure never accesses foreign server properties',async()=>{
 const failure=new Error('foreign');const server=new Proxy({},{get(){throw failure;}});
 await assert.rejects(own.configure('missing',server,{}),own.UnsupportedAgentError);
});
test('configuration roundtrip removes args by replacing canonical server',async()=>{
 const fs=createMockFs({},'/home/test'),options={fs,homeDir:'/home/test',platform:'linux'};
 const server={name:'test',config:{transport:'stdio',command:'cmd',args:['a']}};
 await own.configure('claude',server,options);await own.configure('claude',server,options);
 await own.unconfigure('claude','test',options);await own.configure('claude',{...server,config:{transport:'stdio',command:'cmd'}},options);
 assert.deepEqual(JSON.parse(fs.getContent('/home/test/.claude.json')),{mcpServers:{test:{command:'cmd'}}});
});
function tracedEntry({enabled=true,transport='stdio',throwAt,iterator=false}={}){
 const log=[],failure=new Error('foreign getter');
 const args=['a','b'];
 if(iterator)args[Symbol.iterator]=function*(){log.push('iterate');yield 'custom';};
 const config=new Proxy({transport,command:'cmd',url:'https://example.com/mcp',args,env:{A:'B'},headers:{X:'Y'}},{get(target,key){log.push('config.'+String(key));if(key===throwAt)throw failure;return Reflect.get(target,key);}});
 const entry={name:'test',get enabled(){log.push('enabled');return enabled;},get config(){log.push('config');return config;}};
 return {entry,log,failure};
}
test('all shapes match SDK getters, disabled branches, iterator behavior and thrown identity',()=>{
 for(const name of ['standardShape','opencodeShape','gooseShape'])for(const transport of ['stdio','http'])for(const enabled of [true,false])for(const throwAt of [undefined,'transport','command','args','env','url','headers']){
  const left=tracedEntry({enabled,transport,throwAt,iterator:true}),right=tracedEntry({enabled,transport,throwAt,iterator:true});
  let a,b,failedA=false,failedB=false;
  try{a=sdkShapes[name](left.entry);}catch(error){assert.equal(error,left.failure);failedA=true;}
  try{b={standardShape,opencodeShape,gooseShape}[name](right.entry);}catch(error){assert.equal(error,right.failure);failedB=true;}
  assert.equal(failedB,failedA,name);assert.deepEqual(right.log,left.log,name);
  if(!failedA){
   // Identity is separately checked above; array iteration is observable only in opencode.
   if(a===undefined)assert.equal(b,undefined);
   else assert.deepEqual(JSON.parse(JSON.stringify(b)),JSON.parse(JSON.stringify(a)));
  }
 }
});
test('optional field assignments invoke prototype setters before later reads',()=>{
 for(const name of ['standardShape','opencodeShape','gooseShape']){
  const invoke=fn=>{
   const log=[],saved=Object.getOwnPropertyDescriptor(Object.prototype,'args');
   Object.defineProperty(Object.prototype,'args',{configurable:true,set(value){log.push('assign args');Object.defineProperty(this,'args',{value,writable:true,configurable:true,enumerable:true});}});
   try{
    const output=fn({name:'test',config:{transport:'stdio',command:'cmd',args:['x'],get env(){log.push('read env');return {A:'B'};}}});
    return {log,output};
   }finally{if(saved)Object.defineProperty(Object.prototype,'args',saved);else delete Object.prototype.args;}
  };
  assert.deepEqual(invoke({standardShape,opencodeShape,gooseShape}[name]),invoke(sdkShapes[name]));
 }
});
test('custom support registry preserves spread getters and snapshot isolation',()=>{
 const invoke=fn=>{const log=[],config={get configFile(){log.push('file');return '~/own.json';},configKey:'own',format:'json',shape:'standard'};
  const registry={get codex(){log.push('registry');return config;}};
  const output=fn(' CODEX ',registry);assert.notEqual(output.config,config);return {log,output};};
 assert.deepEqual(invoke(own.resolveAgentSupport),invoke(sdk.resolveAgentSupport));
});
test('unknown platform values use default paths without coercion',()=>{
 const foreign={ [Symbol.toPrimitive](){throw new Error('unexpected coercion');} };
 const config=own.resolveAgentSupport('claude-desktop').config;
 assert.equal(config.configFile(foreign),'~/.config/Claude/claude_desktop_config.json');
 assert.equal(config.configFile(new String('darwin')),'~/.config/Claude/claude_desktop_config.json');
});
test('URL constructor and protocol getter preserve validation boundaries',async()=>{
 const saved=globalThis.URL;
 try{
  for(const protocol of ['http:','https:','ftp:']){
   const log=[];
   globalThis.URL=class{constructor(value){log.push('parse '+value);}get protocol(){log.push('protocol');return protocol;}};
   const server={name:'test',config:{transport:'http',url:'https://example.com'}};
   const run=async fn=>{const fs=createMockFs({},'/home/test');log.length=0;let message;
    try{await fn('claude',server,{fs,homeDir:'/home/test',platform:'linux'});}catch(error){message=error.message;}
    return {log:[...log],message};};
   assert.deepEqual(await run(own.configure),await run(sdk.configure));
  }
  const failure=new Error('protocol');globalThis.URL=class{get protocol(){throw failure;}};
  await assert.rejects(own.configure('claude',{name:'x',config:{transport:'http',url:'https://example.com'}},{platform:'linux'}),error=>error===failure);
 }finally{globalThis.URL=saved;}
});
test('native policies reject malformed replies and release terminal buffers explicitly',()=>{
 const shape=new native.AgentMcpShape('goose');assert.throws(()=>shape.respond('unit',false,0),/Invalid shape response/);
 assert.equal(shape.request().kind,'enabled');shape.respond('flag',false,0);assert.equal(shape.request().present,false);shape.discard();assert.throws(()=>shape.request(),/discarded/);
 const decision=new native.AgentMcpDecision('configure','mcp','~/path');assert.throws(()=>decision.respond('unit',false),/Invalid configuration decision/);
 assert.equal(decision.request().kind,'map');decision.respond('invalid',false);assert.equal(decision.request().message,'Expected mcp to be an object.');decision.discard();assert.throws(()=>decision.request(),/discarded/);
 shape.reset('standard');assert.equal(shape.request().kind,'enabled');shape.discard();
 decision.reset('unconfigure','other','~/other');assert.equal(decision.request().kind,'map');decision.discard();
 const validation=new native.AgentMcpValidation();validation.respond(false);validation.discard();validation.reset();assert.equal(validation.request().kind,'name');validation.discard();
});
test('nested shape calls and thrown getters do not contaminate reusable native policies',()=>{
 const failure=new Error('command');let calls=0;
 const nested=depth=>standardShape({name:'test',get enabled(){calls++;if(depth)assert.deepEqual(nested(depth-1),{command:'inner'});return true;},config:{transport:'stdio',command:'inner'}});
 assert.deepEqual(nested(16),{command:'inner'});assert.equal(calls,17);
 for(let i=0;i<64;i++){
  assert.throws(()=>standardShape({config:{transport:'stdio',get command(){throw failure;}}}),error=>error===failure);
  assert.deepEqual(standardShape({config:{transport:'stdio',command:'clean'}}),{command:'clean'});
 }
});
test('parallel small-stack workers repeatedly configure and remove every agent',async()=>{
 const entry=new URL('../dist/index.js',import.meta.url).href,testing=new URL('../dist/config/testing.js',import.meta.url).href;
 const source=`const {parentPort,workerData}=require('node:worker_threads');
 (async()=>{const api=await import(workerData.entry),{createMockFs}=await import(workerData.testing);
 for(let i=0;i<256;i++)for(const agent of api.supportedAgents){
  const fs=createMockFs({},'/home/test'),options={fs,homeDir:'/home/test',platform:['linux','darwin','win32'][i%3]};
  const server={name:'test',config:i%2?{transport:'http',url:'https://example.com/mcp',headers:{X:'Y'}}:{transport:'stdio',command:'node',args:['tools.js'],env:{A:'B'}}};
  await api.configure(agent,server,options);await api.configure(agent,server,options);await api.unconfigure(agent,server,options);
 }
 parentPort.postMessage('done');})().catch(error=>{throw error;});`;
 await Promise.all([0,1].map(()=>new Promise((resolve,reject)=>{
  const worker=new Worker(source,{eval:true,workerData:{entry,testing},resourceLimits:{stackSizeMb:4}});let done=false;
  worker.on('message',value=>{assert.equal(value,'done');done=true;});worker.on('error',reject);worker.on('exit',code=>{if(code!==0||!done)reject(new Error('Worker failed '+code));else resolve();});
 })));
});
test('sequential host operations keep native wrapper allocations bounded',async()=>{
 const entry=new URL('../dist/index.js',import.meta.url).href,testing=new URL('../dist/config/testing.js',import.meta.url).href,bindings=new URL('../dist/native.js',import.meta.url).href;
 const source=`const {parentPort,workerData}=require('node:worker_threads');
 (async()=>{const {native}=await import(workerData.bindings),counts={};
 for(const key of ['AgentMcpShape','AgentMcpValidation','AgentMcpDecision']){const Saved=native[key];counts[key]=0;native[key]=function(...args){counts[key]++;return new Saved(...args);};}
 const api=await import(workerData.entry),{createMockFs}=await import(workerData.testing);
 const fs=createMockFs({},'/home/test'),options={fs,homeDir:'/home/test',platform:'linux'},server={name:'test',config:{transport:'stdio',command:'node'}};
 for(let i=0;i<64;i++)for(const agent of api.supportedAgents){await api.configure(agent,server,options);await api.unconfigure(agent,server,options);}
 parentPort.postMessage(counts);})().catch(error=>{throw error;});`;
 const counts=await new Promise((resolve,reject)=>{const worker=new Worker(source,{eval:true,workerData:{entry,testing,bindings}});worker.on('message',resolve);worker.on('error',reject);});
 for(const [key,count] of Object.entries(counts))assert.ok(count<=8,key+' native allocations grew to '+count);
});
