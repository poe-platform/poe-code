import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
    });
    expect(recipes[0]).not.toHaveProperty("banner");
  });
  it("never creates an export or registration from a recipe", () => {
    expect(resolveCommandExportBuilds("/repo", { ...source, exports: {} }, {}, [], { alias: {}, external: [], recipes: source.poeCode.publication.commandExports })).toEqual([]);
  });
  it("leaves Pandoc publication to the portable build instead of overriding it with a Node recipe", () => {
    const manifest = JSON.parse(readFileSync(new URL("../packages/safe-bash/package.json", import.meta.url), "utf8"));
    const builds = resolveCommandExportBuilds("/repo", manifest, {}, [], { alias: {}, external: [] });
    expect(builds.some(build => build.outfile.includes("/pandoc/"))).toBe(false);
    for (const name of ["docx", "python", "python/worker", "playwright", "pandoc", "xmllint"]) {
      const exported = manifest.exports[`./commands/${name}`];
      expect(exported.workerd, name).toBe(exported.browser);
      expect(typeof exported.workerd, name).toBe("string");
      expect(Object.keys(exported).indexOf("workerd"), name).toBeLessThan(Object.keys(exported).indexOf("import"));
    }
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


it("exposes graphviz through the root package and portable build", async () => {
  const root = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const { resolveBrowserShellBuild } = await import("./bundle-safe-bash.mjs");
  expect(root.exports["./safe-bash/graphviz"]).toEqual({
    types: "./dist/types/safe-bash/commands/graphviz/index.d.ts",
    import: "./packages/safe-bash/dist/commands/graphviz/index.browser.js",
  });
  expect(resolveBrowserShellBuild(process.cwd()).entryPoints["commands/graphviz/index.browser"])
    .toBe(process.cwd() + "/packages/safe-bash/src/commands/graphviz/index.ts");
});
