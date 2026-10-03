import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHttpServer,ToolError as HttpToolError} from '../dist/server.js';
import {createServer,ToolError} from 'tiny-stdio-mcp-server-rust';
import {createServer as referenceServer,ToolError as ReferenceToolError} from 'tiny-stdio-mcp-server';

test('HTTP and stdio share the same ToolError constructor',()=>{
  assert.equal(HttpToolError,ToolError);
});

test('HTTP preserves stdio ToolError codes and data without recognizing ordinary error lookalikes',async()=>{
  // Compare the reference stdio error contract with both native transports.
  // A separately installed reference HTTP package can own a different stdio class.
  for(const [create,ErrorType] of [[referenceServer,ReferenceToolError],[createServer,ToolError],[createHttpServer,ToolError]]){
    const server=create({name:'shared-errors',version:'1'});
    server.registerTool({name:'protocol',inputSchema:{type:'object',properties:{}}},()=>{throw new ErrorType(-32091,'credential missing',{reason:'reconnect'});});
    server.registerTool({name:'ordinary',inputSchema:{type:'object',properties:{}}},()=>{throw Object.assign(new Error('ordinary failure'),{code:-32091,data:{reason:'reconnect'}});});
    const session=server.createMessageSession();
    try{
      await session.handleMessage('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}});
      await session.handleMessage('notifications/initialized');
      const failure=await session.handleMessage('tools/call',{name:'protocol',arguments:{}});
      assert.deepEqual(failure.error,{code:-32091,message:'credential missing',data:{reason:'reconnect'}});
      const ordinary=await session.handleMessage('tools/call',{name:'ordinary',arguments:{}});
      assert.equal(ordinary.error,undefined);assert.equal(ordinary.result.isError,true);
    }finally{session.close();}
  }
});
