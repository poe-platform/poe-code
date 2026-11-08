import {readdir,readFile}from'node:fs/promises';import path from'node:path';import {native}from'./native.js';
export async function readDockerBuildContextFiles(buildContext){
 const root=await readdir(buildContext,{withFileTypes:true}),entry=root.find(entry=>entry.isFile()&&String(entry.name)==='.dockerignore'),rules=entry===undefined?'':String(await readFile(path.join(buildContext,'.dockerignore'))),matcher=new native.DockerIgnore(rules),files=[];
 async function visit(relativeDir,entries){for(const entry of entries??await readdir(path.join(buildContext,relativeDir),{withFileTypes:true})){const relativePath=path.join(relativeDir,String(entry.name)),dockerPath=relativePath.split(path.sep).join('/');if(entry.isDirectory()){if(!matcher.ignores(dockerPath,true))await visit(relativePath);continue;}if(!entry.isFile()||(dockerPath!=='.dockerignore'&&matcher.ignores(dockerPath,false)))continue;files.push({relativePath:dockerPath,bytes:await readFile(path.join(buildContext,relativePath))});}}
 await visit('',root);return files.sort((left,right)=>left.relativePath.localeCompare(right.relativePath));
}
