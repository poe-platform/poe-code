import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmCommand} from './command.js';
import reference from './fixtures/prompt-help-0.27.1.json' with {type:'json'};

// History controls are explicitly excluded. Preserve every other native line,
// except stored schema IDs, which belong to the excluded history database.
function stateless(text:string):string {
 return text.split('\n').filter(line=>!['  -d, --database ', '  --log ', '  -c, --continue ', '  --cid, --conversation '].some(prefix=>line.startsWith(prefix)))
  .join('\n').replace('JSON schema, filepath or ID','JSON schema or filepath').replace('Fragment (alias, URL, hash or file path) to','Fragment (URL, file path or loader) to');
}
for(const row of reference.cases)test(`pinned stateless prompt help ${JSON.stringify(row.args)}`,async()=>{
 let out='',err='';
 const result=await createLlmCommand().execute({command:'llm',args:row.args,fs:new MemoryFileSystem(),cwd:'/',env:{LLM_TOOLS_DEBUG:'invalid'},signal:new AbortController().signal,
 stdin:{[Symbol.asyncIterator](){return assert.fail('help acquired stdin');}},
 stdout:{async write(bytes){out+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){err+=new TextDecoder().decode(bytes);}}});
 assert.equal(result.exitCode,row.exitCode,err);
 assert.equal(out,row.exitCode===0?stateless(row.output):'');
 assert.equal(err,row.exitCode===0?'':row.output);
});
