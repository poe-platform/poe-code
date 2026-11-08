import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { HttpTransport, McpClient } from "../dist/index.js";
const {NativeHttpTransport} = createRequire(import.meta.url)("../dist/tiny-mcp-client-rust.node");
process.env.TSX_DISABLE_CACHE = "1";
const {tsImport} = await import("tsx/esm/api");
const {HttpTransport: ReferenceTransport} = await tsImport("../../tiny-mcp-client/src/internal.ts", import.meta.url);

test("raw legacy initialization batches retain the revision and close their POST stream", async () => {
  for (const contentType of ["application/json", "text/event-stream"]) {
    for (const Transport of [ReferenceTransport, HttpTransport]) {
      let announce, canceled = 0;
      const get = new Promise(resolve => { announce = resolve; });
      const payload = [{ jsonrpc: "2.0", id: "init", result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "batch", version: "1" } } }];
      const transport = new Transport({ url: "https://legacy.test/mcp", fetch: async (_url, init) => {
        if (init.method === "GET") { announce(new Headers(init.headers).get("MCP-Protocol-Version")); return new Response(null, { status: 405 }); }
        if (init.method === "DELETE") return new Response(null, { status: 204 });
        return contentType === "application/json" ? Response.json(payload, { headers: { "Mcp-Session-Id": "batch" } })
          : new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(payload) + "\n\n")); }, cancel() { canceled++; } }),
            { headers: { "Content-Type": contentType, "Mcp-Session-Id": "batch" } });
      } });
      transport.readable.resume();
      try {
        transport.writable.write(JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-03-26" } }) + "\n");
        assert.equal(await Promise.race([get, transport.closed.then(({ reason }) => { throw reason; })]), "2025-11-25");
        if (contentType === "text/event-stream") {
          await new Promise(resolve => setImmediate(resolve));
          assert.equal(canceled, 1);
        }
      } finally { transport.dispose(); await transport.closed; }
    }
  }
});

test("HTTP tool header schemas ignore unrelated cyclic, bigint and serialization fields", async () => {
  const cases = [() => ({type:"object",extra:1n}), () => {const value={type:"object"};value.extra=value;return value;}, () => ({type:"object",toJSON(){throw new Error("serialization must not run");}}), () => new Date(0), () => Object.assign(Object.create({type:"object"}),{properties:{value:{type:"string","x-mcp-header":"Value"}}})];
  for(const create of cases) {
    const tool={name:"retained",inputSchema:create()};
    for(const Transport of [ReferenceTransport,HttpTransport]) {
      const warnings=[];
      const transport=new Transport({url:"https://resource.test/mcp",fetch:()=>assert.fail("unexpected fetch"),onWarning:value=>warnings.push(value)});
      try {assert.deepEqual(transport.filterTools([tool]),[tool]);assert.deepEqual(warnings,[]);}
      finally {transport.dispose();await transport.closed;}
    }
  }
});

test("native HTTP request churn and duplicate-ID completion leave no active bookkeeping", () => {
  const state=new NativeHttpTransport(1024);
  const line=id=>JSON.stringify({jsonrpc:"2.0",id,method:"ping",params:{_meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}});
  for(let index=0;index<4096;index++) {
    const first=state.prepare(line(index));const second=state.prepare(line(index));
    state.finish(first);assert.equal(state.activeCount,1);
    const cancel=state.prepare(JSON.stringify({jsonrpc:"2.0",method:"notifications/cancelled",params:{requestId:index}}));
    assert.equal(cancel.cancelSlot,second.slot);
    state.finish(second);assert.equal(state.activeCount,0);
  }
  assert.equal(state.dispose().session,null);
  assert.equal(state.dispose(),null);
});

class NodeResponse extends EventEmitter {
  statusCode=200;headers={};chunks=[];headersSent=false;writableEnded=false;destroyed=false;writableLength=0;
  writeHead(status,headers){this.statusCode=status;this.headers={...this.headers,...headers};this.headersSent=true;return this;}
  setHeader(name,value){this.headers[name]=value;return this;}
  getHeader(name){return this.headers[name];}
  write(data){this.chunks.push(data);this.emit("chunk",data);return true;}
  end(data){if(data!==undefined)this.write(data);this.writableEnded=true;this.emit("finish");return this;}
  destroy(){this.destroyed=true;this.emit("close");}
  flushHeaders(){}
}
test("native client interoperates with both HTTP server implementations in legacy and modern modes", async () => {
  const nativeServer=await import("../../tiny-http-mcp-server-rust/dist/index.js");
  const referenceServer=await import("../../tiny-http-mcp-server/dist/index.js");
  for(const protocolVersion of ["2025-03-26","2026-07-28"]) for(const create of [referenceServer.createHttpServer,nativeServer.createHttpServer]) {
    const server=create({name:"cross",version:"1",enableJsonResponse:true,sessionIdGenerator:()=>"cross-session",sseKeepAliveMs:0});
    server.tool("echo","Echo",{type:"object",properties:{text:{type:"string","x-mcp-header":"Text"}}},args=>args.text);
    const methods=[];
    const transport=new HttpTransport({url:"http://127.0.0.1/mcp",fetch:async(_url,init)=>{
      methods.push(init.method);
      const request=Readable.from(init.body===undefined?[]:[String(init.body)]);
      Object.assign(request,{headers:{host:"127.0.0.1",...Object.fromEntries(new Headers(init.headers))},method:init.method,url:"/mcp",socket:{}});
      const response=new NodeResponse();
      await server.handleRequest(request,response);
      const body=response.statusCode===204?null:new ReadableStream({
        start(controller){
          const encoder=new TextEncoder();
          for(const chunk of response.chunks)controller.enqueue(encoder.encode(String(chunk)));
          response.on("chunk",chunk=>controller.enqueue(encoder.encode(String(chunk))));
          const close=()=>{try{controller.close();}catch{/* Already cancelled. */}};
          response.once("finish",close);response.once("close",close);
          if(response.writableEnded||response.destroyed)close();
        },
        cancel(){request.destroy();response.destroy();}
      });
      return new Response(body,{status:response.statusCode,headers:response.headers});
    }});
    const client=new McpClient({protocolVersion,clientInfo:{name:"cross-client",version:"1"}});
    try {
      await client.connect(transport);
      assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name),["echo"]);
      assert.deepEqual((await client.callTool({name:"echo",arguments:{text:"native 世界"}})).content,[{type:"text",text:"native 世界"}]);
    } finally {await client.close();await transport.closed;}
    assert.equal(methods.filter(method=>method==="DELETE").length,protocolVersion==="2025-03-26"?1:0);
    assert.equal(methods.filter(method=>method==="GET").length,protocolVersion==="2025-03-26"?1:0);
  }
});
