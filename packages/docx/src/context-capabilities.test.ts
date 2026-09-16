import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { Document, Image, PackageView, InputTypeError, openDocumentStyleModel } from "./index.js";
import { modelContext } from "./model-context.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readArchive } from "./index.js";

async function fixture() {
  const bytes = await textFixture(paragraph("Admitted estuary"));
  const volume = Volume.fromJSON({
    "/source.docx": Buffer.from(bytes),
    "/mark.png": Buffer.from(rasterPng()),
    "/unowned": "retain"
  });
  const open = vi.fn(async function* (path: string) {
    yield new Uint8Array(volume.readFileSync(path) as Buffer);
  });
  return { bytes, volume, open, vfs: { open } };
}

it.each(["document", "styles", "package", "image"])(
  "admits an explicitly matched object capability in %s",
  async (kind) => {
    const { vfs, open } = await fixture();
    const input = { path: kind === "image" ? "/mark.png" : "/source.docx", capability: vfs };
    const context = { ...textContext, vfs };
    const pending =
      kind === "document"
        ? Document(input as never, context)
        : kind === "styles"
          ? openDocumentStyleModel(input as never, context)
          : kind === "package"
            ? PackageView.open(input as never, context)
            : Image.from_file(input as never, context);
    expect(pending).toBeInstanceOf(Promise);
    const value = await pending;
    expect(value).toBeDefined();
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      input.path,
      expect.objectContaining({ signal: expect.any(AbortSignal), maxBytes: expect.any(Number) })
    );
  }
);

