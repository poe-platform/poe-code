import { expect, it } from "vitest";
import { Document, Image, ImagePartView, PartView, XmlPartView } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

const inputs = [
  "document picture",
  "run picture",
  "story image",
  "story inline",
  "package image",
  "collection image",
  "image blob",
  "image file",
  "image part"
] as const;
it.each(inputs)("owns bytes and always returns a Promise for %s admission", async (kind) => {
  const document = await Document(undefined, textContext);
  const bytes = rasterPng(),
    original = new Uint8Array(bytes);
  const owner = document.part.package;
  const run = document.paragraphs[0]!.add_run("Retained text");
  const admit = (input: Uint8Array): Promise<unknown> => {
    switch (kind) {
      case "document picture":
        return document.add_picture(input);
      case "run picture":
        return run.add_picture(input);
      case "story image":
        return document.part.get_or_add_image(input);
      case "story inline":
        return document.part.new_pic_inline(input);
      case "package image":
        return owner.get_or_add_image_part(input);
      case "collection image":
        return owner.image_parts.get_or_add_image_part(input);
      case "image blob":
        return Image.from_blob(input);
      case "image file":
        return Image.from_file(input);
      case "image part":
        return ImagePartView.load("/word/media/owned.png", "image/png", input, owner);
    }
  };
  const pending = admit(bytes);
  expect(pending).toBeInstanceOf(Promise);
  bytes.fill(0);
  const admitted = await pending;
  if (admitted instanceof Image) {
    const copy = admitted.blob;
    copy.fill(0);
    expect(admitted.blob).toEqual(original);
    expect(admitted.scaled_dimensions()).not.toBeInstanceOf(Promise);
  } else {
    expect([...owner.image_parts][0]!.blob).toEqual(original);
  }
  expect(run.text).toBe("Retained text");
  const images = owner.image_parts.length,
    shapes = document.inline_shapes.length;
  const failure = admit(new Uint8Array([0]));
  expect(failure).toBeInstanceOf(Promise);
  await expect(failure).rejects.toBeInstanceOf(Error);
  expect(owner.image_parts.length).toBe(images);
  expect(document.inline_shapes.length).toBe(shapes);
  expect(run.text).toBe("Retained text");
});

it.each([PartView, XmlPartView])(
  "owns generic admitted part bytes without alternating return types",
  async (factory) => {
    const document = await Document(undefined, textContext);
    const bytes = new TextEncoder().encode('<v:record xmlns:v="urn:record">Owned</v:record>');
    const original = new Uint8Array(bytes);
    const pending = factory.load(
      "/customXml/owned.xml",
      "application/xml",
      bytes,
      document.part.package
    );
    expect(pending).toBeInstanceOf(Promise);
    bytes.fill(0);
    const part = await pending;
    expect(part.blob).toEqual(original);
    expect(part.content_type).not.toBeInstanceOf(Promise);
    const failure = factory.load(
      "/customXml/invalid.xml",
      "application/xml",
      null as never,
      document.part.package
    );
    expect(failure).toBeInstanceOf(Promise);
    await expect(failure).rejects.toBeInstanceOf(Error);
  }
);
