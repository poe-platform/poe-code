import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const mode=process.argv[2];
if(mode==='type'){console.log(process.env.DIAGNOSTIC_FILE+'(1,2): error TS2345: intended independent diagnostic');process.exitCode=2;}
else{const loader=await import('./loader.mjs');if(mode==='positive'){const resolved=await loader.resolve('virtual-bash',{},()=>{throw Error('unexpected delegation');});assert.equal(resolved.url,pathToFileURL(process.env.FIXTURE_TARGET).href);const result=await loader.load(resolved.url,{},()=>{throw Error('unexpected delegation');});assert.equal(result.shortCircuit,true);assert.equal(result.format,'module');assert.equal(Buffer.from(result.source).toString(),'export const harmless = 1;\n');console.log('LOADER_BODY_OK_NO_EVALUATION');}else await loader.load(pathToFileURL(process.env.FIXTURE_TARGET).href,{},()=>{throw Error('unexpected delegation');});}
