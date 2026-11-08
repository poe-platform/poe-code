import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isBuiltin} from 'node:module';
const repo='/Users/kjopek/Workspace/safe-bash';
const helperFile=fileURLToPath(import.meta.url),own=path.dirname(helperFile);
const oldRelative='tests/compatibility/final-coherent-producer-independent-20260829/data-completion-v3/review.mjs';
const oldCommit='41ec33405ba30df2435b4c0615ade7249f07d60a';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function publish(name,value){const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');assert(bytes.length<2097152);fs.writeFileSync(path.join(own,name),bytes,{flag:'wx'});}
function classifyDeclaredBuiltin(edge){assert.equal(edge.kind,'literal dynamic module');assert((edge.from==='dist/commands/internal.d.ts'&&edge.target==='util')||(edge.from==='dist/contracts/path.d.ts'&&edge.target==='path'));assert(isBuiltin(edge.target));return edge.target;}
function mapOrigins(name,map,sourceMap){assert(typeof name==='string'&&name.startsWith('dist/')&&name.endsWith('.map'));assert(map&&typeof map==='object'&&Array.isArray(map.sources));const root=map.sourceRoot===undefined?'':map.sourceRoot;assert(typeof root==='string'&&!path.posix.isAbsolute(root)&&!root.includes('\\')&&!root.includes('\0')&&!root.includes(':'));const seen=new Set();return map.sources.map(source=>{assert(typeof source==='string'&&source.length>0&&!path.posix.isAbsolute(source)&&!source.includes('\\')&&!source.includes('\0')&&!source.includes(':'));const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(name),root,source));assert(sourceMap.has(resolved),'map source outside frozen input set: '+resolved);assert(!seen.has(resolved),'duplicate normalized map source');seen.add(resolved);return resolved;});}
try{
 const metadata=spawnSync('/usr/bin/git',['-c','gc.auto=0','-c','maintenance.auto=false','cat-file','blob',oldCommit+':'+oldRelative],{cwd:repo,maxBuffer:1048576,timeout:10000});publish('source-git.stdout',metadata.stdout);publish('source-git.stderr',metadata.stderr);assert.equal(metadata.status,0);assert.equal(metadata.signal,null);assert(!metadata.error);
 const oldPath=path.join(repo,oldRelative),stat=fs.lstatSync(oldPath);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===metadata.stdout.length);assert.deepEqual(fs.readFileSync(oldPath),metadata.stdout);
 let source=metadata.stdout.toString();const originalHash=hash(metadata.stdout);
 function replaceOnce(before,after){assert.equal(source.split(before).length,2,'unique source replacement required: '+before.slice(0,70));source=source.replace(before,after);}
 assert.equal((source.match(/^import /gm)??[]).length,7);source=source.split('\n').filter(line=>!line.startsWith('import ')).join('\n');source=source.replaceAll('fileURLToPath(import.meta.url)','helperFile');
 const start=source.indexOf(" test('P01-single-star-contracts'");const end=source.indexOf(' assert(checks.every(row=>row.pass));',start);assert(start>0&&end>start);
 source=source.slice(0,start)+` test('B01-exact-declaration-builtins',()=>{for(const edge of [{from:'dist/commands/internal.js',target:'util',kind:'literal dynamic module'},{from:'dist/commands/other.d.ts',target:'util',kind:'literal dynamic module'},{from:'dist/contracts/path.d.ts',target:'arbitrary-module',kind:'literal dynamic module'}])assert.throws(()=>classifyDeclaredBuiltin(edge));assert.equal(classifyDeclaredBuiltin({from:'dist/commands/internal.d.ts',target:'util',kind:'literal dynamic module'}),'util');});
 test('B02-map-origin-escape-unknown',()=>{const known=new Map([['src/example.ts',Buffer.from('')]]);assert.deepEqual(mapOrigins('dist/example.js.map',{sources:['../src/example.ts']},known),['src/example.ts']);for(const invalid of ['/src/example.ts','../../outside.ts','../src/missing.ts','file:///src/example.ts'])assert.throws(()=>mapOrigins('dist/example.js.map',{sources:[invalid]},known));});
 test('B03-map-duplicates-types',()=>{const known=new Map([['src/example.ts',Buffer.from('')]]);assert.throws(()=>mapOrigins('dist/example.js.map',{sources:['../src/example.ts','../src/./example.ts']},known));assert.throws(()=>mapOrigins('dist/example.js.map',{sourceRoot:null,sources:['../src/example.ts']},known));assert.throws(()=>mapOrigins('dist/example.js.map',{sources:[{}]},known));});
`+source.slice(end);
 replaceOnce('const edgeKinds={};for(const edge of closure.edges)','const edgeKinds={},bareDeclarationCounts={util:0,path:0};for(const edge of closure.edges)');
 replaceOnce("else assert(edge.target.startsWith('node:'),'nonrelative nonbuiltin needs separate authority');","else if(edge.target.startsWith('node:'))assert(isBuiltin(edge.target));else bareDeclarationCounts[classifyDeclaredBuiltin(edge)]++;");
 replaceOnce('assert.equal(closure.edges.length,1259);','assert.deepEqual(bareDeclarationCounts,{util:2,path:1});assert.equal(closure.edges.length,1259);');
 replaceOnce('sourceMap.set(row.path,bytes);','assert(!sourceMap.has(row.path));sourceMap.set(row.path,bytes);');
 const mapStart=source.indexOf(' const maps=[];for(const [name,row]of members)'),mapEnd=source.indexOf(' assert.equal(data.compilerExit',mapStart);assert(mapStart>0&&mapEnd>mapStart);
 source=source.slice(0,mapStart)+` const maps=[];for(const [name,row]of members){if(!name.endsWith('.map'))continue;const map=JSON.parse(row.body);const resolvedSources=mapOrigins(name,map,sourceMap);for(let index=0;index<resolvedSources.length;index++)if(map.sourcesContent?.[index]!==undefined&&map.sourcesContent[index]!==null)assert.equal(map.sourcesContent[index],sourceMap.get(resolvedSources[index]).toString());maps.push({path:name,sources:resolvedSources});}
`+source.slice(mapEnd);
 replaceOnce('checks,decodes,decodedBytes:decoded.length,exportBindings,edgeKinds,','checks,decodes,decodedBytes:decoded.length,exportBindings,edgeKinds,bareDeclarationCounts,');
 source=source.replace("'P01-single-star-contracts','P02-escape-private-pattern','P03-malformed-empty-pattern'","'B01-exact-declaration-builtins','B02-map-origin-escape-unknown','B03-map-duplicates-types'");
 source=source.replace('Three new pattern/escape controls pass.','Three new declaration/map-origin controls pass; prior three pattern controls are retained, not rerun.');
 source=source.replace('Original52891ffe export-pattern failure and earlier inspection failure remain unchanged;','Original52891ffe export-pattern failure,41ec33405 declaration-classification HOLD and earlier inspection failure remain unchanged;');
 publish('SUPPLEMENT-PRESEAL.json',{oldCommit,oldRelative,originalSourceSha256:originalHash,transformedSourceSha256:hash(Buffer.from(source)),helperSha256:hash(fs.readFileSync(helperFile)),classification:'Exactly2 util in dist/commands/internal.d.ts and1 path in dist/contracts/path.d.ts; literal dynamic module typing edges only. isBuiltin checked. Author builtin:false retained as metadata qualification.',sourceMaps:'Resolve typed sourceRoot/sources relative to map origin into exact frozen SOURCE-INPUTS, not shipping; reject unknown/escape/duplicate normalized origins.',controls:['B01','B02','B03'],runtime:0,roles:{helper:1,gitMetadata:3,syntaxOnly:1,ceilingKnownOS:14,peak:3},historical:'v3 exit1/3controls preserved; no product/build/pack/smoke rerun'});
 publish('EXECUTION-SOURCE.mjs.data',source);
 new Function('fs','path','crypto','zlib','assert','spawnSync','fileURLToPath','helperFile','classifyDeclaredBuiltin','mapOrigins','isBuiltin',source)(fs,path,crypto,zlib,assert,spawnSync,fileURLToPath,helperFile,classifyDeclaredBuiltin,mapOrigins,isBuiltin);
}catch(reason){console.error(reason);publish('CONSTRUCTION-FAILURE.json',{primaryPresent:true,detail:String(reason),stack:reason?.stack});process.exitCode=1;}
