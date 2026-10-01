import { expect, it } from "vitest";
import { createMediaCommand, createMediaCommands, mediaCommands } from "./index.js";
import { CommandRegistry, type PluginHost } from "safe-bash-contracts";

it("constructs zero-argument factories and registers the same inventory", () => {
  expect(createMediaCommand().name).toBe("ffmpeg");
  const definitions = createMediaCommands();
  const commands = new CommandRegistry();
  const host: PluginHost = { commands, use() {}, registerFileSystem() {} };
  mediaCommands().setup(host);
  expect(commands.list().map(command => command.name)).toEqual(definitions.map(command => command.name));
  expect(() => mediaCommands().setup(host)).toThrow("already registered");
  expect(() => mediaCommands({ replace: true }).setup(host)).not.toThrow();
});

it.each(["missing", "__proto__", "constructor", "MagickCore-config"])("rejects non-command %s", name => {
  expect(() => createMediaCommand({}, name)).toThrow("Media command not configured");
});
