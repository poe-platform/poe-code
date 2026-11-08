import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "../document.js";
import { PdfRetainedDocument } from "../retained-document.js";
import { PdfFileSource } from "../source.js";
import {
  cosArray,
  cosBool,
  cosDict,
  cosName,
  cosNumber,
  cosStream,
  dictSet,
  type PdfPixelStorage
} from "../ast.js";
import { renderDisplayListToBitmap, renderOperationStreamWindow } from "../render/raster.js";

it.each(["group", "mask", "backdrop"])(
  "spills growing %s captures and preserves exact compositing",
  async (mode) => {
    const original = PdfDocument.create(),
      page = original.addPage(),
      nums = (values: number[]) => cosArray(values.map((n) => cosNumber(n)));
    dictSet(page.pageDict, "MediaBox", nums([0, 0, 16, 16]));
    const form = original.cos.allocateObject(
      cosStream(
        new TextEncoder().encode(
          (mode === "backdrop" ? "/B gs " : "") + "0.2 0.3 0.7 rg 0.125 0.25 12 12 re f ".repeat(80)
        ),
        {
          dict: cosDict({
            Type: cosName("XObject"),
            Subtype: cosName("Form"),
            BBox: nums([0, 0, 16, 16]),
            Resources: cosDict({ ExtGState: cosDict({ B: cosDict({ BM: cosName("Multiply") }) }) }),
            Group: cosDict({ S: cosName("Transparency"), I: cosBool(mode !== "backdrop") })
          })
        }
      )
    );
    dictSet(
      page.pageDict,
      "Resources",
      cosDict({
        XObject: cosDict({ F: form }),
        ExtGState: cosDict({
          A: cosDict({ ca: cosNumber(0.5) }),
          M: cosDict({ SMask: cosDict({ S: cosName("Luminosity"), G: form }) })
        })
      })
    );
    dictSet(
      page.pageDict,
      "Contents",
      original.cos.allocateObject(
        cosStream(
          new TextEncoder().encode(
            mode === "mask"
              ? "/M gs 1 0 0 rg 0 0 16 16 re f"
              : mode === "backdrop"
                ? "0 1 0 rg 0 0 16 16 re f /A gs /F Do"
                : "/F Do"
          )
        )
      )
    );
    const expected = renderDisplayListToBitmap(page.evaluateDisplayList(), {
      scale: 1,
      transparent: mode !== "backdrop"
    });
    const fs = createMemoryFileSystem();
    await fs.mkdir("/scratch");
    await fs.writeFile("/input", original.save());
    const index = { fs, directory: "/scratch" },
      source = await PdfFileSource.open(fs, "/input"),
      document = await PdfRetainedDocument.open(source, index);
    const bytes = new Uint8Array(16 * 1024 * 1024);
    let end = 0;
    const storage: PdfPixelStorage = {
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
        this.length + items.length > 64 &&
        items.some(
          (item) =>
            item &&
            typeof item === "object" &&
            "kind" in item &&
            "value" in item &&
            (item.kind === "path" ||
              item.kind === "image" ||
              item.kind === "glyph" ||
              item.kind === "group")
        )
      )
        throw new Error("Collected composite operations");
      return Reflect.apply(push, this, items) as number;
    };
    try {
      const retained = (await document.pages().next()).value!;
      const actual = await renderOperationStreamWindow(
        { width: 16, height: 16 },
        async function* () {
          for await (const event of retained.evaluateSteps(index, { imageStorage: storage }))
            if (!event.captured) yield event.operation;
        },
        { x: 0, y: 0, width: 16, height: 16 },
        { scale: 1, transparent: mode !== "backdrop" }
      );
      expect(actual.data).toEqual(expected.data);
    } finally {
      Array.prototype.push = push;
      await document.close();
      await source.close();
      expect(await fs.readdir("/scratch")).toEqual([]);
    }
  }
);

it("replays capture snapshots using bounded borrowed reads and preserves storage references", async () => {
  const { StoredOperationsWriter, readStoredOperations } = await import("./stored-operations.js");
  const bytes = new Uint8Array(2 ** 20),
    scratch = new Uint8Array(4096);
  let end = 0,
    peak = 0;
  const storage: PdfPixelStorage = {
    allocate(n) {
      const at = end;
      end += n;
      return at;
    },
    async read(at, n) {
      peak = Math.max(peak, n);
      scratch.set(bytes.subarray(at, at + n));
      return scratch.subarray(0, n);
    },
    async write(at, b) {
      peak = Math.max(peak, b.length);
      bytes.set(b, at);
    }
  };
  const writer = new StoredOperationsWriter(storage);
  const operation = {
    kind: "path" as const,
    value: {
      segments: [],
      strokeWidth: 1,
      storedSegments: {
        kind: "stored-path" as const,
        storage,
        position: 0,
        count: 0,
        bounds: [Infinity, Infinity, -Infinity, -Infinity] as const
      }
    }
  };
  await writer.append(operation);
  const snapshot = writer.snapshot();
  for (let i = 0; i < 300; i++)
    await writer.append({ ...operation, value: { ...operation.value, strokeWidth: i } });
  let count = 0;
  for await (const value of readStoredOperations(snapshot)) {
    expect(value).toEqual(operation);
    expect(value.value).toHaveProperty("storedSegments.storage", storage);
    count++;
  }
  expect(count).toBe(1);
  for (let pass = 0; pass < 2; pass++) {
    count = 0;
    for await (const value of readStoredOperations(writer.snapshot())) {
      expect(value.kind).toBe("path");
      count++;
    }
    expect(count).toBe(301);
  }
  expect(peak).toBeLessThanOrEqual(4096);
});

it("preserves backing failures and cancellation during capture replay", async () => {
  const { StoredOperationsWriter, readStoredOperations } = await import("./stored-operations.js");
  const reason = { reason: "stop capture" },
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
  const writer = new StoredOperationsWriter(storage),
    operation = { kind: "path" as const, value: { segments: [], strokeWidth: 1 } };
  await expect(writer.append(operation)).rejects.toBe(reason);
  const snapshot = { ...writer.snapshot(), position: 0, count: 1 };
  await expect(readStoredOperations(snapshot).next()).rejects.toBe(reason);
  controller.abort(reason);
  await expect(readStoredOperations(snapshot, controller.signal).next()).rejects.toBe(reason);
  await expect(
    new StoredOperationsWriter(storage, controller.signal).append(operation)
  ).rejects.toBe(reason);
});

it("round-trips numeric edge values and UTF-16 across record ranges", async () => {
  const { StoredOperationsWriter, readStoredOperations } = await import("./stored-operations.js");
  const bytes = new Uint8Array(32768);
  let end = 0,
    peak = 0;
  const storage: PdfPixelStorage = {
    allocate(n) {
      const at = end;
      end += n;
      return at;
    },
    async read(at, n) {
      peak = Math.max(peak, n);
      return bytes.subarray(at, at + n);
    },
    async write(at, b) {
      peak = Math.max(peak, b.length);
      bytes.set(b, at);
    }
  };
  const operation = {
    kind: "path" as const,
    value: {
      segments: [],
      strokeWidth: -0,
      blendMode: "🙂".repeat(2500) + "\ud800\u0000",
      fillAlpha: NaN
    }
  };
  const writer = new StoredOperationsWriter(storage);
  await writer.append(operation);
  const actual = (await readStoredOperations(writer.snapshot()).next()).value;
  expect(actual).toEqual(operation);
  expect(peak).toBeLessThanOrEqual(4096);
});
