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

describe.each(commands)("$name public command contract", ({ name, api }) => {
  const stem = name.slice("safe-bash-command-".length);
  const title = stem[0]!.toUpperCase() + stem.slice(1);

  it("creates a default command, its collection, and a matching plugin without options", async () => {
    const single: CommandDefinition = api[`create${title}Command`]();
    const collection: readonly CommandDefinition[] = api[`create${title}Commands`]();
    const plugin: VirtualShellPlugin = api[`${stem}Commands`]();
    expect(single.name).not.toBe("");
    expect(single.execute).toBeTypeOf("function");
    expect(collection.length).toBeGreaterThan(0);
    expect(collection.map((command) => command.name)).toContain(single.name);
    expect(new Set(collection.map((command) => command.name)).size).toBe(collection.length);

    for (const options of [undefined, {}, { replace: true }]) {
      const registry = new CommandRegistry();
      const register = vi.spyOn(registry, "register");
      await (options === undefined ? plugin : api[`${stem}Commands`](options)).setup({
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
