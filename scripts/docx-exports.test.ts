import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";
import { textContext, textFixture } from "../packages/docx/tests/fixtures/text.js";
import { rasterPng } from "../packages/docx/tests/fixtures/raster.js";
import { MemoryFileSystem } from "../packages/safe-fs/src/fs/memory/index.js";

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
  expect(runtime.inspectDocumentControls).toBeTypeOf("function");
  expect(runtime.editDocumentControls).toBeTypeOf("function");
  expect.soft(runtime.editDocumentControlRepeats).toBeTypeOf("function");
  expect.soft(runtime.editDocumentControlBindings).toBeTypeOf("function");
  expect.soft(runtime.inspectDocumentPackageResources).toBeTypeOf("function");
  expect.soft(runtime.inspectDocumentProperties).toBeTypeOf("function");
  expect.soft(runtime.editDocumentProperties).toBeTypeOf("function");
  expect.soft(runtime.inspectDocumentImages).toBeTypeOf("function");
  expect.soft(runtime.extractDocumentImages).toBeTypeOf("function");
  expect.soft(runtime.insertDocumentImage).toBeTypeOf("function");
  expect.soft(runtime.replaceDocumentImage).toBeTypeOf("function");
  expect.soft(runtime.setDocumentImageLayout).toBeTypeOf("function");
  if (runtime.insertDocumentImage && runtime.replaceDocumentImage) {
    const chunks: Uint8Array[] = [];
    const source = rasterPng(3, 5), replacement = rasterPng(7, 2);
    const context = { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes: Uint8Array) { chunks.push(new Uint8Array(bytes)); } } };
    await runtime.insertDocumentImage(await textFixture('<w:p/>'), {
      operation: "images.add", options: { paragraph: 1, file: { kind: "bytes", base64: Buffer.from(source).toString("base64") }, output: "-" }
    }, context);
    const inserted = new Uint8Array(Buffer.concat(chunks)); chunks.length = 0;
    const result = await runtime.replaceDocumentImage(inserted, {
      operation: "images.replace", options: { image: 1, file: { kind: "bytes", base64: Buffer.from(replacement).toString("base64") }, output: "-" }
    }, context);
    expect(result.changed).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].kind).toBe("replace");
    const replaced = await runtime.readDocumentArchive(new Uint8Array(Buffer.concat(chunks)), textContext);
    expect(replaced.members.filter((member: { name: string }) => member.name.endsWith(".png"))).toHaveLength(1);
    expect(replaced.members.find((member: { name: string }) => member.name.endsWith(".png")).bytes).toEqual(replacement);
    if (runtime.setDocumentImageLayout) {
      const source = new Uint8Array(Buffer.concat(chunks)); chunks.length = 0;
      const layout = await runtime.setDocumentImageLayout(source, {
        operation: "images.set", options: { image: 1, width: { value: 2, unit: "in" }, output: "-" }
      }, context);
      expect(layout.changed).toBe(true);
      expect(layout.changes).toHaveLength(1);
      expect(layout.changes[0].kind).toBe("set");
      const resized = await runtime.readDocumentArchive(new Uint8Array(Buffer.concat(chunks)), textContext);
      expect(resized.members.find((member: { name: string }) => member.name.endsWith(".png")).bytes).toEqual(replacement);
      const inventory = await runtime.inspectDocumentImages(new Uint8Array(Buffer.concat(chunks)), { operation: "images.list" }, textContext);
      expect(inventory.items[0].details.widthEmu).toBe(1828800);
      expect(inventory.items[0].details.heightEmu).toBe(3048000);
    }
  }
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="999" height="1"><title>Format probe</title></svg>');
  const fallback = rasterPng(4, 6);
  const svgChunks: Uint8Array[] = [];
  const svgContext = {
    ...textContext,
    encoding: { order: "input", compression: "store" },
    stdout: { async write(bytes: Uint8Array) { svgChunks.push(new Uint8Array(bytes)); } }
  };
  const svgResult = await runtime.insertDocumentImage(await textFixture('<w:p/>'), {
    operation: "images.add", options: {
      paragraph: 1,
      file: { kind: "bytes", base64: Buffer.from(svg).toString("base64") },
      fallback: { kind: "bytes", base64: Buffer.from(fallback).toString("base64") },
      output: "-"
    }
  }, svgContext);
  expect(svgResult.changed).toBe(true);
  expect(svgResult.changes).toHaveLength(1);
  const svgOutput = new Uint8Array(Buffer.concat(svgChunks));
  const svgArchive = await runtime.readDocumentArchive(svgOutput, textContext);
  expect(svgArchive.members.filter((member: { name: string }) => member.name.endsWith(".svg"))).toHaveLength(1);
  expect(svgArchive.members.find((member: { name: string }) => member.name.endsWith(".svg")).bytes).toEqual(svg);
  expect(svgArchive.members.find((member: { name: string }) => member.name.endsWith(".png")).bytes).toEqual(fallback);
  const svgInventory = await runtime.inspectDocumentImages(svgOutput, { operation: "images.list" }, textContext);
  expect(svgInventory.items).toHaveLength(1);
  expect(svgInventory.items[0].details.widthEmu).toBe(50800);
  expect(svgInventory.items[0].details.heightEmu).toBe(76200);
  expect(svgInventory.items[0].details.alternateParts).toHaveLength(1);
  expect(svgInventory.items[0].details.fallbackPart).toBe(svgInventory.items[0].details.part);
  const svgFilesystem = new MemoryFileSystem();
  await svgFilesystem.mkdir("/out");
  const extractedSvg = await runtime.extractDocumentImages(svgOutput, {
    outputDir: "/out", allowPartialOutput: true
  }, { ...svgContext, filesystem: svgFilesystem });
  expect(extractedSvg.complete).toBe(true);
  expect(extractedSvg.entries).toHaveLength(2);
  expect(await svgFilesystem.readFile(extractedSvg.entries[0].path)).toEqual(fallback);
  expect(await svgFilesystem.readFile(extractedSvg.entries[1].path)).toEqual(svg);
  expect.soft(runtime.characterizeRasterHeader).toBeTypeOf("function");
  expect.soft(runtime.Image?.from_blob).toBeTypeOf("function");
  expect.soft(runtime.Image?.from_file).toBeTypeOf("function");
  if (runtime.Image?.from_blob) {
    const bytes = rasterPng(3, 5);
    const pending = runtime.Image.from_blob(bytes);
    expect(pending).toBeInstanceOf(Promise);
    const image = await pending;
    expect(image.content_type).toBe("image/png");
    expect(image.filename).toBe("image.png");
    expect(image.width.emu).toBe(38100);
    expect(image.height.emu).toBe(63500);
    expect(image.scaled_dimensions(76200).map((length: { emu: number }) => length.emu)).toEqual([76200, 127000]);
    const returned = image.blob; returned.fill(0);
    expect(image.blob).toEqual(bytes);
    expect(image.sha1).toMatch(/^[0-9a-f]{40}$/u);
    expect(await runtime.Image.from_file({ open: async function* () { yield bytes; } })).toMatchObject({ content_type: "image/png", filename: "image.png" });
  }
  const original = await textFixture('<w:p/>');
  if (typeof runtime.inspectDocumentImages === "function") {
    expect(await runtime.inspectDocumentImages(original, { operation: "images.list" }, textContext)).toEqual({ items: [], warnings: [] });
    await expect(runtime.inspectDocumentImages(original, { operation: "images.get", image: 1 }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
  }
  expect(await runtime.inspectDocumentProperties(original, {}, textContext)).toEqual({ items: [], warnings: [] });
  await expect(runtime.inspectDocumentProperties(original, { name: "core:title" }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
  await expect(runtime.inspectDocumentProperties(original, { scope: "body" }, textContext)).rejects.toMatchObject({ code: "usage" });
  for (const operation of ["custom-xml.list", "glossary.list"]) {
    expect(await runtime.inspectDocumentPackageResources(original, operation, {}, textContext)).toEqual({ items: [] });
    await expect(runtime.inspectDocumentPackageResources(original, operation, { scope: "body" }, textContext)).rejects.toMatchObject({ code: "usage" });
  }
  expect(runtime.parseDocxArguments([new TextEncoder().encode("--help")]).operation).toBe("help");
  expect(runtime.getDocxOperationSchema("text.replace").additionalProperties).toBe(false);
  expect(runtime.validateDocxBatch({ version: 1, operations: [] }).operations).toEqual([]);
});
