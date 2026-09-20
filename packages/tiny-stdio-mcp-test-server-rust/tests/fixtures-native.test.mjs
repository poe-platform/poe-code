import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {caesarEncrypt,createTestServer,createEncryptServer,createWordOfTheDayServer} from '../dist/index.js';
import * as reference from '../../tiny-stdio-mcp-test-server/dist/index.js';
import {getNextSpawnCount,isServeToolName,SERVE_TOOL_NAMES} from '../dist/cli-support.js';
const native=createRequire(import.meta.url)('../dist/tiny-stdio-mcp-test-server-rust.node');

test('actual addon cipher preserves UTF16 and f64 integer behavior against original',()=>{
 assert.equal(typeof native.fixtureCaesarEncrypt,'function');
 const text='Hello xyz ABC!\0\ud800\udfff😀é１２';
 for(const shift of [-1e300,-9007199254740992,-79,-27,-26,-1,-0,0,1,3,25,26,27,79,9007199254740992,1e300])assert.equal(caesarEncrypt(text,shift),reference.caesarEncrypt(text,shift));
 for(const shift of [1.5,NaN,Infinity,-Infinity,undefined,null,'3',3n])assert.throws(()=>caesarEncrypt(text,shift),{message:'Caesar cipher shift must be a finite integer'});
 let alphabet='';for(let unit=0;unit<=0xffff;unit++)alphabet+=String.fromCharCode(unit);
 assert.equal(caesarEncrypt(alphabet,13),reference.caesarEncrypt(alphabet,13));
});

test('spawn count and tool admission reject unsafe, malformed and inherited values',()=>{
 assert.deepEqual(SERVE_TOOL_NAMES,['encrypt','word-of-the-day']);
 for(const input of [undefined,'','\ufeff0\u00a0','00000012','9007199254740991'])assert.equal(getNextSpawnCount(input),input==='9007199254740991'?9007199254740992:input==='00000012'?13:1);
 for(const input of ['-1','+1','1.5','1e2','abc','１２','\ud800','9007199254740992','9'.repeat(1000)])assert.throws(()=>getNextSpawnCount(input),/must contain a non-negative integer/);
 for(const input of ['constructor','__proto__','toString','encrypt ',''])assert.equal(isServeToolName(input),false);
 assert.equal(isServeToolName('encrypt'),true);assert.equal(isServeToolName('word-of-the-day'),true);
});

async function sessionSnapshot(factory){
 const server=factory(),session=server.createMessageSession();
 try{
  const init=await session.handleMessage('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'native-fixtures',version:'1'}});
  const tools=await session.handleMessage('tools/list',{});
  const calls=[];
  for(const tool of tools.result.tools)calls.push(await session.handleMessage('tools/call',{name:tool.name,arguments:tool.name==='caesar_cipher_encrypt'?{text:'Hello, World!'}:{}}));
  return {init,tools,calls};
 }finally{session.close();}
}
test('all three native server factories match original handshake, schema and text-only results',async()=>{
 for(const name of ['createTestServer','createEncryptServer','createWordOfTheDayServer'])assert.deepEqual(await sessionSnapshot({createTestServer,createEncryptServer,createWordOfTheDayServer}[name]),await sessionSnapshot(reference[name]));
});
