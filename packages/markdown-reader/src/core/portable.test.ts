import { expect, it, vi } from "vitest";
import { sliceMarkdownBytes } from "./document.js";
import { scanMarkdown } from "./scan.js";

it("cold-imports the document and scanner without Buffer", async () => {
  vi.resetModules();
  vi.stubGlobal("Buffer", undefined);
  try {
    const { sliceMarkdownBytes: slice } = await import("./document.js");
    const { scanMarkdown: scan } = await import("./scan.js");
    expect(slice("é🌍", 2, 6)).toBe("🌍");
    expect(scan("# é🌍\nbody")[0]!.bodyEnd).toBe(13);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("scans Unicode headings and comments without a Buffer global", () => {
  const source = "---\ntitle: café\n---\n# 🌍\n<!-- é\n## hidden\n-->\n## Visible\n\uFEFFbody\n";
  const expected = scanMarkdown(source);
  vi.stubGlobal("Buffer", undefined);
  try {
    expect(scanMarkdown(source)).toEqual(expected);
    expect(expected.map(section => section.title)).toEqual(["🌍", "Visible"]);
    const section = expected[1]!;
    expect(sliceMarkdownBytes(source, section.bodyStart, section.bodyEnd)).toContain("\uFEFFbody");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("preserves BOMs, partial UTF-8 sequences and lone surrogate replacement", () => {
  const sources = ["\uFEFFé🌍", "x\ud800y\udc00", "", "ASCII"];
  const cases = sources.flatMap(source => {
    const bytes = Buffer.from(source);
    return Array.from({ length: bytes.length + 1 }, (_, start) =>
      Array.from({ length: bytes.length + 1 }, (_, end) => ({
        source, start, end, expected: bytes.subarray(start, end).toString("utf8")
      }))
    ).flat();
  });
  vi.stubGlobal("Buffer", undefined);
  try {
    for (const { source, start, end, expected } of cases) {
      expect(sliceMarkdownBytes(source, start, end)).toBe(expected);
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
