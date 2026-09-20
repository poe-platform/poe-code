#!/usr/bin/env node
import {existsSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createEncryptServer,createWordOfTheDayServer} from './index.js';
import {getNextSpawnCount} from './cli-support.js';
const require=createRequire(import.meta.url),native=require('./tiny-stdio-mcp-test-server-rust.node'),info=require('../package.json');
export async function runCli(args=process.argv.slice(2)){
 const parsed=native.fixtureCliPlan(args,info.name,info.version);
 if(parsed.tool===undefined){if(parsed.stdout)process.stdout.write(parsed.stdout);if(parsed.stderr)process.stderr.write(parsed.stderr);return parsed.exitCode;}
 try{
  const countFile=process.env.TOOLCRAFT_TEST_SPAWN_COUNT_FILE;
  if(countFile!==undefined)writeFileSync(countFile,String(getNextSpawnCount(existsSync(countFile)?readFileSync(countFile,'utf8'):undefined)));
  const pidFile=process.env.TOOLCRAFT_TEST_WRAPPER_PID_FILE;if(pidFile!==undefined)writeFileSync(pidFile,String(process.pid));
  const delay=Number(process.env.TOOLCRAFT_TEST_STARTUP_DELAY_MS??'0');if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
  const gate=process.env.TOOLCRAFT_TEST_STARTUP_GATE_FILE;
  if(gate!==undefined){for(;;){try{await access(gate);break;}catch{await new Promise(resolve=>setTimeout(resolve,5));}}}
  const factories=Object.assign(Object.create(null),{'encrypt':createEncryptServer,'word-of-the-day':createWordOfTheDayServer});
  await factories[parsed.tool]().listen();return 0;
 }catch(error){process.stderr.write((error instanceof Error?error.message:String(error))+'\n');return 1;}
}
let entry=process.argv[1];
if(entry!==undefined){try{entry=realpathSync(entry);}catch{}if(pathToFileURL(entry).href===import.meta.url)runCli().then(code=>{process.exitCode=code;});}
