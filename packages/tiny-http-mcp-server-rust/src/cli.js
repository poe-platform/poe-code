#!/usr/bin/env node
import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createHttpServer} from './http-server.js';
import {loadOAuthVerifier} from './load-oauth-verifier.js';
const require=createRequire(import.meta.url),native=require('./tiny-http-mcp-server-rust.node'),packageInfo=require('../package.json');
const spec=native.httpCliSpec();
function absolute(value,flag,origin=false){try{const url=new URL(value);return origin?url.origin:url.toString();}catch{throw new Error(`${flag} must be an absolute URL.`);}}
function options(args){
 const {values}=parseArgs({args,strict:true,allowPositionals:false,options:spec.options}),encoded=JSON.stringify(values);
 const result={...native.httpCliNumbers(encoded),help:values.help??false,version:values.version??false,hostname:values.hostname??'127.0.0.1',path:values.path??'/mcp',stateless:values.stateless??false,jsonResponse:values['json-response']??false,trustedProxy:values['trusted-proxy']??false};
 if(values['allowed-host']?.length)result.allowedHosts=[...values['allowed-host']];
 if(values['allowed-origin']?.length)result.allowedOrigins=values['allowed-origin'].map(value=>absolute(value,'--allowed-origin',true));
 const oauth=native.httpCliOauth(encoded);
 if(oauth!==undefined&&oauth!==null){oauth.resource=absolute(oauth.resource,'--oauth-resource');oauth.authorizationServers=oauth.authorizationServers.map(value=>absolute(value,'--oauth-authorization-server'));result.oauth=oauth;}
 return result;
}
function listenForShutdownSignals(listener){process.on('SIGINT',listener);process.on('SIGTERM',listener);return ()=>{process.off('SIGINT',listener);process.off('SIGTERM',listener);};}
function scheduleShutdownGrace(listener,ms){const timer=setTimeout(listener,ms);return ()=>clearTimeout(timer);}
function waitForShutdown(shutdown,forceShutdown,graceMs,listen,schedule,abortSignal){
 return new Promise((resolve,reject)=>{
  const state=new native.NativeHttpCliShutdown();let cancelGrace=()=>{},removeSignals=()=>{};
  const cleanup=()=>{cancelGrace();removeSignals();abortSignal.removeEventListener('abort',abort);};
  const finish=forced=>{if(!state.settle())return;cleanup();resolve(forced);};
  const abort=()=>finish(false);
  const force=()=>{if(state.settled)return;try{forceShutdown();}catch{}finish(true);};
  const signal=()=>{
   const action=state.signal();
   if(action==='force'){force();return;}if(action==='ignore')return;
   const cancel=schedule(force,graceMs);if(state.settled)cancel();else cancelGrace=cancel;
   void shutdown().then(()=>finish(false),error=>{if(!state.settle())return;cleanup();reject(error);});
  };
  abortSignal.addEventListener('abort',abort,{once:true});
  const remove=listen(signal);if(state.settled)remove();else removeSignals=remove;
 });
}
export function isCliInvocation(argv,moduleUrl,realpath=realpathSync){
 const entry=argv.at(1);if(typeof entry!=='string')return false;
 const paths=[pathToFileURL(entry).href];try{paths.push(pathToFileURL(realpath(entry)).href);}catch{}
 return paths.includes(moduleUrl);
}
export async function runCli(args=process.argv.slice(2),dependencies={}){
 const stdout=dependencies.stdout??process.stdout,stderr=dependencies.stderr??process.stderr;
 let parsed,handle,shutdownAbort,shutdownStarted=false;
 try{parsed=options(args);}catch(error){stderr.write(`${error instanceof Error?error.message:String(error)}\nRun with --help for usage.\n`);return 1;}
 try{
  if(parsed.help){stdout.write(native.httpCliHelp(packageInfo.name)+'\n');return 0;}
  if(parsed.version){stdout.write(packageInfo.version+'\n');return 0;}
  const serverOptions={name:packageInfo.name,version:packageInfo.version};
  if(parsed.stateless)serverOptions.sessionIdGenerator=undefined;if(parsed.jsonResponse)serverOptions.enableJsonResponse=true;if(parsed.trustedProxy)serverOptions.trustedProxy=true;
  for(const field of spec.serverFields)if(parsed[field]!==undefined)serverOptions[field]=parsed[field];
  if(parsed.oauth!==undefined){const {verifierModule,verifierExport,...oauth}=parsed.oauth;oauth.verifier=await (dependencies.loadOAuthVerifier??loadOAuthVerifier)({modulePath:verifierModule,exportName:verifierExport});serverOptions.oauth=oauth;}
  const server=(dependencies.createServer??createHttpServer)(serverOptions),listenOptions={port:parsed.port,hostname:parsed.hostname,path:parsed.path};
  for(const field of spec.listenerFields)if(parsed[field]!==undefined)listenOptions[field]=parsed[field];
  handle=await server.listenHttp(listenOptions);
  const shutdown=async()=>{shutdownStarted=true;await handle.close();};
  const forceShutdown=()=>handle.closeAllConnections();
  if(dependencies.waitForShutdown===undefined)shutdownAbort=new AbortController();
  const waiting=shutdownAbort===undefined?undefined:waitForShutdown(shutdown,forceShutdown,parsed.shutdownGraceMs,dependencies.listenForShutdownSignals??listenForShutdownSignals,dependencies.scheduleShutdownGrace??scheduleShutdownGrace,shutdownAbort.signal);
  stdout.write(handle.url+'\n');
  if(waiting!==undefined)return await waiting?1:0;
  await dependencies.waitForShutdown(shutdown);return 0;
 }catch(error){
  shutdownAbort?.abort();
  if(handle!==undefined){try{if(shutdownStarted)handle.closeAllConnections();else await handle.close();}catch{}}
  stderr.write(`${error instanceof Error?error.message:String(error)}\n`);return 1;
 }
}
if(isCliInvocation(process.argv,import.meta.url))runCli().then(code=>process.exit(code));
