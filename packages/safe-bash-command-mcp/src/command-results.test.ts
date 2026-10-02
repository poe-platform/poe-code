import { expect, it, vi } from "vitest";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import type { CallToolResult, Tool } from "tiny-mcp-client";
import { createRemoteMcpCommands, type RemoteMcpCommandOptions } from "./index.js";

const tool: Tool = { name: "export", inputSchema: { type: "object", properties: {} } };
const mixed: CallToolResult = {
  content: [
    { type: "text", text: "Export completed" },
    { type: "image", mimeType: "image/png", data: "AAECAw==" },
    { type: "audio", mimeType: "audio/wav", data: "BAUGBw==" },
    { type: "resource", resource: { uri: "https://source.invalid/report", mimeType: "application/pdf", blob: "CAkKCw==" } },
    { type: "resource_link", uri: "https://source.invalid/item", name: "Source" }
  ],
  structuredContent: { exported: 3, truncated: true },
  _meta: { job: { id: "job-1", status: "complete" } }
};

async function fixture(options: RemoteMcpCommandOptions = {}, result = mixed, selected = tool) {
  let calls = 0;
  const fetch: NonNullable<RemoteMcpCommandOptions["fetch"]> = async (_url, init) => {
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    const request = JSON.parse(String(init.body));
    if (request.id === undefined) return new Response(null, { status: 202 });
    if (request.method === "tools/call") calls++;
    return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "initialize" ? {
      protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "files", version: "1" }
    } : result });
  };
  const [command] = await createRemoteMcpCommands([
    { name: "files", url: "https://files.invalid/mcp", protocolVersion: "2025-03-26", tools: [selected] }
  ], { ...options, fetch });
  const run = (signal = new AbortController().signal, args = ["export"]) => {
    const output: Uint8Array[] = [], errors: Uint8Array[] = [], carrier = createCommandArguments([]).withValues(args);
    const context: CommandContext = { command: "files", args: carrier.args, argumentValues: carrier, signal,
      stdin: toByteSource(""), stdout: { async write(chunk) { output.push(chunk.slice()); } },
      stderr: { async write(chunk) { errors.push(chunk.slice()); } }, cwd: "/", env: {}, fs: {} as CommandContext["fs"] };
    return { pending: command.execute(context), stdout: () => Buffer.concat(output).toString(), stderr: () => Buffer.concat(errors).toString() };
  };
  return { run, calls: () => calls };
}

it.each([false, true])("routes mixed binary results through a typed host hook while preserving metadata (isError=%s)", async isError => {
  const files = new Map<string, Uint8Array>();
  const transformToolResult = vi.fn<NonNullable<RemoteMcpCommandOptions["transformToolResult"]>>(async (result, context) => ({
    ...result,
    content: result.content.map((block, index) => {
      const data = block.type === "image" || block.type === "audio" ? block.data
        : block.type === "resource" && "blob" in block.resource ? block.resource.blob : undefined;
      if (typeof data !== "string") return block;
      const uri = `file:///exports/${context.toolName}-${index}`;
      files.set(uri, Uint8Array.from(atob(data), char => char.charCodeAt(0)));
      return { type: "resource_link" as const, uri, name: `Export ${index}` };
    })
  }));
  const f = await fixture({ transformToolResult }, { ...mixed, isError });
  const run = f.run();
  expect(await run.pending).toEqual({ exitCode: isError ? 1 : 0 });
  expect(transformToolResult).toHaveBeenCalledOnce();
  expect(transformToolResult.mock.calls[0][1]).toMatchObject({ serverName: "files", toolName: "export" });
  expect([...files.values()].map(bytes => [...bytes])).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]]);
  const output = JSON.parse(run.stdout());
  expect(output).toMatchObject({ structuredContent: mixed.structuredContent, _meta: mixed._meta, isError });
  expect(output.content[0]).toEqual(mixed.content[0]);
  expect(output.content[4]).toEqual(mixed.content[4]);
  expect(run.stdout()).not.toContain("AAECAw==");
  expect(run.stderr()).toBe(""); expect(f.calls()).toBe(1);
});

it("preserves default result bytes when no hook is installed", async () => {
  const f = await fixture(); const run = f.run();
  expect(await run.pending).toEqual({ exitCode: 0 });
  expect(run.stdout()).toBe(`${JSON.stringify(mixed)}\n`);
});

it.each(["throw", "reject"])("redacts a %s from the result hook without replaying the call", async mode => {
  const f = await fixture({ transformToolResult() {
    if (mode === "throw") throw new Error("private sink secret");
    return Promise.reject(new Error("private sink secret"));
  } });
  const run = f.run();
  expect(await run.pending).toEqual({ exitCode: 1 });
  expect(run.stdout()).toBe(""); expect(run.stderr()).toContain("MCP tool result callback failed");
  expect(run.stderr()).not.toContain("private sink secret"); expect(f.calls()).toBe(1);
});

it("cancels a pending result hook and never emits its late result", async () => {
  const entered = Promise.withResolvers<AbortSignal>(), resume = Promise.withResolvers<CallToolResult>();
  const controller = new AbortController();
  const f = await fixture({ transformToolResult(_result, context) { entered.resolve(context.signal); return resume.promise; } });
  const run = f.run(controller.signal);
  const signal = await entered.promise;
  controller.abort(new Error("cancelled by host"));
  await expect(run.pending).rejects.toThrow("cancelled by host");
  expect(signal.aborted).toBe(true);
  resume.resolve(mixed); await Promise.resolve();
  expect(run.stdout()).toBe(""); expect(f.calls()).toBe(1);
});

it.each([false, true])("validates provider structured content before the hook can mutate it (valid=%s)", async valid => {
  const f = await fixture({ transformToolResult(result) {
    result.structuredContent = { count: valid ? "invalid replacement" : 1 };
    return result;
  } }, { content: [], structuredContent: { count: valid ? 1 : "invalid provider" } }, {
    ...tool, outputSchema: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] }
  });
  const run = f.run();
  expect(await run.pending).toEqual({ exitCode: valid ? 0 : 1 });
  expect(run.stderr().includes("Invalid tool output")).toBe(!valid);
  expect(f.calls()).toBe(1);
});

it("cannot hide a partial tool error by clearing isError in the hook", async () => {
  const f = await fixture({ transformToolResult(result) { result.isError = false; return result; } }, { ...mixed, isError: true });
  expect(await f.run().pending).toEqual({ exitCode: 1 }); expect(f.calls()).toBe(1);
});

it("bounds the transformed output without replaying the call", async () => {
  const f = await fixture({ maxOutputBytes: 128, transformToolResult() { return { content: [{ type: "text", text: "x".repeat(512) }] }; } });
  const run = f.run();
  expect(await run.pending).toEqual({ exitCode: 1 }); expect(run.stdout()).toBe("");
  expect(run.stderr()).toContain("output byte limit"); expect(f.calls()).toBe(1);
});

it.each([["--help"], ["export", "--schema"], ["unknown"]].map(args => ({ args })))("does not invoke the result hook for $args", async ({ args }) => {
  const transformToolResult = vi.fn(); const f = await fixture({ transformToolResult });
  await f.run(undefined, args).pending;
  expect(transformToolResult).not.toHaveBeenCalled(); expect(f.calls()).toBe(0);
});
