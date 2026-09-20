import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {runCli,isCliInvocation} from '../dist/cli.js';
import {runCli as reference} from '../../tiny-http-mcp-server/dist/cli.js';
import {loadOAuthVerifier} from '../dist/load-oauth-verifier.js';
const native=createRequire(import.meta.url)('../dist/tiny-http-mcp-server-rust.node');
const oracleVerifier={verify:async()=>({scopes:[]})};
async function capture(run,args){
 let stdout='',stderr='';const factories=[],listeners=[],loads=[];
 const verifier=oracleVerifier;
 const result=await run(args,{stdout:{write:value=>{stdout+=value;}},stderr:{write:value=>{stderr+=value;}},createServer:options=>{factories.push({...options,name:'normalized-package-name'});return {listenHttp:async options=>{listeners.push(options);return {url:'http://127.0.0.1:3000/mcp',close:async()=>undefined,closeAllConnections(){}};}};},loadOAuthVerifier:async input=>{loads.push(input);return verifier;},waitForShutdown:async close=>{await close();}});
 return {result,stdout:stdout.replaceAll('tiny-http-mcp-server-rust','tiny-http-mcp-server'),stderr,factories,listeners,loads};
}
test('actual native CLI compares every numeric option and malformed decimal with original',async()=>{
 assert.equal(typeof native.httpCliSpec,'function');
 const flags=['port','max-request-bytes','max-response-bytes','max-batch-size','max-sessions','max-sessions-per-subject','session-ttl-ms','max-streams-per-session','max-stream-buffer-bytes','max-sse-event-history','sse-keep-alive-ms','max-concurrent-tool-calls','max-queued-tool-calls','max-active-requests','request-timeout-ms','headers-timeout-ms','keep-alive-timeout-ms','shutdown-grace-ms'];
 const values=['','0','1',' 0012 ','\ufeff13\u00a0','65535','65536','9007199254740993','99999999999999999999','9'.repeat(400),'-1','+1','0x20','1e2','1.0','1 2','１２','\ud800'];
 for(const flag of flags)for(const value of values){const args=[`--${flag}=${value}`];assert.deepEqual(await capture(runCli,args),await capture(reference,args),args.join(' '));}
 for(const args of [[],['--help'],['-h'],['--version'],['--unknown'],['unexpected'],['--port'],['--max-request-bytes=bad','--port=bad'],['--max-response-bytes=bad','--max-batch-size=bad']])assert.deepEqual(await capture(runCli,args),await capture(reference,args));
});
test('CLI URL, OAuth, repeated and boolean flags match original configuration plans',async()=>{
 const oauth=['--oauth-resource','https://resource.example/mcp','--oauth-authorization-server','https://issuer.example','--oauth-verifier-module','./verify.mjs'];
 const cases=[['--stateless','--json-response','--trusted-proxy','--hostname','::1','--path','/native'],['--allowed-host','localhost','--allowed-host','[::1]','--allowed-origin','https://example.test/path'],['--allowed-origin','not a url'],[],oauth,...['oauth-supported-scope','oauth-required-scope','oauth-bearer-method'].flatMap(flag=>['','   ',' read ','\ud800'].map(value=>[...oauth,`--${flag}`,value])),['--oauth-required-scope','read'],['--oauth-resource','resource'],['--oauth-resource','resource','--oauth-authorization-server','issuer'],[...oauth,'--oauth-authorization-server','https://second.example'],[...oauth,'--oauth-verifier-export',''],[...oauth,'--oauth-verifier-export','named'],['--help','--port','bad'],['--help','--oauth-required-scope','read']];
 for(const args of cases)assert.deepEqual(await capture(runCli,args),await capture(reference,args),args.join(' '));
});
test('CLI signal lifecycle forces or settles once and releases both cleanup callbacks',async()=>{
 for(const action of ['complete','reject','second-signal','deadline','force-throw']){
  let signal,deadline,complete,reject,closes=0,forces=0,cancels=0,removals=0,stdout='',stderr='';
  const closing=new Promise((resolve,fail)=>{complete=resolve;reject=fail;});
  const run=runCli([],{createServer:()=>({listenHttp:async()=>({url:'http://127.0.0.1:3000/mcp',close:()=>{closes++;return closing;},closeAllConnections:()=>{forces++;if(action==='force-throw')throw new Error('force failed');}})}),stdout:{write:value=>{stdout+=value;}},stderr:{write:value=>{stderr+=value;}},listenForShutdownSignals:handler=>{signal=handler;return ()=>{removals++;};},scheduleShutdownGrace:(handler,ms)=>{assert.equal(ms,10000);deadline=handler;return ()=>{cancels++;};}});
  for(let i=0;i<8&&signal===undefined;i++)await Promise.resolve();assert.ok(signal);assert.ok(stdout);
  signal();if(action==='complete')complete();else if(action==='reject')reject(new Error('close failed'));else if(action==='second-signal')signal();else deadline();
  assert.equal(await run,action==='complete'?0:1);assert.equal(closes,1);assert.equal(forces,action==='complete'?0:1);assert.equal(cancels,1);assert.equal(removals,1);
  signal();deadline();complete();await Promise.resolve();assert.equal(forces,action==='complete'?0:1);assert.equal(stderr,action==='reject'?'close failed\n':'');
 }
});
test('verifier loading preserves own-method admission, named/default exports and data modules',async()=>{
 for(const source of ['export default {verify(){return {scopes:[]};}}','export const named={verify(){return {scopes:[]};}}']){
  const verifier=await loadOAuthVerifier({modulePath:'data:text/javascript,'+encodeURIComponent(source),exportName:source.startsWith('export const')?'named':undefined});assert.equal(typeof verifier.verify,'function');
 }
 for(const source of ['export default {}','export default null','export default function verify(){}','export default Object.create({verify(){}})'])await assert.rejects(loadOAuthVerifier({modulePath:'data:text/javascript,'+encodeURIComponent(source)}),/must be an object with a verify\(\) method/);
});
test('CLI invocation follows direct and real paths, including failed realpath lookup',()=>{
 const file='/virtual/native-cli.js',url=pathToFileURL(file).href;
 assert.equal(isCliInvocation(['node',file],url,()=>{throw new Error('missing');}),true);
 assert.equal(isCliInvocation(['node','/virtual/link'],url,()=>file),true);assert.equal(isCliInvocation(['node'],url),false);assert.equal(isCliInvocation(['node','/other'],url,()=>'/other'),false);
});

