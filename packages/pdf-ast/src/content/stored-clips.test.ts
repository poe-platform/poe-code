import { expect, it } from "vitest";
import type { PdfPixelStorage, PdfStoredClipPaths } from "../ast.js";
import { appendStoredClip, readStoredClips } from "./stored-clips.js";

it("preserves clip order and branched graphics-state snapshots with bounded borrowed reads", async () => {
  const bytes = new Uint8Array(4 * 1024 * 1024),
    scratch = new Uint8Array(4096);
  let end = 0,
    peak = 0;
  const storage: PdfPixelStorage = {
    allocate(n) {
      const at = end;
      end += n;
      return at;
    },
    async write(at, b) {
      peak = Math.max(peak, b.length);
      bytes.set(b, at);
    },
    async read(at, n) {
      peak = Math.max(peak, n);
      scratch.set(bytes.subarray(at, at + n));
      return scratch.subarray(0, n);
    }
  };
  let clips: PdfStoredClipPaths | undefined, snapshot: PdfStoredClipPaths | undefined;
  const clip = (index: number) => ({
    segments: [],
    storedSegments: {
      kind: "stored-path" as const,
      storage,
      position: 0,
      count: 0,
      bounds: [index, 0, index + 1, 1] as const
    },
    fillRule: index % 2 ? ("evenodd" as const) : ("nonzero" as const)
  });
  for (let i = 0; i < 140; i++) {
    clips = await appendStoredClip(storage, clips, clip(i));
    if (i === 20) snapshot = clips;
  }
  const branch = await appendStoredClip(storage, snapshot, clip(999));
  for (const [source, expected] of [
    [clips, Array.from({ length: 140 }, (_, i) => i)],
    [branch, [...Array.from({ length: 21 }, (_, i) => i), 999]],
    [snapshot, Array.from({ length: 21 }, (_, i) => i)]
  ] as const) {
    const actual = [];
    for await (const value of readStoredClips(source!)) {
      expect(value.segments).toEqual([]);
      actual.push(value.storedSegments!.bounds[0]);
      expect(value.fillRule).toBe(value.storedSegments!.bounds[0] % 2 ? "evenodd" : "nonzero");
    }
    expect(actual).toEqual(expected);
  }
  expect(peak).toBeLessThanOrEqual(4096);
});

it.each([
  "0.125 0.375 12 12 re W n q 1.375 0.125 10 11 re W* n 0 0 16 16 re f Q 1 0 0 rg 3 3 10 10 re f",
  "BT /F1 10 Tf 7 Tr " + "1 0 0 1 1 1 Tm (A) Tj ".repeat(128) + "ET 1 0 0 rg 0 0 16 16 re f"
])("preserves graphics-state forks and streamed text-clip unions: %s", async (content) => {
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
  const { PdfDocument } = await import("../document.js");
  const { PdfRetainedDocument } = await import("../retained-document.js");
  const { PdfFileSource } = await import("../source.js");
  const { cosArray, cosDict, cosName, cosNumber, cosStream, dictSet } = await import("../ast.js");
  const { renderDisplayListToBitmap, renderOperationStreamWindow } =
    await import("../render/raster.js");
  const original = PdfDocument.create(),
    page = original.addPage();
  dictSet(page.pageDict, "MediaBox", cosArray([0, 0, 16, 16].map((n) => cosNumber(n))));
  dictSet(
    page.pageDict,
    "Resources",
    cosDict({
      Font: cosDict({
        F1: cosDict({
          Type: cosName("Font"),
          Subtype: cosName("Type1"),
          BaseFont: cosName("Helvetica")
        })
      })
    })
  );
  dictSet(
    page.pageDict,
    "Contents",
    original.cos.allocateObject(cosStream(new TextEncoder().encode(content)))
  );
  const expected = renderDisplayListToBitmap(page.evaluateDisplayList(), {
    scale: 1,
    transparent: true
  });
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/input", original.save());
  const index = { fs, directory: "/scratch" },
    source = await PdfFileSource.open(fs, "/input"),
    document = await PdfRetainedDocument.open(source, index);
  const bytes = new Uint8Array(8 * 1024 * 1024);
  let end = 0,
    stored = false;
  const backing: PdfPixelStorage = {
    allocate(n) {
      const at = end;
      end += n;
      return at;
    },
    async read(at, n) {
      return bytes.subarray(at, at + n);
    },
    async write(at, b) {
      bytes.set(b, at);
    }
  };
  const push = Array.prototype.push;
  Array.prototype.push = function <T>(this: T[], ...items: T[]): number {
    if (
      this.length + items.length > 128 &&
      items.some(
        (item) =>
          item &&
          typeof item === "object" &&
          "kind" in item &&
          (item.kind === "move" || item.kind === "line" || item.kind === "cubic")
      )
    )
      throw new Error("Collected text clip geometry");
    return Reflect.apply(push, this, items) as number;
  };
  try {
    const retained = (await document.pages().next()).value!;
    const actual = await renderOperationStreamWindow(
      { width: 16, height: 16 },
      async function* () {
        for await (const event of retained.evaluateSteps(index, { imageStorage: backing })) {
          expect(event.operation.value.clipPaths).toBeUndefined();
          if (event.operation.value.storedClipPaths) stored = true;
          if (!event.captured) yield event.operation;
        }
      },
      { x: 0, y: 0, width: 16, height: 16 },
      { scale: 1, transparent: true }
    );
    expect(actual.data).toEqual(expected.data);
    expect(stored).toBe(true);
  } finally {
    Array.prototype.push = push;
    await document.close();
    await source.close();
    expect(await fs.readdir("/scratch")).toEqual([]);
  }
});

it("rejects impossible clip metadata before touching storage", async () => {
  const storage: PdfPixelStorage = {
    allocate() {
      throw new Error("unexpected allocate");
    },
    async read() {
      throw new Error("unexpected read");
    },
    async write() {
      throw new Error("unexpected write");
    }
  };
  const source: PdfStoredClipPaths = {
    kind: "stored-clips",
    storage,
    position: 0,
    count: 65,
    height: 0
  };
  await expect(readStoredClips(source).next()).rejects.toThrow("Invalid stored clip vector");
});

it("preserves cancellation and backing failure identity", async () => {
  const reason = { reason: "cancel clips" },
    controller = new AbortController();
  const storage: PdfPixelStorage = {
    allocate() {
      return 0;
    },
    async read() {
      throw reason;
    },
    async write() {
      throw reason;
    }
  };
  const source: PdfStoredClipPaths = {
    kind: "stored-clips",
    storage,
    position: 0,
    count: 1,
    height: 0
  };
  const clip = { segments: [], fillRule: "nonzero" as const };
  await expect(readStoredClips(source).next()).rejects.toBe(reason);
  await expect(appendStoredClip(storage, undefined, clip)).rejects.toBe(reason);
  controller.abort(reason);
  await expect(readStoredClips(source, controller.signal).next()).rejects.toBe(reason);
  await expect(appendStoredClip(storage, undefined, clip, controller.signal)).rejects.toBe(reason);
});
