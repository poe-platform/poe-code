#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {native} from './native.js';
import {renderTerminalPng} from './index.js';
export async function main(args=process.argv.slice(2),output={stderr:process.stderr}){
 let options;try{options=native.terminalCliOptions(JSON.stringify(args));}catch(error){output.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);return 1;}
 if(options.help){process.stdout.write(native.terminalCliHelp());return 0;}
 try{const ansi=await readFile(options.input,'utf8');await renderTerminalPng(ansi,{output:options.output,padding:typeof options.padding==='object'?Infinity:options.padding,window:options.window});return 0;}catch(error){output.stderr.write(`Error: ${error instanceof Error?error.message:String(error)}\n`);return 1;}
}
const entry=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:null;
if(entry===import.meta.url)process.exitCode=await main();
