import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import glob from "fast-glob";
import { describe, expect, it, vi } from "vitest";
import { CommandRegistry, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";

const root = resolve(import.meta.dirname, "../..");
const { workspaces } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  workspaces: string[];
};
const entries = glob
  .sync(
    workspaces.map((workspace) => `${workspace}/package.json`),
    { cwd: root }
  )
  .map((file) => ({
    file,
    name: JSON.parse(readFileSync(resolve(root, file), "utf8")).name as string
  }))
  .filter(({ name }) => name.startsWith("safe-bash-command-"));
const commands = await Promise.all(entries.map(async entry => ({
  ...entry,
  api: await import(resolve(root, entry.file, "../src/index.ts"))
})));

const documentEngines: Record<string, { replace?: boolean; engine: { execute(): Promise<{ exitCode: number; stdout: Uint8Array; stderr: Uint8Array }> } }> = Object.fromEntries(
  ["safe-bash-command-docx", "safe-bash-command-pptx"].map(name => [name, {
    engine: { async execute() { return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() }; } }
  }])
);

describe.each(commands)("$name public command contract", ({ name, api }) => {
  const stem = name.slice("safe-bash-command-".length);
  const words = stem.split("-");
  const title = words.map(word => word[0]!.toUpperCase() + word.slice(1)).join("");
  const pluginName = title[0]!.toLowerCase() + title.slice(1);

  const requiredOptions = documentEngines[name];
  if (requiredOptions) {
    it("requires an explicit document engine for every factory", () => {
      for (const factory of [`create${title}Command`, `create${title}Commands`, `${pluginName}Commands`]) {
        expect(() => api[factory]()).toThrow("explicit");
        expect(() => api[factory]({})).toThrow("explicit");
      }
    });
  }

  it("creates a command, its collection, and a matching plugin with required capabilities", async () => {
    const single: CommandDefinition = api[`create${title}Command`](requiredOptions);
    const collection: readonly CommandDefinition[] = api[`create${title}Commands`](requiredOptions);
    const plugin: VirtualShellPlugin = api[`${pluginName}Commands`](requiredOptions);
    expect(single.name).not.toBe("");
    expect(single.execute).toBeTypeOf("function");
    expect(collection.length).toBeGreaterThan(0);
    expect(collection.map((command) => command.name)).toContain(single.name);
    expect(new Set(collection.map((command) => command.name)).size).toBe(collection.length);

    for (const options of [requiredOptions, { ...requiredOptions }, { ...requiredOptions, replace: true }]) {
      const registry = new CommandRegistry();
      const register = vi.spyOn(registry, "register");
      await (options === undefined ? plugin : api[`${pluginName}Commands`](options)).setup({
        commands: registry,
        use: vi.fn(),
        registerFileSystem: vi.fn()
      });
      expect(register.mock.calls.map(([command]) => command.name)).toEqual(
        collection.map((command) => command.name)
      );
      for (const [command, settings] of register.mock.calls) {
        expect(command.execute).toBeTypeOf("function");
        expect(settings?.replace ?? false).toBe(options?.replace ?? false);
      }
    }
  });
});
