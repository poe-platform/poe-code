import{createRequire}from'node:module';
import{createServer,Image}from'./stdio-server.js';
const native=createRequire(import.meta.url)('./terminal-png-mcp-rust.node');
export function createTerminalPngMcpServer(){const tool=native.terminalPngToolDefinition();return createServer({name:'terminal-png-mcp',version:'0.1.0'}).tool(tool.name,tool.description,tool.inputSchema,async args=>Image.fromBytes(await native.renderTerminalMcpPng(JSON.stringify(args)),'image/png'));}
