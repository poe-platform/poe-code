import {readFile} from 'node:fs/promises';
import {posix} from 'node:path';
import {transform} from 'esbuild';
import ts from 'typescript';
import {Volume} from 'memfs';
import {expect, it} from 'vitest';

it('loads the disposable image inventory receipt with only its copied runtime modules', async()=>{
 const root=new URL('../../../',import.meta.url);
 const dockerfile=await readFile(new URL('packages/media-cli/server/Dockerfile',root),'utf8');
 const stages=new Map<string,{base:string;lines:string[]}>();let selected='';
 for(const line of dockerfile.split('\n')){
  const tokens=line.split(' ').filter(Boolean);
  if(tokens[0]==='FROM'){
   selected=tokens[tokens.length-1];
   stages.set(selected,{base:tokens[tokens.length-3],lines:[]});
  }else stages.get(selected)?.lines.push(line);
 }
 const inherited:string[]=[];
 while(stages.has(selected)){
  const stage=stages.get(selected)!;inherited.unshift(...stage.lines);selected=stage.base;
 }
 const volume=new Volume();
 for(const line of inherited){
  const [instruction,source,destination]=line.split(' ');
  if(instruction!=='COPY')continue;
  const sourcePath=source.includes('/dist/')?source.split('/dist/').join('/src/').slice(0,-3)+'.ts':source;
  let contents=await readFile(new URL(sourcePath,root),'utf8');
  if(sourcePath.endsWith('.ts'))contents=(await transform(contents,{loader:'ts',format:'esm'})).code;
  volume.mkdirSync(posix.dirname(destination),{recursive:true});volume.writeFileSync(destination,contents);
 }
 const visited=new Set<string>();
 function link(path:string){
  if(visited.has(path))return;visited.add(path);
  const source=ts.createSourceFile(path,volume.readFileSync(path,'utf8') as string,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  for(const statement of source.statements){
   if(!ts.isImportDeclaration(statement)&&!ts.isExportDeclaration(statement))continue;
   const specifier=statement.moduleSpecifier;if(!specifier||!ts.isStringLiteral(specifier))continue;
   const name=specifier.text;if(name.startsWith('node:'))continue;
   let target=posix.resolve(posix.dirname(path),name);
   if(name.startsWith('@')){
     const parts=name.split('/');const packageRoot='/app/node_modules/'+parts.slice(0,2).join('/');
     const manifest=JSON.parse(volume.readFileSync(packageRoot+'/package.json','utf8') as string);
     const key=parts.length===2?'.':'./'+parts.slice(2).join('/');
     const entry=manifest.exports[key];target=posix.resolve(packageRoot,typeof entry==='string'?entry:entry.node??entry.default);
   }
   link(target);
  }
 }
 link('/app/build-receipt.js');
 expect(visited.size).toBeGreaterThan(1);
});
