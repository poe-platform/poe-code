import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {Command} from 'commander';
import {isServeToolName,SERVE_TOOL_NAMES} from '../../tiny-stdio-mcp-test-server/dist/cli-support.js';
const own=fileURLToPath(new URL('../dist/cli.js',import.meta.url)),native=createRequire(import.meta.url)('../dist/tiny-stdio-mcp-test-server-rust.node');
const testEnv={...process.env};for(const name of Object.keys(testEnv))if(name.startsWith('TOOLCRAFT_TEST_'))delete testEnv[name];
function oracle(args){
 let stdout='',stderr='',exitCode=0,tool;
 const command=new Command().name('tiny-stdio-mcp-test-server-rust').description('Test MCP server with example tools for integration testing').version('0.1.0').exitOverride().configureOutput({writeOut:value=>stdout+=value,writeErr:value=>stderr+=value});
 command.command('serve').description('Start an MCP server on stdin/stdout').argument('<tool>','Tool to serve (encrypt, word-of-the-day)').action(value=>{
  if(isServeToolName(value))tool=value;else{exitCode=1;stderr+=`Unknown tool: ${value}. Available: ${SERVE_TOOL_NAMES.join(', ')}\n`;}
 });
 try{command.parse(args,{from:'user'});}catch(error){exitCode=error.exitCode;}
 return tool===undefined?{exitCode,stdout,stderr}:{tool};
}
test('native CLI preserves Commander development oracle help, version and rejection ordering',()=>{
 const cases=[[],['--help'],['-h'],['serve','--help'],['help'],['help','serve'],['help','missing'],['--version'],['-V'],['serve','--version'],['serve'],['serve','constructor'],['serve','__proto__'],['serve','toString'],['serve','missing'],['missing'],['serv'],['serve','encrypt','extra'],['serve','encrypt','--bad'],['--bad','--help'],['serve','--help','--bad'],['serve','--version','--help'],['--version','--help'],['serve','-h'],['serve','-V'],['--help','serve'],['missing','--help'],['help','serve','extra'],['help','help'],['serve','--','--help'],['serve','-hV'],['--help','--version'],['serve','--ver'],['serve','--help=bad'],['serve','--bad','encrypt'],['serve','--','constructor'],['serve','encrypt'],['serve','word-of-the-day']];
 for(const value of ['--versoin','--hel','--helpful','--version=1','-VH','-hv','-hV','--','hel','srve','hepl','helper','x','\ud800','9'.repeat(1000)])for(const prefix of [[],['serve'],['help'],['serve','encrypt']])cases.push([...prefix,value]);
 for(const args of cases){
  assert.deepEqual(native.fixtureCliPlan(args,'tiny-stdio-mcp-test-server-rust','0.1.0'),oracle(args),args.join(' '));
 }
});
test('native stdio subprocess streams initialize, list and calls and exits on EOF',async()=>{
 for(const tool of ['encrypt','word-of-the-day']){
  const child=spawn(process.execPath,[own,'serve',tool],{stdio:['pipe','pipe','pipe'],env:{...testEnv,TOOLCRAFT_TEST_STARTUP_DELAY_MS:'1'}});
  let output='',errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));}),timer=setTimeout(()=>child.kill('SIGKILL'),2000);
  try{
   for(const message of [{id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'stdio-process-test',version:'1'}}},{method:'notifications/initialized'},{id:2,method:'tools/list',params:{}},{id:3,method:'tools/call',params:{name:tool==='encrypt'?'caesar_cipher_encrypt':'word_of_the_day',arguments:tool==='encrypt'?{text:'Hello, World!'}:{}}}])child.stdin.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');
   child.stdin.end();assert.deepEqual(await done,{code:0,signal:null});assert.equal(errors,'');
   const messages=output.trim().split('\n').map(line=>JSON.parse(line));assert.equal(messages.length,3);assert.equal(messages.find(message=>message.id===2).result.tools.length,1);assert.equal(messages.find(message=>message.id===3).result.content[0].text,tool==='encrypt'?'Khoor, Zruog!':'Bumfuzzle - to confuse or fluster someone');
  }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await done;}}
 }
});
