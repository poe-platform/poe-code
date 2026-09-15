import { expect, it } from "vitest";
import { applyStyleModelBatch } from "./style-model-batch.js";
import { styleModelOperationResultSchema } from "./style-model-result-schema.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import type { ImageModelContext } from "./image-model.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

const prefix = "model.image.image.Image";
it("awaits standalone image admission before binding batch-local handles and encodes owned bytes", async () => {
  const bytes = rasterPng();
  const applied = await applyStyleModelBatch(await textFixture(paragraph("Harbor")), { version: 1, operations: [
    { operation: `${prefix}.from_blob.call`, arguments: { blob: { kind: "bytes", base64: Buffer.from(bytes).toString("base64") } }, resultHandle: "image" },
    { operation: `${prefix}.px_width.get`, receiver: { resultHandle: "image" }, arguments: {} },
    { operation: `${prefix}.blob.get`, receiver: { resultHandle: "image" }, arguments: {} },
    { operation: `${prefix}.scaled_dimensions.call`, receiver: { resultHandle: "image" }, arguments: {} }
  ] }, textContext);
  expect(applied.affected).toBe(0);
  expect(applied.results[0]?.value).toEqual({ id: "handle1", type: "Image", owner: "batch", revision: 0 });
  expect(applied.results[1]?.value).toBe(1);
  expect(applied.results[2]?.value).toEqual({ kind: "bytes", base64: Buffer.from(bytes).toString("base64") });
  expect(applied.results[3]?.value).toEqual([{ value: 12700, unit: "emu" }, { value: 12700, unit: "emu" }]);
});
it("declares awaited Image handles and exact length tuples in result schemas", () => {
  expect(styleModelOperationResultSchema(`${prefix}.from_blob.call`)).toMatchObject({ properties: { value: { properties: { type: { const: "Image" }, owner: { const: "batch" } } } } });
  expect(styleModelOperationResultSchema(`${prefix}.scaled_dimensions.call`)).toMatchObject({ properties: { value: { type: "array", minItems: 2, maxItems: 2 } } });
});
it("rejects guessed batch handles and context authority before binary acquisition", async () => {
  const input = await textFixture(paragraph("Harbor"));
  await expect(applyStyleModelBatch(input, { version: 1, operations: [
    { operation: `${prefix}.px_width.get`, receiver: { id: "handle1", type: "Image", owner: "batch", revision: 0 }, arguments: {} }
  ] }, textContext)).rejects.toThrow();
  await expect(applyStyleModelBatch(input, { version: 1, operations: [
    { operation: `${prefix}.from_blob.call`, arguments: { blob: { kind: "bytes", base64: "AA==" }, context: { vfs: "host" } } }
  ] }, textContext)).rejects.toThrow("capability");
});
it("keeps from_blob byte-only even with a trusted VFS resolver", async () => {
  let opens = 0;
  const context: ImageModelContext = { ...textContext, binaryResolver: { capability: "command", async *open() { opens++; yield rasterPng(); } } };
  await expect(applyStyleModelBatch(await textFixture(paragraph("Harbor")), { version: 1, operations: [
    { operation: `${prefix}.from_blob.call`, arguments: { blob: { kind: "vfs", path: "/Map.PNG", capability: "command" } } }
  ] }, context)).rejects.toThrow();
  expect(opens).toBe(0);
});
it("reads every immutable Image property and rejects higher per-item ceilings", async () => {
  const input = await textFixture(paragraph("Harbor"));
  const blob = { kind: "bytes", base64: Buffer.from(rasterPng()).toString("base64") };
  const names = ["content_type", "ext", "filename", "px_width", "px_height", "horz_dpi", "vert_dpi", "width", "height", "sha1"];
  const applied = await applyStyleModelBatch(input, { version: 1, operations: [
    { operation: `${prefix}.from_file.call`, arguments: { imageDescriptor: blob }, resultHandle: "image" },
    ...names.map(name => ({ operation: `${prefix}.${name}.get`, receiver: { resultHandle: "image" }, arguments: {} }))
  ] }, textContext);
  expect(applied.results.slice(1, 8).map(item => item.value)).toEqual(["image/png", "png", "image.png", 1, 1, 72, 72]);
  expect(applied.results[8]?.value).toEqual({ value: 12700, unit: "emu" });
  expect(applied.results[9]?.value).toEqual({ value: 12700, unit: "emu" });
  expect(applied.results[10]?.value).toEqual(expect.stringMatching(/^[0-9a-f]{40}$/));
  await expect(applyStyleModelBatch(input, { version: 1, operations: [
    { operation: `${prefix}.from_blob.call`, arguments: { blob, context: { limits: { embeddedMediaBytes: Number.MAX_SAFE_INTEGER } } } }
  ] }, textContext)).rejects.toThrow("ceilings");
});
