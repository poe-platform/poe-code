#!/usr/bin/env node
import {readFileSync,realpathSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {native,unwrap,urlInfo,encoded} from './native.js';
import {createMcpOAuthTestServer} from './index.js';
let info={name:'tiny-http-mcp-oauth-test-server-rust',version:'0.0.0'};
try{const parsed=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));if(typeof parsed.name==='string'&&typeof parsed.version==='string')info={name:parsed.name,version:parsed.version};}catch{}
const core=new native.NativeMcpOAuthFixture(),call=(command,input={})=>unwrap(core.call(command,encoded(input))),help=call('cli_help',{name:info.name});
function shutdownWait(shutdown){return new Promise((resolve,reject)=>{const onSignal=()=>{process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);void shutdown().then(resolve,reject);};process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);});}
export function isCliInvocation(argv,moduleUrl,realpath=realpathSync){const entry=argv.at(1);if(typeof entry!=='string')return false;const candidates=[pathToFileURL(entry).href];try{candidates.push(pathToFileURL(realpath(entry)).href);}catch{}return candidates.includes(moduleUrl);}
export async function runCli(args=process.argv.slice(2),dependencies={}){
 const stdout=dependencies.stdout??process.stdout,stderr=dependencies.stderr??process.stderr;let parsed;
 try{const {values}=parseArgs({args,strict:true,allowPositionals:false,options:{port:{type:'string'},hostname:{type:'string'},'mcp-path':{type:'string'},issuer:{type:'string'},resource:{type:'string'},'ttl-seconds':{type:'string'},'auto-approve':{type:'boolean'},scopes:{type:'string'},'print-test-token':{type:'boolean'},help:{type:'boolean',short:'h'}}});parsed=call('cli_options',{values,issuerInfo:urlInfo(values.issuer),resourceInfo:urlInfo(values.resource)});}catch(error){stderr.write(`${error instanceof Error?error.message:String(error)}\n\n${help}\n`);return 1;}
 if(parsed.help){stdout.write(help+'\n');return 0;}
 let handle;
 try{
  handle=await createMcpOAuthTestServer(parsed).listen({port:parsed.port,hostname:parsed.hostname});
  stdout.write(call('cli_startup',{...info,mcpUrl:handle.mcpUrl,prmUrl:handle.prmUrl,issuer:handle.oauth.issuer,resource:handle.resource}));
  if(parsed.printTestToken){const token=await handle.oauth.issueTokenFor({clientId:'demo-client',resource:handle.resource,scopes:parsed.scopes??['mcp.read']});stdout.write(`Test bearer token: ${token}\n`);}
 }catch(error){stderr.write(`${error instanceof Error?error.message:String(error)}\n\n${help}\n`);return 1;}
 await(dependencies.waitForShutdown??shutdownWait)(handle.close);return 0;
}
if(isCliInvocation(process.argv,import.meta.url))void runCli().then(exitCode=>{process.exitCode=exitCode;},error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
