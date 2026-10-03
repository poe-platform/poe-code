import * as native from "../dist/http.js";
import * as original from "toolcraft/http";
import * as nativeHosted from "../dist/http-hosted-oauth.js";
import * as originalHosted from "toolcraft/http/hosted-oauth";
import {S,defineCommand,defineGroup} from "../dist/index.js";
const forward:typeof original=native;
const reverse:typeof native=original;
const hostedForward:typeof originalHosted=nativeHosted;
const hostedReverse:typeof nativeHosted=originalHosted;
const root=defineGroup({name:"app",children:[defineCommand({name:"greet",scope:["mcp"],params:S.Object({name:S.String()}),handler:({params})=>params.name})]});
const server:Promise<native.ToolcraftHTTPServer>=native.createHTTPMCPServer(root,{name:"app",version:"1",sessionIdGenerator:undefined});
const handle:Promise<native.ToolcraftHTTPServerHandle>=native.runHTTPMCP(root,{name:"app",version:"1",port:0});
const storage=nativeHosted.createInMemoryHostedOAuthStorage<{token:string}>({development:true});
const config=nativeHosted.hostedOAuth({publicUrl:"https://issuer.example/mcp",storage,provider:{name:"Example",login:{fields:["apiKey"]},connect:async values=>({accountId:"account",credential:{token:values.apiKey}}),services:async({credentials})=>({credential:await credentials.read()})}});
const hostedRoot=defineGroup<{credential:{token:string}}>({name:"authenticated",children:[]});
native.runHTTPMCP(hostedRoot,{name:"app",version:"1",oauth:config});
original.runHTTPMCP(hostedRoot,{name:"app",version:"1",oauth:config});
// @ts-expect-error HTTP server names remain required
native.createHTTPMCPServer(root,{version:"1"});
// @ts-expect-error in-memory hosted storage requires explicit development admission
nativeHosted.createInMemoryHostedOAuthStorage({development:false});
void [forward,reverse,hostedForward,hostedReverse,server,handle];
