#!/usr/bin/env node
import{readFileSync,realpathSync}from'node:fs';import{parseArgs}from'node:util';import{pathToFileURL}from'node:url';import{native}from'./native.js';import{createOAuthTestServer}from'./index.js';
let info={name:'tiny-oauth-test-server-rust',version:'0.0.0'};try{const parsed=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));if(typeof parsed.name==='string'&&typeof parsed.version==='string')info={name:parsed.name,version:parsed.version};}catch{}
const core=new native.NativeOAuthFixture('{}');function call(command,input){const result=JSON.parse(core.call(command,JSON.stringify(input)));if(result.fault)throw new Error(result.fault.message);return result.value;}
const help=call('cli_help',{name:info.name});
function shutdownWait(shutdown){return new Promise((resolve,reject)=>{const onSignal=()=>{process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);void shutdown().then(resolve,reject);};process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);});}
export function isCliInvocation(argv,moduleUrl,realpath=realpathSync){const entry=argv.at(1);if(typeof entry!=='string')return false;const candidates=[pathToFileURL(entry).href];try{candidates.push(pathToFileURL(realpath(entry)).href);}catch{}return candidates.includes(moduleUrl);}
export async function runCli(args=process.argv.slice(2),dependencies={}){
 const stdout=dependencies.stdout??process.stdout,stderr=dependencies.stderr??process.stderr;let parsed;
 try{const{values}=parseArgs({args,strict:true,allowPositionals:false,options:{port:{type:'string'},hostname:{type:'string'},issuer:{type:'string'},'ttl-seconds':{type:'string'},'auto-approve':{type:'boolean'},'static-client':{type:'string',multiple:true},help:{type:'boolean',short:'h'}}});let issuerInfo={};if(values.issuer!==undefined)try{issuerInfo={href:new URL(values.issuer).href};}catch{}parsed=call('cli_options',{values,issuerInfo});}catch(error){stderr.write(`${error instanceof Error?error.message:String(error)}\n\n${help}\n`);return 1;}
 if(parsed.help){stdout.write(help+'\n');return 0;}
 const server=createOAuthTestServer({issuer:parsed.issuer,defaultTokenTtlSeconds:parsed.ttlSeconds,staticClients:parsed.staticClients,defaultAuthorization:{autoApprove:parsed.autoApprove}}),handle=await server.listen({port:parsed.port,hostname:parsed.hostname}),issuer=new URL(server.issuer);
 stdout.write(call('cli_startup',{...info,bound:handle.url,issuer:server.issuer,issuerInfo:{origin:issuer.origin,pathname:issuer.pathname}}));await(dependencies.waitForShutdown??shutdownWait)(handle.close);return 0;
}
if(isCliInvocation(process.argv,import.meta.url))void runCli().then(exitCode=>{process.exitCode=exitCode;},error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
