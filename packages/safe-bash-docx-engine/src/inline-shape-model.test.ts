import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, Drawing, Image, Inches, WD_INLINE_SHAPE, InvalidValueError } from "./index.js";
import { ImagePartView, packageBindImage } from "./package-view.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it("admits inline picture bytes asynchronously and retains live shape sizing through save", async () => {
  const document = await Document();
  const paragraph = document.add_paragraph("Coast");
  const bytes = rasterPng();
  const pending = document.add_picture(bytes, Inches(2));
  expect(pending).toBeInstanceOf(Promise);
  const shape = await pending;
  expect(shape.type).toBe(WD_INLINE_SHAPE.PICTURE);
  expect(shape.width.inches).toBe(2);
  expect(shape.height.inches).toBe(2);
  expect(document.inline_shapes).toHaveLength(1);
  expect(document.inline_shapes.at(0).width.inches).toBe(2);
  shape.width = Inches(3);
  shape.height = Inches(1);
  const volume = Volume.fromJSON({ "/out": "" });
  await document.save({
    async write(chunk) {
      volume.appendFileSync("/out", chunk);
    }
  });
  const reopened = await Document(new Uint8Array(volume.readFileSync("/out") as Buffer));
  expect(reopened.inline_shapes.at(0).width.inches).toBe(3);
  expect(reopened.inline_shapes.at(0).height.inches).toBe(1);
  expect(paragraph.text).toBe("Coast");
  expect(bytes).toEqual(rasterPng());
});

it("returns synchronous admitted image metadata from an ordered run drawing", async () => {
  const document = await Document();
  const run = document.add_paragraph("Coast").add_run();
  await run.add_picture(rasterPng());
  const content = [...run.iter_inner_content()];
  const drawing = content[0] as import("./inline-shape-model.js").Drawing;
  expect(drawing.has_picture).toBe(true);
  expect(drawing.image.px_width).toBe(1);
  expect(drawing.image.blob).toEqual(rasterPng());
  const volume = Volume.fromJSON({ "/saved": "" });
  await document.save({
    async write(bytes) {
      volume.appendFileSync("/saved", bytes);
    }
  });
  const reopened = await Document(new Uint8Array(volume.readFileSync("/saved") as Buffer));
  const restored = reopened.paragraphs
    .flatMap((paragraph) => paragraph.runs.flatMap((run) => [...run.iter_inner_content()]))
    .find((value) => typeof value !== "string") as import("./inline-shape-model.js").Drawing;
  expect(restored.image.px_width).toBe(1);
  expect(restored.image.blob).toEqual(rasterPng());
});

it("refuses foreign or conflicting image characterizations without changing owned metadata", async () => {
  const document = await Document();
  const run = document.add_paragraph().add_run();
  await run.add_picture(rasterPng());
  const drawing = [...run.iter_inner_content()].find(
    (value) => value instanceof Drawing
  ) as Drawing;
  const part = document.part.package.parts.find(
    (value) => value instanceof ImagePartView
  ) as ImagePartView;
  const other = await Document();
  expect(() => other.part.package[packageBindImage](part, drawing.image)).toThrow();
  const differing = await Image.from_blob(rasterPng(2));
  expect(() => document.part.package[packageBindImage](part, differing)).toThrow(InvalidValueError);
  expect(drawing.image.px_width).toBe(1);
  expect(part.blob).toEqual(rasterPng());
});
