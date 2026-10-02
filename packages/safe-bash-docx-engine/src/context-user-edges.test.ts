import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import {
  Document,
  Image,
  PackageView,
  InputTypeError,
  openDocumentStyleModel,
  resolveDocumentModelContext
} from "./index.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it.each(["document", "styles", "package", "image"])(
  "%s rejects missing, wrong, foreign and accessor-bearing authority before reads",
  async (factory) => {
    const open = vi.fn(async function* () {
      yield new Uint8Array();
    });
    const vfs = { open },
      foreign = { open };
    const context = { ...textContext, vfs, binaryResolver: { capability: "owned", open } };
    const getter = vi.fn(() => vfs);
    const inputs = [
      { path: "/file", capability: "foreign" },
      { path: "/file", capability: foreign },
      { path: "/file" },
      { path: "/file", capability: null },
      { path: "/file", capability: 1 },
      { path: "/file", capability: "" },
      Object.create({ path: "/file", capability: vfs }),
      Object.defineProperty({ path: "/file" }, "capability", { get: getter })
    ];
    for (const input of inputs) {
      const pending =
        factory === "document"
          ? Document(input as never, context)
          : factory === "styles"
            ? openDocumentStyleModel(input as never, context)
            : factory === "package"
              ? PackageView.open(input as never, context)
              : Image.from_file(input as never, context);
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).rejects.toHaveProperty("code");
    }
    expect(open).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  }
);

it.each(["object", "token"])(
  "bounds %s paths in UTF-8 bytes and retains a canonical Unicode name",
  async (mode) => {
    const path = "/海.png",
      bytes = rasterPng();
    const volume = Volume.fromJSON({ [path]: Buffer.from(bytes) });
    const open = vi.fn(async function* (path: string) {
      yield new Uint8Array(volume.readFileSync(path) as Buffer);
    });
    const vfs = { open };
    const context = {
      ...textContext,
      vfs,
      binaryResolver: { capability: "owned", open },
      limits: { ...textContext.limits, maxPathBytes: new TextEncoder().encode(path).length }
    };
    const input = { path, capability: mode === "object" ? vfs : "owned" };
    expect((await Image.from_file(input, context)).filename).toBe("海.png");
    await expect(
      Image.from_file(input, {
        ...context,
        limits: { ...context.limits, maxPathBytes: context.limits.maxPathBytes - 1 }
      })
    ).rejects.toMatchObject({ code: "limit-exceeded" });
    expect(open).toHaveBeenCalledOnce();
    expect(volume.readFileSync(path)).toEqual(Buffer.from(bytes));
  }
);

it.each(["object", "token"])("owns reused %s producer chunks before advancing", async (mode) => {
  const bytes = await textFixture(paragraph("Owned fragments"));
  const open = async function* () {
    const chunk = new Uint8Array(37);
    for (let offset = 0; offset < bytes.length; offset += chunk.length) {
      const count = Math.min(chunk.length, bytes.length - offset);
      chunk.set(bytes.subarray(offset, offset + count));
      yield chunk.subarray(0, count);
      chunk.fill(0);
    }
  };
  const vfs = { open };
  const model = await Document(
    { path: "/file", capability: mode === "object" ? vfs : "owned" },
    {
      ...textContext,
      vfs,
      binaryResolver: { capability: "owned", open }
    }
  );
  expect(model.paragraphs[0]!.text).toBe("Owned fragments");
});

it.each([
  undefined,
  null,
  {},
  new Uint8Array(),
  { [Symbol.asyncIterator]: () => null },
  { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(null) }) }
])("classifies malformed VFS source %j as a typed input failure", async (source) => {
  const vfs = { open: () => source };
  await expect(
    Document({ path: "/file", capability: vfs } as never, { ...textContext, vfs } as never)
  ).rejects.toBeInstanceOf(InputTypeError);
});

it.each(["2026-02-30T00:00:00Z", "2026-09-16", "2026-09-16T01:02:03+00:00", "now"])(
  "rejects undeclared UTC timestamp %s without acquisition",
  async (timestamp) => {
    const open = vi.fn(async function* () {
      yield new Uint8Array();
    });
    await expect(
      resolveDocumentModelContext(
        { timestamp, template: { kind: "vfs", path: "/file", capability: "owned" } },
        {
          binaryResolver: { capability: "owned", open }
        }
      )
    ).rejects.toMatchObject({ code: "usage" });
    expect(open).not.toHaveBeenCalled();
  }
);

it.each([
  [null, "Explicit", 12],
  ["text", "", 12],
  ["text", {}, 12],
  ["text", "Explicit", 0],
  ["text", "Explicit", -1],
  ["text", "Explicit", Infinity],
  ["text", "Explicit", NaN],
  ["text", "Explicit", Number.MAX_SAFE_INTEGER + 1]
])(
  "validates metric inputs (%j, %j, %j) before calling the adapter",
  async (text, font, points) => {
    const measure = vi.fn(() => 1);
    const context = await resolveDocumentModelContext(undefined, { fonts: { measure } });
    expect(() => context.fonts!.measure(text as string, font as string, points as number)).toThrow(
      InputTypeError
    );
    expect(measure).not.toHaveBeenCalled();
  }
);
