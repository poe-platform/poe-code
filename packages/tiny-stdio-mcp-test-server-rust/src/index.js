import {appendFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer,defineSchema} from './server.js';
const require=createRequire(import.meta.url),native=require('./tiny-stdio-mcp-test-server-rust.node'),{version}=require('../package.json');
const tools=native.fixtureTools(),wordOfTheDay=native.fixtureWordOfTheDay();
export function caesarEncrypt(text,shift){
 if(!Number.isInteger(shift))throw new Error('Caesar cipher shift must be a finite integer');
 return native.fixtureCaesarEncrypt(text,shift);
}
function createFixtureServer(selected){
 const server=createServer({name:'tiny-stdio-mcp-test-server',version});
 for(const tool of tools){
  if(selected!==undefined&&tool.serveName!==selected)continue;
  const execute=tool.serveName==='encrypt'?({text,shift})=>caesarEncrypt(text,shift??3):()=>wordOfTheDay;
  server.tool(tool.name,tool.description,defineSchema(tool.schema),args=>{
   const file=process.env.TOOLCRAFT_TEST_TOOL_CALL_FILE;if(file!==undefined)appendFileSync(file,tool.name+'\n');
   return execute(args);
  });
 }
 return server;
}
export const createEncryptServer=createFixtureServer.bind(undefined,'encrypt');
export const createWordOfTheDayServer=createFixtureServer.bind(undefined,'word-of-the-day');
export const createTestServer=createFixtureServer.bind(undefined,undefined);
