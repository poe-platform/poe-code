import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";

it("ships the optional document API and command with matching portable runtime and type routes", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  expect(manifest.exports["./docx"]).toEqual({
    types: "./packages/docx/dist/index.d.ts",
    import: "./packages/docx/dist/index.js"
  });
  expect(manifest.exports["./safe-bash/commands/docx"]).toEqual({
    types: "./packages/safe-bash/dist/commands/docx/index.d.ts",
    browser: "./packages/safe-bash/dist/commands/docx/index.browser.js",
    import: "./packages/safe-bash/dist/commands/docx/index.js"
  });
  expect(manifest.files).toEqual(expect.arrayContaining([
    "packages/docx/dist", "packages/docx/LICENSE", "packages/docx/THIRD_PARTY_NOTICES.txt"
  ]));
  expect(resolveBrowserShellBuild("/repo").entryPoints["commands/docx/index.browser"])
    .toBe("/repo/packages/safe-bash/src/commands/docx/index.ts");
});

it("closes the document runtime over portable ZIP and XML implementations", async () => {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [new URL("../packages/docx/src/index.ts", import.meta.url).pathname],
    bundle: true,
    platform: "browser",
    conditions: ["workerd", "worker", "browser"],
    format: "esm",
    target: "es2022",
    write: false,
    metafile: true
  });
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  expect(Object.keys(result.metafile!.inputs).some(name => name.includes("office-package/"))).toBe(true);
  expect(Object.keys(result.metafile!.inputs).some(name => name.includes("safe-fs/") && name.includes("xml"))).toBe(true);
  const runtime = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(result.outputFiles[0]!.contents).toString("base64")}`);
  expect(runtime.parseDocumentXml(new TextEncoder().encode('<note label="Coastal survey"/>')).root.localName).toBe("note");
  expect(runtime.Document).toBeUndefined();
  expect(runtime.editDocumentRevisions).toBeTypeOf("function");
  expect(runtime.editDocumentRevisionDecisions).toBeTypeOf("function");
  expect(runtime.parseDocxArguments([new TextEncoder().encode("--help")]).operation).toBe("help");
  expect(runtime.getDocxOperationSchema("text.replace").additionalProperties).toBe(false);
  expect(runtime.validateDocxBatch({ version: 1, operations: [] }).operations).toEqual([]);
});
