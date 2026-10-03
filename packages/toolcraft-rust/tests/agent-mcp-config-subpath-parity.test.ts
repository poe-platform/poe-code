import assert from "node:assert/strict";
import { it } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import * as own from "@poe-code/agent-mcp-config-rust";

it("Native MCP configuration subpath exposes exactly the reference namespace and own identities", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/agent-mcp-config"),
    import("toolcraft/agent-mcp-config")
  ]);
  assert.deepEqual(Object.keys(native).sort(), Object.keys(reference).sort());
  for (const name of Object.keys(reference)) assert.equal(native[name], own[name], name);
  assert.deepEqual(native.supportedAgents, reference.supportedAgents);
  for (const input of [...reference.supportedAgents, " CLAUDE ", "claude:Provider/Model", "gemini", "unknown", "\ud800"]) {
    assert.equal(native.isSupported(input), reference.isSupported(input));
    const snapshot = api => {
      const support = api.resolveAgentSupport(input);
      return support.config ? { ...support, config: { ...support.config, configFile: typeof support.config.configFile === "function" ? ["darwin", "linux", "win32"].map(platform => support.config.configFile(platform)) : support.config.configFile } } : support;
    };
    assert.deepEqual(snapshot(native), snapshot(reference));
  }
});

it("Native MCP configuration subpath preserves JSON, TOML and YAML file edits and dry runs", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/agent-mcp-config"),
    import("toolcraft/agent-mcp-config")
  ]);
  for (const agent of reference.supportedAgents) for (const platform of ["darwin", "linux", "win32"] as const) {
    const outcomes = [];
    for (const api of [reference, native]) {
      const volume = new Volume();
      const fs = createFsFromVolume(volume).promises;
      const options = { fs, homeDir: "/home/tester", platform };
      const server = { name: "tools", config: { transport: "stdio" as const, command: "node", args: ["tools.mjs"], env: { TOKEN: "secret" } } };
      await api.configure(agent, server, { ...options, dryRun: true });
      assert.deepEqual(volume.toJSON(), {});
      await api.configure(agent, server, options);
      const created = volume.toJSON();
      await api.configure(agent, server, options);
      assert.deepEqual(volume.toJSON(), created);
      await api.configure(agent, { ...server, name: "other" }, options);
      await api.unconfigure(agent, server, options);
      const retained = volume.toJSON();
      await api.unconfigure(agent, "other", options);
      outcomes.push({ created, retained, removed: volume.toJSON() });
    }
    assert.deepEqual(outcomes[1], outcomes[0], `${agent}/${platform}`);
  }
});
