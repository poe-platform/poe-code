import {describe,expect,it,vi} from 'vitest';
vi.mock('@modelcontextprotocol/sdk/client/index.js',()=>{throw new Error('SDK is not installed');});
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js',()=>{throw new Error('SDK is not installed');});
vi.mock('tiny-mcp-client',()=>{throw new Error('Original client is not installed');});
import {createTestMcpServer,createHttpTestPair,createHttpTestPairWithTinyClient} from '../dist/testing.js';
import type {HttpServer} from '../dist/index.js';

describe('SDK development oracle remains isolated from standalone native pairs',()=>{
 it('reports missing development SDK before opening a listener',async()=>{
  const listenHttp=vi.fn();
  await expect(createHttpTestPair({listenHttp} as unknown as HttpServer)).rejects.toThrow('createHttpTestPair requires @modelcontextprotocol/sdk');
  expect(listenHttp).not.toHaveBeenCalled();
 });
 it('executes the native pair without either original client or SDK installed',async()=>{
  const pair=await createHttpTestPairWithTinyClient(createTestMcpServer());
  try{
   expect((await pair.client.listTools()).tools).toHaveLength(14);
   await expect(pair.client.callTool({name:'echo',arguments:{text:'native standalone'}})).resolves.toMatchObject({content:[{type:'text',text:'native standalone'}]});
  }finally{await pair.cleanup();}
 });
});
