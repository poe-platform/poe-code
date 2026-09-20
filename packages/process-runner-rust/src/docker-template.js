import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {native} from './native.js';
import {detectEngine} from './docker-engine.js';
import {detectContext,buildContextArgs} from './docker-context.js';
import {createHostRunner} from './host-runner.js';
import {readDockerBuildContextFiles} from './docker-build-context.js';
export async function buildDockerRuntimeTemplate(input) {
 const runner=input.runner??createHostRunner(),engine=input.runtime.engine??detectEngine(),context=detectContext();
 const dockerfile=path.resolve(input.cwd,input.runtime.dockerfile??path.join('.poe-code','Dockerfile')),directory=path.resolve(input.cwd,input.runtime.build_context??'.');
 const cwd=await realpath(input.cwd),dockerfilePath=await realpath(dockerfile),buildContext=await realpath(directory);
 for(const [field,target]of[['runtime.dockerfile',dockerfilePath],['runtime.build_context',buildContext]]){const relative=path.relative(cwd,target);if(!native.dockerTemplatePathInside(relative,path.isAbsolute(relative)))throw new Error(`${field} must remain inside runtime cwd ${cwd}.`);}
 const dockerfileBytes=await readFile(dockerfilePath),files=await readDockerBuildContextFiles(buildContext),buildArgs=input.runtime.build_args??{},pairs=Object.entries(buildArgs).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({key,value}));
 const plan=new native.DockerTemplate(dockerfileBytes,files.map(file=>({path:file.relativePath,bytes:file.bytes})),pairs,engine),hash=plan.hash,cached=input.force?null:await input.state?.templates.get('docker',hash);
 if(cached?.image!==undefined){const handle=runner.exec({command:engine,args:[...buildContextArgs(engine,context),'image','inspect',cached.image],stdout:'pipe',stderr:'pipe'}),result=await handle.result;if(plan.cached(!!input.force,cached.image,result.exitCode))return{backend:'docker',hash,image:cached.image,cached:true};}
 const image=plan.image,args=plan.buildArgs(engine,context??undefined,dockerfilePath,buildContext,Object.entries(input.runtime.build_args??{}).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({key,value}))),handle=runner.exec({command:engine,args,stdout:'pipe',stderr:'pipe'});
 const stdout=readStream(handle.stdout),stderr=readStream(handle.stderr),result=await handle.result;await stdout;
 if(result.exitCode!==0){const errorOutput=await stderr;throw new Error(`Command failed with exit code ${result.exitCode}: ${engine} ${args.join(' ')}${errorOutput?'\n'+errorOutput:''}`);}
 await input.state?.templates.put('docker',{hash,image,runtime_type:'docker',dockerfile_path:dockerfilePath,built_at:new Date().toISOString()});
 return{backend:'docker',hash,image,cached:false};
}
async function readStream(stream){if(stream===null)return'';stream.setEncoding('utf8');const chunks=[];for await(const chunk of stream)chunks.push(String(chunk));return chunks.join('');}
