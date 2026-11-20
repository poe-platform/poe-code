import {expect, it, vi} from "vitest";
import {convert, createConverter} from "./index.js";

it.each([
  ["mermaid", "flowchart LR\nA[Start] --> B[Finish]"],
  ["graphviz", "digraph G { Start -> Finish; }"],
] as const)("returns a semantic scene and canonical SVG for %s", async (format, source) => {
  const result = await convert({mode: "drawing", format, source});
  expect(result.scene.width).toBeGreaterThan(0);
  expect(result.scene.height).toBeGreaterThan(0);
  expect(result.scene.nodes.length).toBeGreaterThan(0);
  expect(result.svg).toContain("<svg");
  expect(result.svg).toContain("Start");
  expect(result.svg).toContain("Finish");
  for (const format of ["docx", "pdf"] as const) {
    const output = await convert({mode: "pandoc", format, document: {blocks: [{t: "Vector", c: result.scene}], metadata: {}}});
    expect(output.bytes.length).toBeGreaterThan(100);
  }
});

it("rejects unsupported and oversized drawing sources before loading WASM", async () => {
  const load = vi.fn(async () => new Uint8Array());
  const converter = createConverter(load);
  // @ts-expect-error SVG is output, not a supported drawing source.
  await expect(converter({mode: "drawing", format: "svg", source: "<svg/>"})).rejects.toThrow("Unsupported document format");
  await expect(converter({mode: "drawing", format: "mermaid", source: "x".repeat(1024 * 1024 + 1)})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(converter({mode: "drawing", format: "mermaid", source: "flowchart LR\nA-->B"}, {signal: AbortSignal.abort()})).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(load).not.toHaveBeenCalled();
});

it.each([
  ["mermaid", "flowchart LR\nA[Start] --> B[Finish]"],
  ["graphviz", "digraph { Start -> Finish }"]
] as const)("applies injected %s styling inside Rust before export", async (format, source) => {
  const themed = await convert({mode:"drawing",format,source,theme:{light:{fontFamily:"JetBrains Mono",fontSize:20,text:"#123456",border:"#aabbcc",edge:"#345678",canvas:"#ffffff"}}});
  expect(themed.svg).toContain("JetBrains Mono");
  for(const color of ["#123456","#aabbcc","#345678"]) expect(themed.svg).toContain(color);
  for(const format of ["pdf","docx"] as const) {
    const output=await convert({mode:"pandoc",format,document:{blocks:[{t:"Vector",c:themed.scene}],metadata:{}}});
    expect(output.bytes.length).toBeGreaterThan(100);
  }
  const plain=await convert({mode:"drawing",format,source});
  expect(plain.svg).not.toContain("#123456");
  await expect(convert({mode:"drawing",format,source,theme:{light:{fontSize:0}}})).rejects.toThrow("positive finite number");
  await expect(convert({mode:"drawing",format,source,theme:{light:{text:"invalid-color"}}})).rejects.toThrow();
});
