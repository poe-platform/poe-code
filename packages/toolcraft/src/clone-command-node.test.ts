import { describe, expect, it, vi } from "vitest";
import * as toolcraft from "./index.js";
import { createSDK } from "./sdk.js";
import type { CommandNode, Group, Scope } from "./index.js";

const { defineCommand, defineGroup, defineStreamCommand, S } = toolcraft;

function sourceCommand(stream = false) {
  const OriginalError = globalThis.Error;
  class SourceError extends OriginalError {
    override stack = "Error\n    at source (file:///repo/commands/read.ts:1:1)";
  }
  globalThis.Error = SourceError;
  try {
    return stream
      ? defineStreamCommand({ name: "read", params: S.Object({}), event: S.Number(), async *handler() { yield 1; } })
      : defineCommand({ name: "read", params: S.Object({}), handler: () => "ready" });
  } finally {
    globalThis.Error = OriginalError;
  }
}

describe("cloneCommandNode", () => {
  it.each([0, 1, 2, 3])("retains each inherited preflight once at depth %s across repeated copies", async (depth) => {
    let events: string[] = [];
    let node: CommandNode<any> = defineCommand({
      name: "read", params: S.Object({}),
      requires: { check: async () => { events.push("leaf"); return { ok: true }; } },
      handler: () => [...events]
    });
    for (let level = depth - 1; level >= 0; level--) {
      const name = `level${level}`;
      node = defineGroup({ name, requires: { check: async () => { events.push(name); return { ok: true }; } }, children: [node] });
    }
    const root = defineGroup({ name: "root", children: [node] });
    const clone = toolcraft.cloneCommandNode(toolcraft.cloneCommandNode(root));
    const path = [...Array.from({ length: depth }, (ignored, index) => `level${index}`), "read"];
    for (const current of [root, clone]) {
      events = [];
      const sdk = createSDK(current, { errorReports: false });
      const command = path.reduce<any>((value, key) => value[key], sdk);
      await expect(command({})).resolves.toEqual([...path.slice(0, -1), "leaf"]);
    }
  });

  it.each(["group", "command"] as const)("preserves effective preflights when detaching a %s", async (kind) => {
    const events: string[] = [];
    const root = defineGroup({ name: "outer", requires: { check: async () => { events.push("outer"); return { ok: true }; } }, children: [
      defineGroup({ name: "inner", requires: { check: async () => { events.push("inner"); return { ok: true }; } }, children: [
        defineCommand({ name: "read", params: S.Object({}), handler: () => [...events] })
      ] })
    ] });
    const inner = root.children[0] as Group<any>;
    const detached = toolcraft.cloneCommandNode(kind === "group" ? inner : inner.children[0]!);
    const copiedRoot = detached.kind === "group" ? detached : defineGroup({ name: "copy", children: [detached] });
    const sdk = createSDK(copiedRoot, { errorReports: false }) as { read(params: object): Promise<unknown> };
    await expect(sdk.read({})).resolves.toEqual(["outer", "inner"]);
  });

  it.each([false, true])("retains original source locations, stream: %s", (stream) => {
    const original = sourceCommand(stream);
    const clone = toolcraft.cloneCommandNode(original);
    expect(toolcraft.getCommandSourcePath(clone)).toBe("/repo/commands/read.ts");
    expect(clone.handler).toBe(original.handler);
    expect(clone.params).toBe(original.params);
    expect(clone.stream).toEqual(original.stream);
    if (stream) expect(clone.stream).not.toBe(original.stream);
  });

  it.each([
    { scope: [] as Scope[] },
    { scope: ["cli"] as Scope[] }
  ])("applies an explicit scope override throughout the copied tree: $scope", ({ scope }) => {
    const root = defineGroup({ name: "root", scope: ["sdk"], children: [defineGroup({ name: "nested", children: [sourceCommand()] })] });
    const clone = toolcraft.cloneCommandNode(root, scope) as Group<any>;
    const nested = clone.children[0] as Group<any>;
    expect(clone.scope).toEqual(scope);
    expect(nested.scope).toEqual(scope);
    expect(nested.children[0]?.scope).toEqual(scope);
    expect(root.scope).toEqual(["sdk"]);
    expect(scope).toEqual(clone.scope);
    expect(scope).not.toBe(clone.scope);
  });

  it("preserves current children and default identity when the result is reparented", () => {
    const first = sourceCommand();
    const root = defineGroup({ name: "root", children: [defineGroup({ name: "nested", children: [first], default: first })] });
    const nested = root.children[0] as Group<any>;
    nested.children.push(defineCommand({ name: "added", params: S.Object({}), handler: () => "added" }));
    const clone = toolcraft.cloneCommandNode(root);
    const wrapper = defineGroup({ name: "wrapper", children: [clone] });
    const copiedRoot = wrapper.children[0] as Group<any>;
    const copiedNested = copiedRoot.children[0] as Group<any>;
    expect(copiedNested.children.map((child) => child.name)).toEqual(["read", "added"]);
    expect(copiedNested.default).toBe(copiedNested.children[0]);
    expect(copiedNested.default).not.toBe(nested.default);
  });

  it.each([
    { transport: "stdio" as const, command: "upstream", args: ["--quiet"], env: { MODE: "test" } },
    { transport: "http" as const, url: "https://upstream.example.test/mcp", headers: { "X-Mode": "test" } }
  ])("retains isolated $transport proxy definitions without opening clients", (mcp) => {
    const root = defineGroup({ name: "upstream", mcp, tools: ["echo"], rename: { echo: "remote.echo" }, children: [] });
    const clone = toolcraft.cloneCommandNode(root);
    expect(toolcraft.hasMcpProxyConfig(clone)).toBe(true);
    const sourceKey = Object.getOwnPropertySymbols(root).find((key) => key.description === "toolcraft.group.config")!;
    const cloneKey = Object.getOwnPropertySymbols(clone).find((key) => key.description === "toolcraft.group.config")!;
    const sourceConfig = Reflect.get(root, sourceKey);
    const copiedConfig = Reflect.get(clone, cloneKey);
    expect(copiedConfig.mcp).toEqual(mcp);
    expect(copiedConfig.mcp).not.toBe(sourceConfig.mcp);
    expect(copiedConfig.tools).toEqual(["echo"]);
    expect(copiedConfig.tools).not.toBe(sourceConfig.tools);
    expect(copiedConfig.rename).toEqual({ echo: "remote.echo" });
    expect(copiedConfig.rename).not.toBe(sourceConfig.rename);
    const nestedKey = mcp.transport === "stdio" ? "args" : "headers";
    expect(copiedConfig.mcp[nestedKey]).not.toBe(sourceConfig.mcp[nestedKey]);
  });

  it("omits derived proxy commands while preserving manual descendants for rediscovery", () => {
    const manual = defineCommand({ name: "manual", params: S.Object({}), handler: () => "manual" });
    const root = defineGroup({ name: "upstream", mcp: { transport: "stdio", command: "upstream" }, children: [defineGroup({ name: "remote", children: [manual] })] });
    const remote = root.children[0] as Group<any>;
    const derived = defineCommand({ name: "echo", params: S.Object({}), handler: () => "derived" });
    Object.defineProperty(derived, Symbol("toolcraft.mcpProxyNode"), { value: true });
    remote.children.push(derived);
    const generatedGroup = defineGroup({ name: "generated", children: [sourceCommand()] });
    Object.defineProperty(generatedGroup, Symbol("toolcraft.mcpProxyNode"), { value: true });
    root.children.push(generatedGroup);
    const clone = toolcraft.cloneCommandNode(root);
    expect(clone.children.map((child) => child.name)).toEqual(["remote"]);
    expect((clone.children[0] as Group<any>).children.map((child) => child.name)).toEqual(["manual"]);
    expect(remote.children.map((child) => child.name)).toEqual(["manual", "echo"]);
    expect(toolcraft.hasMcpProxyConfig(clone)).toBe(true);
  });

  it("retains metadata from another module instance's symbol identities", () => {
    const original = sourceCommand();
    const foreign = { ...original };
    for (const key of Object.getOwnPropertySymbols(original)) {
      Object.defineProperty(foreign, Symbol(key.description), Object.getOwnPropertyDescriptor(original, key)!);
    }
    const clone = toolcraft.cloneCommandNode(foreign);
    expect(toolcraft.getCommandSourcePath(clone)).toBe("/repo/commands/read.ts");
  });

  it("retains explicitly selected proxy handlers outside a proxy-owned tree", async () => {
    const command = defineCommand({ name: "selected", params: S.Object({}), handler: () => "selected" });
    Object.defineProperty(command, Symbol("toolcraft.mcpProxyNode"), { value: true });
    const root = defineGroup({ name: "root", children: [] });
    root.children.push(command);
    const clone = toolcraft.cloneCommandNode(root);
    expect(clone.children.map((child) => child.name)).toEqual(["selected"]);
    const sdk = createSDK(clone, { errorReports: false }) as { selected(params: object): Promise<unknown> };
    await expect(sdk.selected({})).resolves.toBe("selected");
  });

  it("accepts structural commands without opaque metadata and preserves ordinary behavior", async () => {
    const command = { ...defineCommand({ name: "read", params: S.Object({}), handler: () => "ready" }) };
    const copied = toolcraft.cloneCommandNode(command);
    const sdk = createSDK(defineGroup({ name: "root", children: [copied] }), { errorReports: false });
    await expect(sdk.read({})).resolves.toBe("ready");
  });

  it("copies mutable presentation metadata without cloning functions or schema descriptors", () => {
    const handler = vi.fn(() => "ready");
    const command = defineCommand({ name: "read", aliases: ["show"], examples: [{ title: "example", params: { name: "one" } }], params: S.Object({}), handler });
    const clone = toolcraft.cloneCommandNode(command);
    clone.aliases.push("other");
    clone.examples[0]!.params.name = "changed";
    expect(command.aliases).toEqual(["show"]);
    expect(command.examples[0]!.params).toEqual({ name: "one" });
    expect(clone.handler).toBe(handler);
    expect(clone.params).toBe(command.params);
  });
});
