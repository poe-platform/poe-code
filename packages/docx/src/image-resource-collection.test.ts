import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";


async function document() {
  const volume = Volume.fromJSON({ "/input": Buffer.from(await textFixture(paragraph("Channel survey") + "<w:sectPr/>")) });
  return api.Document(new Uint8Array(volume.readFileSync("/input") as Buffer), textContext);
}

it("does not reuse an opaque differently typed resource merely because its bytes match", async () => {
  const volume = Volume.fromJSON({ "/input": Buffer.from(await textFixture(paragraph("Marker image"))) });
  const doc = await api.Document(new Uint8Array(volume.readFileSync("/input") as Buffer), textContext);
  const owner = doc.part.package;
  const opaque = await api.PartView.load("/data/opaque.bin", "image/x-inert", rasterPng(), owner);
  await doc.add_picture(rasterPng());
  expect(owner.image_parts.length).toBe(2);
  const picture = [...doc.part.rels.values()].find(edge => edge.reltype.endsWith("/image"))!.target_part;
  expect(picture.content_type).toBe("image/png");
  expect(picture).not.toBe(opaque);
  expect(picture.blob).toEqual(rasterPng());
  expect(opaque.blob).toEqual(rasterPng());
  expect(opaque.content_type).toBe("image/x-inert");
});

it("qualifies image collections without inventing image-part ordinal lookup", async () => {
  const doc = await document(), shapes = doc.inline_shapes, parts = doc.part.package.image_parts;
  expect(shapes.length).toBe(0); expect(parts.length).toBe(0);
  const first = await doc.add_picture(rasterPng());
  await doc.add_picture(rasterPng());
  expect(shapes.length).toBe(2); expect(parts.length).toBe(1);
  expect([...doc.part.rels.values()].filter(edge => edge.reltype.endsWith("/image"))).toHaveLength(1);
  expect(shapes[0]!.ref).toEqual(first.ref);
  expect([...shapes]).toHaveLength(2);
  expect(shapes.at(-2).ref).toEqual(first.ref);
  const part = [...parts][0]!;
  expect(parts.has(part)).toBe(true);
  expect(parts.has(false)).toBe(false);
  parts.append(part);
  expect(parts.length).toBe(1);
  expect(await parts.get_or_add_image_part(rasterPng())).toBe(part);
  const foreign = await (await document()).part.package.image_parts.get_or_add_image_part(rasterPng());
  expect(() => parts.append(foreign)).toThrow(api.InputTypeError);
  expect(parts.has(foreign)).toBe(false);
  for (const index of [-3, 2]) expect(() => shapes.at(index)).toThrow(api.BoundsError);
  for (const index of [null, false, "0", NaN, Infinity, 0.5]) expect(() => shapes.at(index as number)).toThrow(api.InputTypeError);
  expect(Reflect.get(shapes, "slice")).toBeUndefined();
  expect(Reflect.get(parts, "at")).toBeUndefined();
  const volume = Volume.fromJSON({ "/output": "" });
  await doc.save({ async write(bytes) { volume.appendFileSync("/output", bytes); } });
  const reloaded = await api.Document(new Uint8Array(volume.readFileSync("/output") as Buffer), textContext);
  expect(reloaded.inline_shapes.length).toBe(2);
  expect(reloaded.part.package.image_parts.length).toBe(1);
  expect([...reloaded.part.package.image_parts][0]!.blob).toEqual(rasterPng());
});
