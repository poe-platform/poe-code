import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import type { HttpTransportFetch } from "tiny-mcp-client";
import { accessRemoteMcpResources, createRemoteMcpCommands, fetchRemoteMcpSchema, resolveRemoteMcpSchemas, type RemoteMcpServer } from "./index.js";

const tools = [{ name: "echo", inputSchema: { type: "object" } }];
const routes = ["schema", "registry", "command", "resource"] as const;
const fields = ["name", "url", "transport", "protocolVersion", "instructions", "headers", "oauth"] as const;
it.each(routes.flatMap(route => fields.filter(field => route !== "resource" || (field !== "name" && field !== "instructions")).map(field => ({ route, field }))))(
  "retains hidden server $field through $route", async ({ route, field }) => {
    const url = "https://catalog.example/mcp", mode = field === "transport" ? "sse" : "http";
    const methods: string[] = [], cancel = vi.fn(); let events!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const oauth: NonNullable<RemoteMcpServer["oauth"]> = { provider: {
      authorizeRequest: ({ headers }) => { headers.set("Authorization", "Bearer original-grant"); }, handleUnauthorized: () => ({ action: "fail" })
    } };
    const server: RemoteMcpServer = { name: "catalog", url, transport: mode, protocolVersion: "2025-03-26", instructions: "original guidance 005930", headers: { "X-Tenant": "original" }, oauth };
    Object.defineProperty(server, field, { enumerable: false });
    const fetch = vi.fn<HttpTransportFetch>(async (target, init) => {
      expect(new Headers(init?.headers).get("X-Tenant")).toBe("original");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer original-grant");
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (mode === "sse" && init?.method === "GET") {
        expect(String(target)).toBe(url);
        return new Response(new ReadableStream({ start(controller) { events = controller; events.enqueue(encoder.encode("event: endpoint\ndata: /messages\n\n")); }, cancel }), { headers: { "Content-Type": "text/event-stream" } });
      }
      expect(String(target)).toBe(mode === "sse" ? "https://catalog.example/messages" : url);
      if (init?.method === "GET") return new Response(null, { status: 405 });
      const rpc = JSON.parse(String(init?.body)); methods.push(rpc.method);
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      expect(rpc.method).not.toBe("server/discover");
      const result = rpc.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "owned", version: "1" }, instructions: "remote guidance" }
        : rpc.method === "tools/list" ? { tools } : rpc.method === "tools/call" ? { content: [{ type: "text", text: "005930" }] } : { contents: [{ uri: "memo://005930", text: "complete" }] };
      const reply = { jsonrpc: "2.0", id: rpc.id, result };
      if (mode === "sse") { events.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(reply)}\n\n`)); return new Response(null, { status: 202 }); }
      return Response.json(reply, { headers: { "Mcp-Session-Id": "owned" } });
    });
    if (route === "schema" || route === "registry") {
      const result = route === "schema" ? await fetchRemoteMcpSchema(server, { fetch }) : (await resolveRemoteMcpSchemas([server], { fetch }))[0];
      expect(result).toMatchObject({ name: "catalog", url, tools, instructions: "original guidance 005930" });
    } else if (route === "resource") expect(await accessRemoteMcpResources(server, { operation: "read", uri: "memo://005930" }, { fetch })).toEqual({ contents: [{ uri: "memo://005930", text: "complete" }] });
    else {
      const commands = await createRemoteMcpCommands([server], { fetch }); expect(commands[0].name).toBe("catalog");
      const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry(commands) });
      try { const help = await shell.exec("catalog --help"); expect(help.stdout).toContain("original guidance 005930"); expect((await shell.exec("catalog echo")).exitCode).toBe(0); }
      finally { await shell.dispose(); }
    }
    expect(methods).toContain("initialize"); if (mode === "sse") expect(cancel).toHaveBeenCalledTimes(route === "command" ? 2 : 1);
  }
);
