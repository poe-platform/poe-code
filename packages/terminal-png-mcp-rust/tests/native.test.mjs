import{test}from'node:test';import assert from'node:assert/strict';
import{createTerminalPngMcpServer}from'../dist/index.js';
test('single-addon MCP renders images through the portable core',async()=>{
 const server=createTerminalPngMcpServer();const initialized=await server.handleMessage('initialize',{protocolVersion:'2025-11-25',clientInfo:{name:'test',version:'1'}});assert.equal(initialized.result.serverInfo.name,'terminal-png-mcp');
 const tools=await server.handleMessage('tools/list');assert.equal(tools.result.tools.length,1);assert.equal(tools.result.tools[0].inputSchema.properties.padding.minimum,0);
 for(const options of[{},{padding:0,window:false},{padding:7,window:true}]){const result=await server.handleMessage('tools/call',{name:'render_terminal_png',arguments:{ansiText:'\x1b[32mPassed\x1b[0m\n│ café é │',...options}});assert.equal(result.result.content[0].type,'image');assert.equal(result.result.content[0].mimeType,'image/png');const png=Buffer.from(result.result.content[0].data,'base64');assert.ok(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));assert.ok(png.readUInt32BE(16)>100);}
 for(const args of[{},{ansiText:1},{ansiText:'x',padding:-1},{ansiText:'x',padding:1.5},{ansiText:'x',window:'false'}]){const result=await server.handleMessage('tools/call',{name:'render_terminal_png',arguments:args});assert.ok(result.error||result.result.isError);}
});
test('render work yields to the Node event loop and concurrent calls stay independent',async()=>{
 const server=createTerminalPngMcpServer();await server.handleMessage('initialize',{protocolVersion:'2025-11-25',clientInfo:{name:'test',version:'1'}});let settled=false;const pending=server.handleMessage('tools/call',{name:'render_terminal_png',arguments:{ansiText:Array(16).fill('content and styles').join('\n')}});pending.then(()=>{settled=true;});await new Promise(setImmediate);assert.equal(settled,false);await pending;
 const results=await Promise.all(Array.from({length:8},(_,n)=>server.handleMessage('tools/call',{name:'render_terminal_png',arguments:{ansiText:'call '+n,padding:n}})));assert.equal(new Set(results.map(r=>r.result.content[0].data)).size,8);
});

test('portable CLI grammar matches Node parseArgs acceptance and diagnostics',async()=>{
 const{parseArgs}=await import('node:util'),{createRequire}=await import('node:module'),native=createRequire(import.meta.url)('../dist/terminal-png-mcp-rust.node');
 for(const args of[[],['-h'],['--help'],['-hhh'],['-hx'],['--help=wat'],['--','file'],['--help','--x'],['--no-help'],['-h=true'],['-'],['--'],['file']]){let value,error;try{value=parseArgs({args,options:{help:{type:'boolean',short:'h'}}}).values.help??false;}catch(e){error=e.message;}if(error)assert.throws(()=>native.terminalPngMcpCli(args),e=>e.message===error);else assert.equal(native.terminalPngMcpCli(args),value);}
});
test('official MCP SDK client discovers and decodes the native image tool',async()=>{
 const{Client}=await import('@modelcontextprotocol/sdk/client/index.js'),{InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');const server=createTerminalPngMcpServer(),[clientTransport,serverTransport]=InMemoryTransport.createLinkedPair(),connection=server.connectSDK(serverTransport),client=new Client({name:'native-render-reference',version:'1'});
 try{await client.connect(clientTransport);const tools=await client.listTools();assert.equal(tools.tools[0].name,'render_terminal_png');const image=await client.callTool({name:'render_terminal_png',arguments:{ansiText:'\x1b[32mReady\x1b[0m',padding:0,window:false}});assert.equal(image.content[0].mimeType,'image/png');assert.ok(Buffer.from(image.content[0].data,'base64').readUInt32BE(16)>100);}finally{await client.close();await connection;}
});
