import { expect, it } from "vitest";
import { defineCommand, defineGroup, getCommandSourcePath, hasMcpProxyConfig, S, type CommandNode, type Group } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { defineClient } from "./define-client.js";

it.each([0, 1, 2, 3])("runs inherited preflight checks once after client composition at depth %s", async (depth) => {
  const events: string[] = [];
  let node: CommandNode<any> = defineCommand({ name: "read", params: S.Object({}), requires: { check: async () => { events.push("leaf"); return { ok: true }; } }, handler: () => [...events] });
  for (let level = depth - 1; level >= 0; level--) {
    const name = `level${level}`;
    node = defineGroup({ name, requires: { check: async () => { events.push(name); return { ok: true }; } }, children: [node] });
  }
  const client = defineClient({ name: "audit", baseUrl: "https://example.test", auth: { commands: [], getToken: async () => "unused" }, commands: [node] });
  const sdk = createSDK(client.root, { services: client.services, errorReports: false });
  const path = [...Array.from({ length: depth }, (ignored, index) => `level${index}`), "read"];
  const command = path.reduce<any>((value, key) => value[key], sdk);
  await expect(command({})).resolves.toEqual([...path.slice(0, -1), "leaf"]);
});

it.each([false, true])("retains the original fixture source path, nested: %s", (nested) => {
  const OriginalError = globalThis.Error;
  class SourceError extends OriginalError { override stack = "Error\n    at source (file:///repo/commands/read.ts:1:1)"; }
  globalThis.Error = SourceError;
  let command: ReturnType<typeof defineCommand>;
  try { command = defineCommand({ name: "read", params: S.Object({}), handler: () => "ready" }); }
  finally { globalThis.Error = OriginalError; }
  const nodes = nested ? [defineGroup({ name: "nested", children: [command] })] : [command];
  const client = defineClient({ name: "audit", baseUrl: "https://example.test", auth: { commands: [], getToken: async () => "unused" }, commands: nodes });
  const copied = nested ? (client.root.children[0] as Group<any>).children[0] : client.root.children[0];
  if (copied?.kind !== "command") throw new Error("Expected copied command.");
  expect(getCommandSourcePath(copied)).toBe("/repo/commands/read.ts");
  expect(getCommandSourcePath(command)).toBe("/repo/commands/read.ts");
});

it.each(["generated", "handwritten", "nested", "proxy-before-manual"] as const)("preserves %s proxy definitions during composition", (mode) => {
  const proxy = defineGroup({ name: "upstream", mcp: { transport: "stdio", command: "upstream" }, tools: ["echo"], rename: { echo: "remote.echo" }, children: [] });
  const client = defineClient({
    name: "audit", baseUrl: "https://example.test", auth: { commands: [], getToken: async () => "unused" },
    commands: mode === "handwritten" ? [] : mode === "nested" ? [defineGroup({ name: "outer", children: [proxy] })] : [proxy],
    handwrittenCommands: mode === "handwritten" ? [proxy] : mode === "proxy-before-manual" ? [defineGroup({ name: "upstream", children: [defineCommand({ name: "local", params: S.Object({}), handler: () => "local" })] })] : []
  });
  expect(hasMcpProxyConfig(client.root)).toBe(true);
  expect(hasMcpProxyConfig(proxy)).toBe(true);
  expect(proxy.children).toEqual([]);
});
