import { expect, it } from "vitest";
import { getDocxDiscovery } from "./discovery.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { parseDocxArguments, validateDocxInvocation } from "./command.js";
import { svgBinary } from "../tests/fixtures/svg-image.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it("keeps SVG and fallback on the existing closed byte/path SDK inputs", () => {
  for (const transport of ["sdk", "batch"] as const) {
    const schema = getDocxOperationSchema("images.add", transport);
    expect(schema.properties?.fallback).toEqual(schema.properties?.file);
    expect(schema.required).toContain("file"); expect(schema.required).not.toContain("fallback");
  }
  const options = { paragraph: 1, dryRun: true, file: svgBinary(), fallback: svgBinary(rasterPng()) };
  expect(validateDocxInvocation({ operation: "images.add", inputs: ["input.docx"], options }).options).toMatchObject(options);
  expect(() => validateDocxInvocation({ operation: "images.add", inputs: ["input.docx"], options: { ...options, fallback: { kind: "bytes", base64: "AB==" } } })).toThrow();
});
it("reserves only explicit CLI dashes, while JSON SDK VFS paths stay literal", () => {
  const parse = (...args: string[]) => parseDocxArguments(["images", "add", "input.docx", "--paragraph", "1", "--dry-run", ...args].map(value => new TextEncoder().encode(value)));
  expect(parse("--file", "vector.svg", "--fallback", "-").sources).toMatchObject([{ argument: "file", path: "vector.svg" }, { argument: "fallback", path: "-" }]);
  expect(() => parse("--file", "-", "--fallback", "-")).toThrow("one stdin");
  const invocation = validateDocxInvocation({ operation: "images.add", inputs: ["-"], options: { paragraph: 1, dryRun: true, file: { kind: "vfs", path: "-", capability: "command" }, fallback: { kind: "vfs", path: "-", capability: "command" } } });
  expect(invocation.sources ?? []).toEqual([]);
  const batch = parseDocxArguments(["batch", "-", "--ops-json", JSON.stringify({ version: 1, operations: [{ operation: "images.add", arguments: { paragraph: 1, file: { kind: "vfs", path: "-", capability: "command" }, fallback: { kind: "vfs", path: "-", capability: "command" } } }] }), "--dry-run"].map(value => new TextEncoder().encode(value)));
  expect(batch.sources ?? []).toEqual([]);
  expect(batch.options.operations).toMatchObject([{ operation: "images.add", arguments: { file: { path: "-" }, fallback: { path: "-" } } }]);
});
it("qualifies explicit static SVG insertion with supplied fallbacks and honest remaining limits", () => {
  const data = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data;
  expect(data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F35", level: "edit", subsets: expect.arrayContaining([expect.objectContaining({ name: "static-svg-fallback-insertion", level: "edit" })]) })]) });
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "images.add" } })!.human;
  for (const text of ["SVG", "supplied", "fallback", "GIF", "BMP", "TIFF", "stream", "unsupported", "rasterize"]) expect(help).toContain(text);
  expect(help).not.toContain("supplied fallback and other raster insertion are unsupported");
});
