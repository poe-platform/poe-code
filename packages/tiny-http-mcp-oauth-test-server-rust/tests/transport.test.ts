import {describe,it,expect,vi} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createMcpOAuthTestServer as native} from '../dist/index.js';
import {createMcpOAuthTestServer as sdk} from '../../tiny-http-mcp-oauth-test-server/dist/index.js';
import {installInMemoryHttp,nodeFetch} from '../dist/http/test-support.js';
installInMemoryHttp();
function diagnostic(factory: typeof sdk,options: unknown){try{factory(options as never);return null;}catch(error){return {name:(error as Error).name,message:(error as Error).message};}}
describe('own Rust MCP OAuth fixture transport',()=>{
 it('matches configuration rejection priority and native numeric edge cases',()=>{
  const cases=[{},...['','/','a','a//','/mcp?x','/mcp#x','\ud800'].map(mcpPath=>({mcpPath})),...[0,-1,1.5,Infinity,-Infinity,NaN,1e30].map(ttlSeconds=>({ttlSeconds})),...[[],['mcp.read'],[''],['\u00a0'],['read\twrite'],[' read'],['read '],['read write'],['read\nwrite']].map(scopes=>({scopes})),...['not-url','https://host/oauth','http://host','http://host/oauth?x','http://host/oauth#x','http://[::1]:80/oauth/'].map(issuer=>({issuer})),...['/mcp','https://host/mcp#x','https://host/mcp?x','urn:example:mcp'].map(resource=>({resource})),{mcpPath:'x?y',scopes:[' '],ttlSeconds:0,issuer:'bad'},{scopes:[' '],ttlSeconds:0},{ttlSeconds:0,issuer:'bad'}];
  for(const options of cases)expect(diagnostic(native,options),JSON.stringify(options)).toEqual(diagnostic(sdk,options));
 });
 it('interoperates with the official SDK, enforcing audience, scope and revocation',async()=>{
  const handle=await native({autoApprove:true,scopes:['mcp.read','mcp.write']}).listen();
  const client=new Client({name:'rust-fixture-sdk-reference',version:'1.0.0'});
  try{
   const token=await handle.oauth.issueTokenFor({clientId:'reference',resource:handle.resource,scopes:['mcp.read','mcp.write']});
   await client.connect(new StreamableHTTPClientTransport(new URL(handle.mcpUrl),{fetch:nodeFetch,requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
   const tools=await client.listTools();expect(tools.tools.map(tool=>tool.name)).toContain('echo');
   expect(await client.callTool({name:'echo',arguments:{text:'official SDK'}})).toMatchObject({content:[{type:'text',text:'official SDK'}]});
   handle.oauth.revoke(token);
   await expect(client.listTools()).rejects.toThrow();
   const rejected=await nodeFetch(handle.mcpUrl,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:9,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'bad',version:'1'}}})});
   expect(rejected.status).toBe(401);expect(rejected.headers.get('www-authenticate')).toContain('token revoked');
  }finally{await client.close();await handle.close();}
 });
 it('rejects scope deficits and expires credentials',async()=>{
  const handle=await native({scopes:['mcp.read','mcp.write']}).listen();
  try{
   for(const [scopes,expected]of [[['mcp.read'],403],[['mcp.read','mcp.write'],401]] as const){
    const clock=expected===401?vi.spyOn(Date,'now').mockReturnValue(Date.now()-120000):undefined;
    let token:string;try{token=await handle.oauth.issueTokenFor({clientId:'reference',resource:handle.resource,scopes:[...scopes],ttlSeconds:60});}finally{clock?.mockRestore();}
    const result=await nodeFetch(handle.mcpUrl,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})});
    expect(result.status).toBe(expected);
   }
  }finally{await handle.close();}
 });
 it('resets listener admission after a port collision and bootstrap failure',async()=>{
  const server=native({issuer:'http://127.0.0.1:47101/oauth',resource:'https://resource.example/mcp'}),first=await server.listen({port:47102});
  try{
   await expect(server.listen()).rejects.toThrow('already listening');
   const collision=native({issuer:'http://127.0.0.1:47101/oauth',resource:'https://resource.example/mcp'});
   await expect(collision.listen({port:47103})).rejects.toThrow();
   await first.close();
   const next=await collision.listen({port:47103});await next.close();
  }finally{await first.close();}
 });
 it('keeps copied scopes stable across option mutation and listener replacement',async()=>{
  const scopes=['mcp.read'],server=native({scopes});scopes.push('later');
  const first=await server.listen();await first.close();const second=await server.listen();
  try{
   await first.close();
   const metadata=await (await nodeFetch(second.prmUrl)).json();expect(metadata.scopes_supported).toEqual(['mcp.read']);
  }finally{await second.close();}
 });
});
