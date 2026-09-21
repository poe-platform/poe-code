import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {createRequire} from 'node:module';
import {createTerminalPilotMcpServer,createTerminalPilotMCPGroup} from '../dist/index.js';
import {createTerminalPilotRuntime} from '../dist/commands.js';
import {createTerminalPilotMCPGroup as originalGroup} from '../../terminal-pilot-mcp/dist/index.js';
import {createMCPServer} from '../../toolcraft/dist/mcp.js';
const native=createRequire(import.meta.url)('../dist/terminal-pilot-mcp-rust.node');
const initialization={protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}};
async function initialized(server){const session=server.createMessageSession();await session.handleMessage('initialize',initialization);return session;}
test('own standalone server preserves all original tool metadata and group normalization',async()=>{
 const own=createTerminalPilotMcpServer(),original=createMCPServer(originalGroup(),{name:'terminal-pilot',version:'0.0.1',omitRootToolNamePrefix:true});
 const a=await initialized(own),b=await initialized(original);
 try{
  assert.deepEqual((await a.handleMessage('tools/list',{})).result,(await b.handleMessage('tools/list',{})).result);
  const group=createTerminalPilotMCPGroup();assert.equal(group.name,'');assert.deepEqual(group.scope,['mcp']);assert.equal(group.children.length,26);
  assert.ok(group.children.every(c=>c.result?.kind==='object'&&c.scope.length===1&&c.scope[0]==='mcp'&&c.positional.length===0));
 }finally{a.close();b.close();await own.close();}
});
test('both tool names control real PTYs and preserve wire result keys',async()=>{
 const server=createTerminalPilotMcpServer(),session=await initialized(server);
 const call=async(name,args={})=>{const response=await session.handleMessage('tools/call',{name,arguments:args});assert.equal(response.error,undefined,JSON.stringify(response));return response.result;};
 try{
  const created=(await call('terminal_create_session',{command:'/bin/sh',args:['-c','printf "ready\\n"; read value; printf "got:%s\\n" "$value"; exit 7'],session:'wire',cols:60,rows:6})).structuredContent;
  assert.equal(created.session,'wire');assert.ok(created.pid>0);
  assert.equal((await call('wait_for',{pattern:'ready',literal:true,session:'wire'})).structuredContent.matched,true);
  assert.deepEqual((await call('terminal_fill',{text:'Ada\n',session:'wire'})).structuredContent,{});
  assert.ok((await call('terminal_wait_for',{pattern:'got:Ada',literal:true,session:'wire'})).structuredContent.line.includes('got:Ada'));
  assert.deepEqual((await call('wait_for_exit',{timeout:1000,session:'wire'})).structuredContent,{exit_code:7});
  const screen=(await call('terminal_read_screen',{session:'wire'})).structuredContent;
  assert.equal(screen.exit_code,7);assert.equal(screen.size.cols,60);assert.equal(screen.lines.length,6);assert.equal(Object.hasOwn(screen,'exitCode'),false);
  assert.equal((await call('get_session',{session:'wire'})).structuredContent.exit_code,7);
  assert.equal((await call('read_history',{session:'wire'})).structuredContent.exit_code,7);
  assert.deepEqual((await call('terminal_close_session',{session:'wire'})).structuredContent,{exit_code:7});
  assert.deepEqual((await call('list_sessions')).structuredContent,{sessions:[]});
 }finally{session.close();await server.close();}
});
test('invalid input and impossible result become RPC faults before returning content',async()=>{
 let effects=0;
 const runtime={resolveSession(){effects++;throw new Error('unexpected effect');},async createSession(params){effects++;return{name:'s1',session:{pid:-12,command:params.command}};},async close(){}};
 const server=createTerminalPilotMcpServer({terminalPilotRuntime:runtime}),session=await initialized(server);
 try{
  const invalid=await session.handleMessage('tools/call',{name:'terminal_press_key',arguments:{key:'NotAKey'}});
  assert.equal(invalid.error.code,-32602);assert.ok(invalid.error.message.includes('key'));assert.equal(effects,0);
  const badPid=await session.handleMessage('tools/call',{name:'create_session',arguments:{command:'bash'}});
  assert.equal(badPid.error.code,-32603);assert.ok(badPid.error.message.includes('pid'));assert.equal(effects,1);
  assert.deepEqual(native.terminalPilotMcpResult('wait_for_exit',{exitCode:7}),{exit_code:7});
 }finally{session.close();await server.close();}
});
test('stdio EOF closes retained PTYs and repeated explicit close is safe',async()=>{
 const runtime=createTerminalPilotRuntime(),named=await runtime.createSession({command:'/bin/sh',args:['-c','printf ready; exec sleep 60'],session:'eof',cols:32,rows:4});
 await named.session.waitFor('ready',{timeout:1000});
 const server=createTerminalPilotMcpServer({terminalPilotRuntime:runtime}),input=new PassThrough(),output=new PassThrough();output.resume();
 const connected=server.connect({readable:input,writable:output});
 input.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:initialization})+'\n');
 await connected;assert.equal(await runtime.hasRetainedSessions(),false);assert.notEqual(named.session.exitCode,null);await server.close();await server.close();
 assert.equal(input.listenerCount('data'),0);assert.equal(output.listenerCount('drain'),0);
});
test('shutdown blocks terminal admission and failed cleanup can be retried',async()=>{
 let effects=0,cleanup=0;
 const runtime={async listSessions(){effects++;return[];},async close(){cleanup++;if(cleanup===1)throw new Error('cleanup failed');}};
 const server=createTerminalPilotMcpServer({terminalPilotRuntime:runtime}),session=await initialized(server);
 try{
  await assert.rejects(server.close(),/cleanup failed/);
  assert.equal((await session.handleMessage('tools/call',{name:'list_sessions',arguments:{}})).error.code,-32603);
  assert.equal(effects,0);await server.close();await server.close();assert.equal(cleanup,2);
  assert.equal((await session.handleMessage('tools/call',{name:'list_sessions',arguments:{}})).error.code,-32603);assert.equal(effects,0);
 }finally{session.close();await server.close();}
});
test('non-Error runtime failures retain numeric internal fault codes',async()=>{
 const server=createTerminalPilotMcpServer({terminalPilotRuntime:{async listSessions(){throw null;},async close(){}}}),session=await initialized(server);
 try{const response=await session.handleMessage('tools/call',{name:'list_sessions',arguments:{}});assert.equal(response.error.code,-32603);assert.equal(response.error.message,'null');}
 finally{session.close();await server.close();}
});
test('official SDK negotiates the native server and validates structured output schemas',async()=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js'),{InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
 const server=createTerminalPilotMcpServer(),[clientTransport,serverTransport]=InMemoryTransport.createLinkedPair(),connection=server.connect(serverTransport),client=new Client({name:'official',version:'1'});
 try{
  await client.connect(clientTransport);assert.equal(client.getServerVersion().name,'terminal-pilot');
  assert.equal((await client.listTools()).tools.length,26);
  const created=await client.callTool({name:'create_session',arguments:{command:'/bin/sh',args:['-c','printf ready; exit 7'],cols:32,rows:4}});
  assert.ok(created.structuredContent.pid>0);const session=created.structuredContent.session;
  assert.deepEqual((await client.callTool({name:'terminal_wait_for_exit',arguments:{session,timeout:1000}})).structuredContent,{exit_code:7});
  assert.ok((await client.callTool({name:'read_history',arguments:{session}})).structuredContent.lines.join('\n').includes('ready'));
 }finally{await client.close();await connection;}
});
test('CLI carries only JSON-RPC on stdout and stdin EOF terminates its owned process',async()=>{
 const {spawn}=await import('node:child_process');
 const child=spawn(process.execPath,[new URL('../dist/cli.js',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 let text='',stderr='',next=0;const waiting=new Map();
 child.stderr.on('data',data=>{stderr+=data;});
 child.stdout.on('data',data=>{
  text+=data;
  for(let end;(end=text.indexOf('\n'))>=0;){const line=text.slice(0,end);text=text.slice(end+1);const message=JSON.parse(line);assert.equal(message.jsonrpc,'2.0');waiting.get(message.id)?.(message);waiting.delete(message.id);}
 });
 const request=(method,params)=>new Promise(resolve=>{const id=++next;waiting.set(id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 let pid;
 try{
  assert.equal((await request('initialize',initialization)).result.serverInfo.name,'terminal-pilot');
  const created=await request('tools/call',{name:'create_session',arguments:{command:'/bin/sh',args:['-c','printf ready; exec sleep 60'],cols:32,rows:4}});
  pid=created.result.structuredContent.pid;const session=created.result.structuredContent.session;
  assert.equal((await request('tools/call',{name:'wait_for',arguments:{session,pattern:'ready',literal:true}})).result.structuredContent.matched,true);
  child.stdin.end();assert.deepEqual(await exited,{code:0,signal:null});assert.equal(stderr,'');assert.equal(text,'');
  assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
  pid=undefined;
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}if(pid!==undefined){try{process.kill(pid,'SIGKILL');}catch{}}}
});
