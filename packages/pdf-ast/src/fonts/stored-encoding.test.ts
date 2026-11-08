import { expect, it } from "vitest";
import { cosArray, cosDict, cosName, cosNumber, type PdfCosNode } from "../ast.js";
import { buildFontEncodingDifferencesMap, buildFontEncodingGlyphNamesMap } from "./standard14.js";
import { StoredFontEncoding } from "./stored-encoding.js";

it.each(
  [
    [0, "65", "66", 2, "67"],
    [1, "0041", "0042", 0, "0000"],
    [2, "0x41", "0x42"],
    [0, "65", 7, "66"],
    [65, "A", 65, "not-a-known-glyph", 66, "fi", -2, "B", 1.5, "C"],
    [NaN, "A", NaN, "B", Infinity, "C", -0, "D", 0, "E"]
  ].map((declarations) => [declarations])
)("preserves buffered encoding heuristics and overwrite rules for %j", async (declarations) => {
  const nodes: PdfCosNode[] = declarations.map((value) =>
    typeof value === "number"
      ? { kind: "number", value, isInteger: Number.isInteger(value), raw: String(value) }
      : cosName(value)
  );
  const dict = cosDict({ Differences: cosArray(nodes) }),
    unicode = buildFontEncodingDifferencesMap(dict),
    names = buildFontEncodingGlyphNamesMap(dict);
  const bytes = new Uint8Array(2_000_000);
  let end = 19;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      bytes.fill(255, at, at + n);
      return at;
    },
    async read(at: number, n: number) {
      return bytes.subarray(at, at + n);
    },
    async write(at: number, data: Uint8Array) {
      expect(data.length).toBeLessThanOrEqual(4096);
      bytes.set(data, at);
    }
  };
  const encoding = await StoredFontEncoding.create(() => nodes, storage);
  for (const code of new Set([...unicode.keys(), ...names.keys(), 1000])) {
    expect(await encoding.unicode(code)).toBe(unicode.get(code));
    expect(await encoding.glyphName(code)).toBe(names.get(code));
  }
});

it("streams growing declarations with bounded resident cache and timer cancellation", async () => {
  const bytes = new Uint8Array(8_000_000);
  let end = 0,
    peak = 0;
  const controller = new AbortController();
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      peak = Math.max(peak, n);
      return bytes.subarray(at, at + n);
    },
    async write(at: number, data: Uint8Array) {
      peak = Math.max(peak, data.length);
      bytes.set(data, at);
    }
  };
  function* nodes(): Generator<PdfCosNode> {
    yield cosNumber(0);
    for (let i = 0; i < 4096; i++) yield cosName("A");
  }
  const encoding = await StoredFontEncoding.create(nodes, storage, { signal: controller.signal });
  for (const code of [0, 255, 4095, 4096])
    expect(await encoding.unicode(code)).toBe(code < 4096 ? "A" : undefined);
  expect(peak).toBeLessThanOrEqual(4096);
  const reason = new Error("cancelled");
  controller.abort(reason);
  await expect(encoding.glyphName(0)).rejects.toBe(reason);
});

it("preserves backend failure identity during construction and uncached lookup", async () => {
  const reason = new Error("remote failure");
  let failing = false,
    end = 0;
  const bytes = new Uint8Array(100000);
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      if (failing) throw reason;
      return bytes.subarray(at, at + n);
    },
    async write(at: number, data: Uint8Array) {
      if (failing) throw reason;
      bytes.set(data, at);
    }
  };
  const nodes = () => [cosNumber(65), cosName("A")];
  const encoding = await StoredFontEncoding.create(nodes, storage);
  failing = true;
  await expect(encoding.unicode(65)).rejects.toBe(reason);
  await expect(StoredFontEncoding.create(nodes, storage)).rejects.toBe(reason);
});

it("serializes concurrent label reads when radix cache eviction writes to backing", async () => {
  const bytes = new Uint8Array(2_000_000);
  let end = 0,
    writing = false;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      return bytes.subarray(at, at + n);
    },
    async write(at: number, data: Uint8Array) {
      if (writing) throw new Error("overlapping capability writes");
      writing = true;
      try {
        await Promise.resolve();
        bytes.set(data, at);
      } finally {
        writing = false;
      }
    }
  };
  function* nodes(): Generator<PdfCosNode> {
    yield cosNumber(0);
    for (let i = 0; i < 200; i++) yield cosName("A");
  }
  const encoding = await StoredFontEncoding.create(nodes, storage);
  expect(
    await Promise.all(Array.from({ length: 100 }, (_, code) => encoding.unicode(code)))
  ).toEqual(Array(100).fill("A"));
});