it("rejects foreign and missing object authority before opening either capability", async () => {
  const { vfs, open } = await fixture();
  const foreign = { open };
  for (const context of [{}, { vfs: foreign }, { binaryResolver: { capability: "owned", open } }]) {
    await expect(
      Document({ path: "/source.docx", capability: vfs } as never, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  }
  expect(open).not.toHaveBeenCalled();
});

it.each(["/a\\b", "/a\u0001b", "/a\ud800", "/a/../b", "/a//b", "relative", "/"])(
  "rejects malformed virtual path %j before authority",
  async (path) => {
    const { open } = await fixture();
    const context = { ...textContext, binaryResolver: { capability: "owned", open } };
    await expect(Document({ path, capability: "owned" }, context)).rejects.toBeInstanceOf(
      RangeError
    );
    await expect(Image.from_file({ path, capability: "owned" }, context)).rejects.toBeInstanceOf(
      RangeError
    );
    expect(open).not.toHaveBeenCalled();
  }
);

it("admits a copied context template through document and style factories", async () => {
  const { bytes } = await fixture();
  const pending = Document(null, { ...textContext, template: bytes } as never);
  bytes.fill(0);
  expect((await pending).paragraphs[0]!.text).toBe("Admitted estuary");
  const template = await textFixture(paragraph("Style template"));
  const style = await openDocumentStyleModel(undefined, { ...textContext, template } as never);
  const volume = Volume.fromJSON({ "/saved": "" });
  await style.save({
    async write(bytes) {
      volume.appendFileSync("/saved", bytes);
    }
  });
  expect(
    (await Document(new Uint8Array(volume.readFileSync("/saved") as Buffer), textContext))
      .paragraphs[0]!.text
  ).toBe("Style template");
});

it("rejects malformed, over-budget and conflicting templates before source acquisition", async () => {
  const { bytes, open } = await fixture();
  await expect(
    Document(undefined, { ...textContext, template: new Uint8Array([1, 2]) } as never)
  ).rejects.toMatchObject({ code: "invalid-container" });
  await expect(
    Document(undefined, {
      ...textContext,
      template: bytes,
      limits: { ...textContext.limits, maxArchiveBytes: bytes.length - 1 }
    } as never)
  ).rejects.toMatchObject({ code: "limit-exceeded" });
  await expect(
    Document({ open } as never, { ...textContext, template: bytes } as never)
  ).rejects.toBeInstanceOf(InputTypeError);
  expect(open).not.toHaveBeenCalled();
});

it("rejects nested capability accessors without invoking them", async () => {
  const get = vi.fn(() => () => 1);
  for (const key of ["vfs", "fonts"] as const) {
    const value = Object.defineProperty({}, key === "vfs" ? "open" : "measure", { get });
    await expect(Document(undefined, { [key]: value } as never)).rejects.toBeInstanceOf(
      InputTypeError
    );
  }
  expect(get).not.toHaveBeenCalled();
});

it("captures font selection, identity, time and named limits before awaits", async () => {
  const fonts = { measure: vi.fn(() => 23) };
  const timestamp = new Date("2026-09-15T01:02:03.456Z");
  const context = { fonts, timestamp, author: "Estuary", limits: { tableRows: 2 } };
  const pending = Document(undefined, context as never);
  fonts.measure = vi.fn(() => 999);
  timestamp.setUTCFullYear(2001);
  context.author = "Later";
  context.limits.tableRows = 100;
  const document = await pending;
  const admitted = document.store.context as ReturnType<typeof modelContext> & {
    fonts: { measure(text: string, font: string, points: number): number };
  };
  expect(admitted.fonts.measure("tide", "Admitted", 12)).toBe(23);
  expect(document.core_properties.author).toBe("Estuary");
  expect(document.core_properties.created?.toISOString()).toBe("2026-09-15T01:02:03.000Z");
  expect(() => document.add_table(3, 1)).toThrow(
    expect.objectContaining({ code: "limit-exceeded" })
  );
  expect(Object.isFrozen(admitted)).toBe(true);
});

it("captures package bytes and context before its asynchronous module load", async () => {
  const { bytes } = await fixture();
  const pending = PackageView.open(bytes, textContext);
  bytes.fill(0);
  expect((await pending).main_document_part.blob).toEqual(expect.any(Uint8Array));
});

it("refuses a template on an image factory instead of ignoring the field", async () => {
  const { bytes } = await fixture();
  await expect(
    Image.from_blob(rasterPng(), { ...textContext, template: bytes } as never)
  ).rejects.toBeInstanceOf(InputTypeError);
});

it("captures object and token methods before a pending read and closes only owned iteration", async () => {
  for (const mode of ["object", "token"] as const) {
    const { bytes, volume } = await fixture();
    let release!: () => void,
      started!: () => void,
      closed = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entry = new Promise<void>((resolve) => {
      started = resolve;
    });
    const open = vi.fn(async function* (path: string) {
      try {
        expect(path).toBe("/source.docx");
        started();
        await gate;
        yield bytes;
      } finally {
        await Promise.resolve();
        closed++;
      }
    });
    const vfs = { open },
      resolver = { capability: "owned", open };
    const input = { path: "/source.docx", capability: mode === "object" ? vfs : "owned" };
    const registered: (() => Promise<void>)[] = [];
    const context = {
      ...textContext,
      vfs,
      binaryResolver: resolver,
      registerCleanup(cleanup: () => Promise<void>) {
        registered.push(cleanup);
      }
    };
    const pending = Document(input, context);
    await entry;
    input.path = "/unowned";
    vfs.open = vi.fn();
    resolver.open = vi.fn();
    resolver.capability = "other";
    release();
    expect((await pending).paragraphs[0]!.text).toBe("Admitted estuary");
    await Promise.all(registered.flatMap((cleanup) => [cleanup(), cleanup()]));
    expect(closed).toBe(1);
    expect(volume.readFileSync("/unowned", "utf8")).toBe("retain");
  }
});

it.each(["cancel", "bytes"])(
  "settles object capability cleanup on %s rejection",
  async (failure) => {
    const controller = new AbortController();
    let closed = 0,
      advanced = false;
    const vfs = {
      async *open(_path: string, options: { signal: AbortSignal; maxBytes: number }) {
        try {
          expect(options.maxBytes).toBe(2);
          if (failure === "cancel") controller.abort();
          yield new Uint8Array(3);
          advanced = true;
        } finally {
          await Promise.resolve();
          closed++;
        }
      }
    };
    await expect(
      Document(
        { path: "/input", capability: vfs },
        {
          ...textContext,
          vfs,
          signal: controller.signal,
          limits: { ...textContext.limits, maxArchiveBytes: 2 }
        }
      )
    ).rejects.toMatchObject({ code: failure === "cancel" ? "cancelled" : "limit-exceeded" });
    expect(closed).toBe(1);
    expect(advanced).toBe(false);
  }
);

it("bounds selected metric results, work and cancellation without a font lookup", () => {
  for (const width of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const context = modelContext({ fonts: { measure: () => width } });
    expect(() => context.fonts!.measure("ebb", "Supplied", 12)).toThrow(RangeError);
  }
  const measure = vi.fn(() => 3),
    controller = new AbortController();
  const context = modelContext({
    fonts: { measure },
    signal: controller.signal,
    limits: { work: 10 }
  });
  expect(() => context.fonts!.measure("a".repeat(11), "Supplied", 12)).toThrow(
    expect.objectContaining({ code: "limit-exceeded" })
  );
  controller.abort();
  expect(() => context.fonts!.measure("a", "Supplied", 12)).toThrow(
    expect.objectContaining({ code: "cancelled" })
  );
  expect(measure).not.toHaveBeenCalled();
});

it("does not advance a source returned after cancellation during resolver admission", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = vi.fn(async () => ({ done: true as const, value: undefined }));
  const iterator = vi.fn(() => ({ next }));
  const vfs = {
    async open() {
      await waiting;
      return { [Symbol.asyncIterator]: iterator };
    }
  };
  const pending = Document(
    { path: "/input", capability: vfs },
    { ...textContext, vfs, signal: controller.signal }
  );
  controller.abort();
  release();
  await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  expect(iterator).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});

it("keeps copied metadata and template values immutable even through admitted-context access", async () => {
  const { bytes } = await fixture();
  const admitted = modelContext({
    ...textContext,
    template: bytes,
    timestamp: new Date("2026-09-15T00:00:00Z")
  });
  admitted.timestamp!.setUTCFullYear(2000);
  admitted.template!.fill(0);
  expect(admitted.timestamp!.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  expect((await Document(null, admitted)).paragraphs[0]!.text).toBe("Admitted estuary");
});

it.each([{}, { open: 1 }, Object.create({ open() {} })])(
  "rejects malformed object capabilities without ambient lookup",
  async (vfs) => {
    await expect(Document(undefined, { vfs } as never)).rejects.toBeInstanceOf(InputTypeError);
  }
);

it("charges one measurement when a captured font capability crosses context admission", () => {
  const first = modelContext({ fonts: { measure: () => 2 } });
  const second = modelContext({ fonts: first.fonts!, limits: { work: 9 } });
  expect(second.fonts!.measure("ebb", "Font", 12)).toBe(2);
  expect(second.budget.usage.work).toBe(8);
  expect(first.budget.usage.work).toBe(0);
});

it("creates an undated original document when no timestamp is supplied", async () => {
  const model = await Document();
  const volume = Volume.fromJSON({ "/saved": "" });
  await model.save({
    async write(bytes) {
      volume.appendFileSync("/saved", bytes);
    }
  });
  const archive = await readArchive(
    new Uint8Array(volume.readFileSync("/saved") as Buffer),
    textContext
  );
  expect(
    archive.members.some((member) =>
      new TextDecoder().decode(member.bytes).includes("<dcterms:created")
    )
  ).toBe(false);
  expect(
    archive.members.some((member) =>
      new TextDecoder().decode(member.bytes).includes("<dcterms:modified")
    )
  ).toBe(false);
});

it("requires explicit time before dated comment or core-property materialization", async () => {
  const model = await Document(await textFixture(paragraph("Undated")), textContext);
  const comments = model.comments;
  const revision = model.store.revision;
  expect(() => comments.add_comment("Time required")).toThrow(InputTypeError);
  expect(comments.length).toBe(0);
  expect(model.store.revision).toBe(revision);
  expect(() => model.core_properties).toThrow(InputTypeError);
  expect(model.store.revision).toBe(revision);
});

it("retains capability identity when an admitted context is spread into another admission", async () => {
  const { vfs } = await fixture();
  const admitted = modelContext({ ...textContext, vfs });
  const image = await Image.from_file(
    { path: "/mark.png", capability: admitted.vfs! },
    { ...admitted }
  );
  expect(image.px_width).toBe(1);
});
