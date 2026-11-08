import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Image, InputTypeError, openDocumentStyleModel } from "./index.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it.each(["styles", "image blob", "image file"])(
  "rejects explicit null context in %s factory asynchronously",
  async (kind) => {
    const volume = Volume.fromJSON({ "/image.png": Buffer.from(rasterPng()) });
    const bytes = new Uint8Array(volume.readFileSync("/image.png") as Uint8Array);
    const pending =
      kind === "styles"
        ? openDocumentStyleModel(undefined, null as never)
        : kind === "image blob"
          ? Image.from_blob(bytes, null as never)
          : Image.from_file(bytes, null as never);
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toBeInstanceOf(InputTypeError);
    expect(volume.readFileSync("/image.png")).toEqual(Buffer.from(rasterPng()));
  }
);
