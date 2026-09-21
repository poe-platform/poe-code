import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as commands from '../dist/commands.js';
import {createTerminalPilotMCPGroup} from '../../terminal-pilot-mcp/dist/index.js';
import {createMCPServer} from '../../toolcraft/dist/mcp.js';
const native=createRequire(import.meta.url)('../dist/terminal-pilot-rust.node');
test('own Rust wire metadata exactly matches the current original MCP command surface',async()=>{
 const server=createMCPServer(createTerminalPilotMCPGroup(),{name:'terminal-pilot',version:'0.0.1',omitRootToolNamePrefix:true}),session=server.createMessageSession();
 try{
  await session.handleMessage('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'reference',version:'0'}});
  assert.deepEqual(native.terminalCommandTools(),(await session.handleMessage('tools/list',{})).result.tools);
 }finally{session.close();}
});
test('all automation commands execute against own real PTYs with typed results',async()=>{
 const runtime=commands.createTerminalPilotRuntime(),context={terminalPilotRuntime:runtime};
 const call=(command,params)=>command.handler({...context,params});
 try{
  const created=await call(commands.createSession,{command:'/bin/sh',args:['-c','printf "ready\\n"; while IFS= read -r value; do if [ "$value" = done ]; then exit 7; fi; stty size; printf "got:%s\\n" "$value"; done'],session:'commands',cols:60,rows:10});assert.equal(created.session,'commands');assert.ok(created.pid>0);
  assert.equal((await call(commands.waitFor,{pattern:'ready',literal:true,session:'commands'})).matched,true);
  assert.equal(await call(commands.type,{text:'A',session:'commands'}),undefined);assert.equal(await call(commands.fill,{text:'da',session:'commands'}),undefined);assert.equal(await call(commands.pressKey,{key:'Enter',session:'commands'}),undefined);
  assert.ok((await call(commands.waitFor,{pattern:'got:Ada',literal:true,session:'commands'})).line.includes('got:Ada'));
  assert.equal(await call(commands.resize,{cols:80,rows:8,session:'commands'}),undefined);
  assert.equal((await call(commands.readScreen,{session:'commands'})).size.cols,80);
  assert.ok((await call(commands.readHistory,{session:'commands',last:2})).lines.join('\n').includes('got:Ada'));
  assert.equal((await call(commands.getSession,{session:'commands'})).pid,created.pid);assert.equal((await call(commands.listSessions,{})).sessions.length,1);
  await call(commands.fill,{text:'done\n',session:'commands'});
  assert.deepEqual(await call(commands.waitForExit,{session:'commands',timeout:1000}),{exitCode:7});
  assert.deepEqual(await call(commands.closeSession,{session:'commands'}),{exitCode:7});
  assert.deepEqual(await call(commands.listSessions,{}),{sessions:[]});
  await call(commands.createSession,{command:'/bin/sh',args:['-c','printf ready; exec sleep 60'],session:'signal',cols:32,rows:4});
  await call(commands.waitFor,{pattern:'ready',literal:true,session:'signal'});assert.equal(await call(commands.sendSignal,{signal:'SIGTERM',session:'signal'}),undefined);
  assert.notEqual((await call(commands.waitForExit,{session:'signal',timeout:1000})).exitCode,null);
 }finally{await runtime.close();}
});
test('command ingress rejects accessors without executing them or resolving sessions',async()=>{
 let getters=0,calls=0;
 const params=Object.defineProperty({session:'x'},'pattern',{enumerable:true,get(){getters++;return 'secret';}});
 await assert.rejects(commands.waitFor.handler({params,terminalPilotRuntime:{resolveSession(){calls++;}}}),/data properties/);
 assert.equal(getters,0);assert.equal(calls,0);
 const invalid=await native.terminalCommandFinish('create-session',{name:'s1',pid:-1},false);assert.equal(invalid.code,-32603);assert.ok(invalid.fault.includes('pid'));
});
