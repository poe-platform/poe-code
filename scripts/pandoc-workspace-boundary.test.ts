import { expect, it } from "vitest";
import * as core from "../packages/safe-bash/src/core.js";
import * as node from "../packages/safe-bash/src/index.js";
import * as command from "../packages/safe-bash/src/commands/pandoc/index.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import * as engine from "safe-bash-command-pandoc";

it("preserves the conversion SDK on the public Pandoc command entrypoint", async () => {
  expect(command).toHaveProperty("convert", engine.convert);
  expect(command).toHaveProperty("createFormatRegistry", engine.createFormatRegistry);
  expect(command).toHaveProperty("createLuaFilterCapability", engine.createLuaFilterCapability);
  const result = await command.convert([{ bytes: new TextEncoder().encode("**Bold**") }], {
    from: "markdown", to: "gfm"
  }, {});
  expect(result).toMatchObject({ kind: "text" });
  if (result.kind !== "text") throw new Error("Expected text conversion");
  expect(result.text).toContain("**Bold**");
});

it("exports the same Pandoc factories from both public entrypoints", () => {
  for (const entry of [core, node]) {
    expect(entry).toHaveProperty("createPandocCommand", command.createPandocCommand);
    expect(entry).toHaveProperty("createPandocCommands", command.createPandocCommands);
    expect(entry).toHaveProperty("pandocCommands", command.pandocCommands);
  }
  expect(typeof command.convert).toBe("function");
  expect(typeof command.createFormatRegistry).toBe("function");
  expect(typeof command.createLuaFilterCapability).toBe("function");
});

it("registers Pandoc explicitly through the SDK and preserves caller budgets", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.md", new TextEncoder().encode("**Bold** and *italic*"));
  const shell = new core.Shell({ fs });
  try {
    expect(shell.commands.has("pandoc")).toBe(false);
    shell.use(command.pandocCommands());
    expect(await shell.exec("pandoc -f markdown -t html /input.md")).toMatchObject({
      exitCode: 0, stderr: "", stdout: "<p><strong>Bold</strong> and <em>italic</em></p>\n"
    });
    expect(() => shell.commands.register(command.createPandocCommand())).toThrow("already registered");
    const limitedShell = new core.Shell({ fs });
    try {
      limitedShell.commands.register(command.createPandocCommand());
      limitedShell.use(command.pandocCommands({ replace: true, limits: { inputBytes: 1 } }));
      const limited = await limitedShell.exec("pandoc -f markdown -t html /input.md");
      expect(limited.exitCode).not.toBe(0);
      expect(limited.stdout).toBe("");
    } finally {
      await limitedShell.dispose();
    }
  } finally {
    await shell.dispose();
  }
});
