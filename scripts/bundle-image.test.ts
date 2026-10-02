import { readFile } from "node:fs/promises";
import { createFsFromVolume, Volume } from "memfs";
import { expect, it } from "vitest";
import { publishRootImagePackage } from "./bundle-image.mjs";

it("ships image aliases with the public PDF identity without changing workspace output", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const target = manifest.exports["./safe-bash/image-ast"].import;
  expect(manifest.exports["./safe-bash/sharp"].import).toBe(target);
  expect(target).toBe("./dist/image-ast.js");
  const source = 'import { PdfDocument } from "@poe-code/pdf-ast"; export { PdfDocument }; import "pako"; const label = "@poe-code/pdf-ast";';
  const volume = Volume.fromJSON({ "/repo/packages/image-ast/dist/index.js": source });
  await publishRootImagePackage("/repo", createFsFromVolume(volume).promises);
  expect(volume.readFileSync("/repo/dist/image-ast.js", "utf8")).toBe(
    'import { PdfDocument } from "poe-code/safe-bash/pdf-ast"; export { PdfDocument }; import "pako"; const label = "@poe-code/pdf-ast";'
  );
  expect(volume.readFileSync("/repo/packages/image-ast/dist/index.js", "utf8")).toBe(source);
});
