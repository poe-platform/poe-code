import { expect, it } from "vitest";
import { privateRuntimeExportResolver } from "./private-runtime-exports.mjs";

it("resolves scoped private owners through their workspace directory", async () => {
  const manifests = new Map([
    ["/repo/packages/safe-bash/package.json", { poeCode: { integration: { privateWorkspaces: { "@poe-code/pdf-ast": {} } } } }],
    ["/repo/packages/pdf-ast/package.json", { exports: { ".": { import: "./dist/index.js" } } }],
  ]);
  const files = { async readFile(filename: string) {
    if (!manifests.has(filename)) throw new Error(`Unexpected manifest: ${filename}`);
    return JSON.stringify(manifests.get(filename));
  } };
  const resolve = privateRuntimeExportResolver("/repo", ["@poe-code/pdf-ast"], files, { external: ["@poe-code/pdf-ast"] }, async (options: { entryPoints: Record<string, string> }) => {
    expect(options.entryPoints).toEqual({ "@poe-code/pdf-ast": "/repo/packages/pdf-ast/dist/index.js" });
    return { metafile: { outputs: { "output.js": { entryPoint: "/repo/packages/pdf-ast/dist/index.js", exports: ["parsePdf"] } } } };
  });
  expect(await resolve("@poe-code/pdf-ast")).toEqual(["parsePdf"]);
});
