import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import ts from "typescript";
import { build } from "esbuild";

it("keeps image and PDF codec consumers behind the shared compression contract", () => {
  for (const file of ["image-ast/src/codecs/png.ts", "image-ast/src/codecs/webp.ts", "image-ast/src/codecs/netpbm.ts", "pdf-ast/src/cos/filters.ts", "safe-bash-pdf-engine/src/png.ts", "office-package/src/zip-sync.ts"]) {
    const source = ts.createSourceFile(file, readFileSync(resolve("packages", file), "utf8"), ts.ScriptTarget.Latest);
    const imports = source.statements.filter(ts.isImportDeclaration).map(node => ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : "");
    expect(imports, file).not.toContain("pako");
    expect(imports, file).toContain("@poe-code/compression");
  }
});

it("bundles the pure codec for Workers with no external imports or consumer return dependencies", async () => {
  const result = await build({ entryPoints: ["packages/compression/src/index.ts"], bundle: true, platform: "browser", conditions: ["workerd"], format: "esm", write: false, metafile: true });
  for (const output of Object.values(result.metafile!.outputs)) expect(output.imports).toEqual([]);
  for (const input of Object.keys(result.metafile!.inputs)) {
    expect(input.startsWith("packages/compression/") || input.startsWith("node_modules/pako/"), input).toBe(true);
  }
});
