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

it("routes image storage and error contracts to the canonical public filesystem", async () => {
  const source = 'import { PagedStorage } from "@poe-code/safe-fs/storage"; import { FsError, compareIdentity } from "@poe-code/safe-fs/contracts"; export { PagedStorage, FsError, compareIdentity };';
  const volume = Volume.fromJSON({"/repo/packages/image-ast/dist/index.js": source});
  await publishRootImagePackage("/repo", createFsFromVolume(volume).promises);
  const output = volume.readFileSync("/repo/dist/image-ast.js", "utf8");
  expect(output).not.toContain("@poe-code/safe-fs");
  expect(output).toContain('from "poe-code/safe-fs/core"');
  expect(volume.readFileSync("/repo/packages/image-ast/dist/index.js", "utf8")).toBe(source);
});
