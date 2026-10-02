import { expect, it } from "vitest";
import { privateRuntimeExportResolver } from "./private-runtime-exports.mjs";

it.each([false, true])("resolves scoped private owners using their production build inputs (prebuilt=%s)", async prebuilt => {
  const entry = `/repo/packages/pdf-ast/${prebuilt ? "dist/index.js" : "src/index.ts"}`;
  const manifests = new Map([
    ["/repo/packages/safe-bash/package.json", { poeCode: { integration: { privateWorkspaces: { "@poe-code/pdf-ast": {} } } } }],
    ["/repo/packages/pdf-ast/package.json", { exports: { ".": { import: "./dist/index.js" } }, poeCode: { bundle: { prebuilt } } }],
  ]);
  const files = { async readFile(filename: string) {
    if (!manifests.has(filename)) throw new Error(`Unexpected manifest: ${filename}`);
    return JSON.stringify(manifests.get(filename));
  } };
  const resolve = privateRuntimeExportResolver("/repo", ["@poe-code/pdf-ast"], files, { external: ["@poe-code/pdf-ast"] }, async (options: { entryPoints: Record<string, string> }) => {
    expect(options.entryPoints).toEqual({ "@poe-code/pdf-ast": entry });
    return { metafile: { outputs: { "output.js": { entryPoint: entry, exports: ["parsePdf"] } } } };
  });
  expect(await resolve("@poe-code/pdf-ast")).toEqual(["parsePdf"]);
});