test('CLI output failure releases the installed shutdown listener before resource cleanup',async()=>{
 let removals=0,closes=0,stderr='';
 const result=await runCli([],{createServer:()=>({listenHttp:async()=>({url:'http://127.0.0.1:3000/mcp',close:async()=>{assert.equal(removals,1);closes++;},closeAllConnections(){}})}),stdout:{write(){throw new Error('output failed');}},stderr:{write(value){stderr+=value;}},listenForShutdownSignals:()=>()=>{removals++;}});
 assert.equal(result,1);assert.equal(removals,1);assert.equal(closes,1);assert.equal(stderr,'output failed\n');
});

test('synchronous forced shutdown callbacks release their late-installed cleanup functions',async()=>{
 let closes=0,forces=0,removals=0,cancels=0;
 const result=await runCli([],{createServer:()=>({listenHttp:async()=>({url:'http://127.0.0.1:3000/mcp',close:async()=>{closes++;},closeAllConnections:()=>{forces++;}})}),stdout:{write(){}},stderr:{write(){}},listenForShutdownSignals:handler=>{handler();return ()=>{removals++;};},scheduleShutdownGrace:handler=>{handler();return ()=>{cancels++;};}});
 assert.equal(result,1);assert.equal(closes,1);assert.equal(forces,1);assert.equal(removals,1);assert.equal(cancels,1);
});
