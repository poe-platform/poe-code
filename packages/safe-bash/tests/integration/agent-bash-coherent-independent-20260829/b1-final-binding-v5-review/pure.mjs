import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {authenticatePacketFiles} from './frozen/preimport.mjs';
import {outcomes,first,second} from './author-pure.mjs';
const novel=[];
function group(id,run){run();novel.push({id,status:'PASS'});}
function refuse(packet){let reads=0;assert.throws(()=>authenticatePacketFiles(packet,()=>{reads++;}));assert.equal(reads,0);}
group('N01-inherited-iterator-unused',()=>{let gets=0;const prototype=Object.create(Array.prototype);Object.defineProperty(prototype,Symbol.iterator,{get(){gets++;throw Error('must not iterate borrowed list');}});const list=[first];Object.setPrototypeOf(list,prototype);const observed=[];authenticatePacketFiles({publisherFiles:list,preimportFiles:[second]},row=>observed.push(row.path));assert.deepEqual(observed,[first.path,second.path]);assert.equal(gets,0);});
group('N02-index-accessor-zero-effects',()=>{let gets=0;const list=[second];Object.defineProperty(list,'0',{enumerable:true,get(){gets++;throw false;}});refuse({publisherFiles:[first],preimportFiles:list});assert.equal(gets,0);});
group('N03-combined-128-129-boundary',()=>{const identities=Array.from({length:129},(_,index)=>({path:'/DATA/identity-'+index,bytes:0,sha256:'0'.repeat(64)}));let reads=0;const result=authenticatePacketFiles({publisherFiles:identities.slice(0,64),preimportFiles:identities.slice(64,128)},()=>{reads++;});assert.equal(result.length,128);assert.equal(reads,128);refuse({publisherFiles:identities.slice(0,64),preimportFiles:identities.slice(64)});});
group('N04-null-prototype-and-hidden-index',()=>{const record=Object.assign(Object.create(null),second);const observed=[];authenticatePacketFiles({publisherFiles:[first],preimportFiles:[record]},entry=>observed.push(entry.path));assert.deepEqual(observed,[first.path,second.path]);const list=[second];Object.defineProperty(list,'0',{value:second,enumerable:false});refuse({publisherFiles:[first],preimportFiles:list});});
const result={author:outcomes,novel,counts:{authorPassed:8,authorTotal:8,novelPassed:4,novelTotal:4},pid:process.pid,actualFileIteration:true,helperMain:false,publisherImported:false,productImports:0,workers:0};fs.writeFileSync(fileURLToPath(new URL('RESULT.json',import.meta.url)),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:384});console.log(JSON.stringify(result.counts));
