import { expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { defineCommand, defineGroup } from "./index.js";
import { createServer, type ToolHandler } from "tiny-stdio-mcp-server";
import { createMCPServer, createMCPServerForTransport } from "./mcp.js";

it("exposes request cancellation to ordinary MCP command handlers", async () => {
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<string>();
  const cancelled = vi.fn();
  let observed: AbortSignal | undefined;
  const command = defineCommand({
    name: "work", scope: ["mcp"], params: S.Object({}),
    handler(context) {
      observed = context.signal;
      observed?.addEventListener("abort", cancelled, { once: true });
      entered.resolve();
      return finish.promise;
    }
  });
  const session = createMCPServer(defineGroup({ name: "root", children: [command] }), {
    name: "root", version: "1", errorReports: false
  }).createMessageSession(() => undefined);
  const controller = new AbortController();
  const operation = session.handleMessage("tools/call", {
    name: "root__work", arguments: {},
    _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} }
  }, { requestId: 1, signal: controller.signal });
  try {
    await entered.promise;
    expect(observed).toBeInstanceOf(AbortSignal);
    controller.abort();
    await operation;
    expect(observed?.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalledTimes(1);
  } finally {
    controller.abort();
    finish.resolve("done");
    await operation;
    session.close();
  }
});

it("does not start a handler after cancellation during request service resolution", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const commandHandler = vi.fn(() => "done");
  let handler: ToolHandler | undefined;
  await createMCPServerForTransport(defineGroup({
    name: "root", children: [defineCommand({
      name: "work", scope: ["mcp"], params: S.Object({}), handler: commandHandler
    })]
  }), { name: "root", version: "1", errorReports: false }, {
    createServer(options) {
      const server = createServer(options);
      vi.spyOn(server, "registerTool").mockImplementation((_definition, registered) => {
        handler = registered;
        return server;
      });
      return server;
    },
    async requestServices() {
      entered.resolve();
      await release.promise;
      return {};
    }
  });
  const controller = new AbortController();
  const operation = Promise.resolve(handler!({}, { signal: controller.signal, clientCapabilities: {} }));
  await entered.promise;
  controller.abort();
  release.resolve();
  await expect(operation).rejects.toMatchObject({ name: "AbortError" });
  expect(commandHandler).not.toHaveBeenCalled();
});
