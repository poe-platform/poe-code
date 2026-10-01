import { expect, it } from "vitest";
import { CommandRegistry, type PluginHost } from "safe-bash-contracts";
import * as api from "./index.js";

it("constructs the MCP command without opening a connection", () => {
  expect(api.createMcpCommand().name).toBe("mcp");
  expect(api.createMcpCommands().map(command => command.name)).toEqual(["mcp"]);
  expect(api.createRemoteMcpManagementCommand([], { name: "remote" }).name).toBe("remote");
  const commands = new CommandRegistry();
  const host: PluginHost = { commands, use() {}, registerFileSystem() {} };
  const plugin = api.mcpCommands();
  plugin.setup(host);
  expect(commands.list()[0]!.execute).toBeTypeOf("function");
  expect(() => plugin.setup(host)).toThrow("already registered");
  expect(() => api.mcpCommands({ replace: true }).setup(host)).not.toThrow();
});
