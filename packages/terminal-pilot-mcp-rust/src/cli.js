#!/usr/bin/env node
import {native} from './native.js';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {main} from './index.js';
export async function runCli(args=process.argv.slice(2),output=process.stderr){
 let help;
 try{help=native.terminalPilotMcpCli(args);}catch(error){output.write(`${error instanceof Error?error.message:String(error)}\nRun with --help for usage.\n`);return 1;}
 if(help){output.write(native.terminalPilotMcpHelp());return 0;}
 await main();return 0;
}
let isCli=false;
try{isCli=process.argv[1]!==undefined&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url));}catch{}
if(isCli)process.exitCode=await runCli();
