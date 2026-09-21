#!/usr/bin/env node
import{createRequire}from'node:module';import{fileURLToPath}from'node:url';import{realpathSync}from'node:fs';import{createTerminalPngMcpServer}from'./index.js';
const native=createRequire(import.meta.url)('./terminal-png-mcp-rust.node');
export async function runCli(args=process.argv.slice(2),output=process.stderr){let help;try{help=native.terminalPngMcpCli(args);}catch(error){output.write(`${error instanceof Error?error.message:String(error)}\nRun with --help for usage.\n`);return 1;}if(help){output.write(native.terminalPngMcpHelp());return 0;}await createTerminalPngMcpServer().listen();return 0;}
let isCli=false;try{isCli=process.argv[1]!==undefined&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url));}catch{}if(isCli)process.exitCode=await runCli();
