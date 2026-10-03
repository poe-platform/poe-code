import * as native from "../dist/mcp.js";
import * as original from "toolcraft/mcp";
import {S,defineCommand,defineGroup} from "../dist/index.js";
const forward:typeof original=native;
const reverse:typeof native=original;
const command=defineCommand({name:"greet",scope:["mcp"],params:S.Object({name:S.String()}),handler:({params})=>params.name});
const root=defineGroup({name:"app",children:[command]});
const server=native.createMCPServer(root,{name:"app",version:"1",casing:"camel",errorReports:false});
const session=server.createMessageSession(()=>undefined);
const response=session.handleMessage("tools/list",{});
const running:Promise<void>=native.runMCP(root,{name:"app",version:"1"});
// @ts-expect-error MCP field casing only supports snake and camel
native.createMCPServer(root,{name:"app",casing:"kebab"});
// @ts-expect-error a server name is required
native.createMCPServer(root,{version:"1"});
void [forward,reverse,response,running];
