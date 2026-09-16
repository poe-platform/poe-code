import { expect, it, vi } from "vitest";
import {
  Document,
  Image,
  PackageView,
  applyStyleModelBatch,
  openDocumentStyleModel,
  createDocumentArchive,
  readArchive
} from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it.each(
  [
    "document",
    "styles",
    "package",
    "image",
    "template",
    "stream",
    "vfs",
    "batch",
    "create",
    "archive"
  ].flatMap((factory) => ["shared", "detached"].map((storage) => ({ factory, storage })))
)("rejects $storage bytes during $factory admission", async ({ factory, storage }) => {
  const original =
    factory === "image" ? rasterPng() : await textFixture(paragraph("Explicit byte ownership"));
  const bytes =
    storage === "shared"
      ? new Uint8Array(new SharedArrayBuffer(original.length))
      : new Uint8Array(original.length);
  bytes.set(original);
  if (storage === "detached")
    structuredClone(bytes.buffer, { transfer: [bytes.buffer as ArrayBuffer] });
  const finish = vi.fn();
  const open = async function* () {
    try {
      yield bytes;
    } finally {
      finish();
    }
  };
  const vfs = { open };
  const pending =
    factory === "document"
      ? Document(bytes, textContext)
      : factory === "styles"
        ? openDocumentStyleModel(bytes, textContext)
        : factory === "package"
          ? PackageView.open(bytes, textContext)
          : factory === "image"
            ? Image.from_blob(bytes, textContext)
            : factory === "template"
              ? Document(null, { ...textContext, template: bytes })
              : factory === "stream"
                ? Document({ open }, textContext)
                : factory === "vfs"
                  ? Document({ path: "/file", capability: vfs }, { ...textContext, vfs })
                  : factory === "create"
                    ? createDocumentArchive({ template: bytes }, textContext)
                    : factory === "archive"
                      ? readArchive(bytes, textContext)
                      : applyStyleModelBatch(
                          original,
                          {
                            version: 1,
                            operations: [
                              {
                                operation: "model.package.Package.open.call",
                                arguments: { pkgFile: bytes }
                              }
                            ]
                          },
                          textContext
                        );
  expect(pending).toBeInstanceOf(Promise);
  // A fulfilled model is reduced to avoid dumping unrelated object graphs on red runs.
  const error = await pending.then(
    () => null,
    (error) => error
  );
  expect(error).toMatchObject({ code: "usage" });
  if (factory === "stream" || factory === "vfs") expect(finish).toHaveBeenCalledOnce();
});

it("admits a bounded ordinary subarray without invoking overridden byte accessors", async () => {
  const original = rasterPng();
  const backing = new Uint8Array(original.length + 8);
  backing.set(original, 4);
  const bytes = backing.subarray(4, 4 + original.length);
  const getter = vi.fn(() => {
    throw new Error("Byte accessor executed");
  });
  for (const key of ["buffer", "byteOffset", "byteLength", "length"])
    Object.defineProperty(bytes, key, { get: getter });
  const image = await Image.from_blob(bytes, textContext);
  expect(image.blob).toEqual(original);
  expect(getter).not.toHaveBeenCalled();
});
