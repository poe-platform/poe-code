import { describe, expect, it } from "vitest";
import { resolveCommandExportBuilds } from "./safe-command-publication.mjs";

describe("declarative command export recipes", () => {
  const source = {
    exports: { "./commands/example": { import: "./dist/commands/example/index.js" } },
    poeCode: { publication: { commandExports: {
      "./commands/example": { source: "./src/commands/example/index.ts", target: "node22", bundleDependenciesFrom: ["engine"], require: true },
    } } },
  };
  it("derives the output from the advertised export and bundles engine-only dependencies", () => {
    const recipes = resolveCommandExportBuilds("/repo", source, { dependencies: { shared: "1.0.0" } },
      [{ dir: "engine", pkg: { dependencies: { shared: "1.0.0", codec: "2.0.0" } } }],
      { alias: {}, external: ["shared", "codec", "safe-bash-contracts"], recipes: source.poeCode.publication.commandExports });
    expect(recipes).toHaveLength(1);
    expect(recipes[0]).toMatchObject({
      entryPoints: ["/repo/packages/safe-bash/src/commands/example/index.ts"],
      outfile: "/repo/packages/safe-bash/dist/commands/example/index.js",
      external: ["shared", "safe-bash-contracts"], target: "node22", write: false,
      banner: { js: expect.stringContaining("createRequire") },
    });
  });
  it("never creates an export or registration from a recipe", () => {
    expect(resolveCommandExportBuilds("/repo", { ...source, exports: {} }, {}, [], { alias: {}, external: [], recipes: source.poeCode.publication.commandExports })).toEqual([]);
  });
  it("refuses to replace the default entrypoint with a command recipe", () => {
    const invalid = {
      exports: { ".": { import: "./dist/commands/example/index.js" } },
      poeCode: { publication: { commandExports: { ".": source.poeCode.publication.commandExports["./commands/example"] } } },
    };
    expect(() => resolveCommandExportBuilds("/repo", invalid, {}, [], { alias: {}, external: [], recipes: invalid.poeCode.publication.commandExports })).toThrow("Invalid command publication route");
  });
  it.each(["../outside.ts", "./src/../outside.ts", "/outside.ts"])("rejects escaping source %s", entry => {
    const invalid = structuredClone(source);
    invalid.poeCode.publication.commandExports["./commands/example"].source = entry;
    expect(() => resolveCommandExportBuilds("/repo", invalid, {}, [], { alias: {}, external: [], recipes: invalid.poeCode.publication.commandExports })).toThrow("Invalid command publication source");
  });
});
