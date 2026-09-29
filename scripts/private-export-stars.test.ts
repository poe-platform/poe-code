import { expect, it } from "vitest";
import { build } from "esbuild";
import { Volume, createFsFromVolume } from "memfs";
import { privateExportStarsPlugin } from "./private-export-stars.mjs";

it("preserves a shared external export-star facade in every split browser entry", async () => {
  const volume = Volume.fromJSON({
    "/fixture/root.ts": 'export * from "./facade.ts";',
    "/fixture/facade.ts": 'export * from "private-command";',
  });
  const files = createFsFromVolume(volume);
  const result = await build({ absWorkingDir: "/fixture", entryPoints: { root: "/fixture/root.ts", facade: "/fixture/facade.ts" },
    outdir: "/fixture/dist", bundle: true, splitting: true, format: "esm", platform: "browser", write: false, metafile: true,
    external: ["private-command"], plugins: [privateExportStarsPlugin(new Map([["private-command", ["createCommand"]]]), files.promises), {
      name: "virtual-fixture", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path === "private-command" ? { path: args.path, external: true } : { path: args.path.startsWith("/") ? args.path : "/fixture/" + args.path.slice(2), namespace: "file" });
        builder.onLoad({ filter: /.*/ }, async args => ({ contents: await files.promises.readFile(args.path, "utf8") as string, loader: "ts" }));
      },
    }] });
  for (const output of Object.values(result.metafile!.outputs).filter(output => output.entryPoint)) expect(output.exports).toContain("createCommand");
});

it("retains locally overridden exports and excludes external default exports", async () => {
  const { rewritePrivateExportStars } = await import("./private-export-stars.mjs");
  const source = 'export * from "private-command"; export const createCommand = 1;';
  const result = rewritePrivateExportStars("facade.ts", source, new Map([["private-command", ["createCommand", "otherCommand", "default"]]]));
  expect(result).toBe('export { "otherCommand" } from "private-command"; export const createCommand = 1;');
});

it("preserves destructured local exports when rewriting an external star", async () => {
  const { rewritePrivateExportStars } = await import("./private-export-stars.mjs");
  const source = 'export * from "private-command"; export const { value: createCommand, nested: [otherCommand] } = configuration;';
  expect(rewritePrivateExportStars("facade.ts", source, new Map([["private-command", ["createCommand", "otherCommand", "remaining"]]]))).toBe('export { "remaining" } from "private-command"; export const { value: createCommand, nested: [otherCommand] } = configuration;');
});
