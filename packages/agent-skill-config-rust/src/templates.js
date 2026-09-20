import {readFile,stat}from'node:fs/promises';import path from'node:path';import {fileURLToPath}from'node:url';import {native}from'./native.js';
const cache=new Map();
export async function loadTemplate(id){
 if(cache.has(id))return cache.get(id);
 const machine=new native.SkillTemplateMachine(id,path.dirname(fileURLToPath(import.meta.url)));let request=machine.start();
 while(true){
  if(Object.hasOwn(request,'error'))throw new Error(request.error);
  switch(request.kind){
   case 'join':request=machine.path(path.join(...request.parts));break;
   case 'parent':request=machine.path(path.dirname(request.path));break;
   case 'read':request=machine.content(await readFile(request.path,'utf8'));break;
   case 'stat':try{await stat(request.path);request=machine.exists(true);}catch(error){if(!(error instanceof Error&&Object.hasOwn(error,'code')&&error.code==='ENOENT'))throw error;request=machine.exists(false);}break;
   case 'done':cache.set(id,request.content);return request.content;
   default:throw new Error(`Unknown native template request ${request.kind}`);
  }
 }
}
export function createTemplateLoader(){return loadTemplate;}
