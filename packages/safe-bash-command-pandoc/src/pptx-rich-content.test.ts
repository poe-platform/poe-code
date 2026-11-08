import {expect, it, vi} from "vitest";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {encode as jpeg} from "jpeg-js";
import {convert, writeDocument} from "./engine.js";
import type {Block, Inline} from "./ast-types.js";
const attr = ["", [], []] as const;
const str = (c: string): Inline => ({t: "Str", c});
const context = {yield: async () => {}};
vi.mock("../../office-package/src/runtime.js", async original => {
  const runtime = await original<typeof import("../../office-package/src/runtime.js")>();
  return {...runtime, yieldEventLoop: async () => {}, defaultRuntime: {...runtime.defaultRuntime, async yieldTurn(signal: AbortSignal) {signal.throwIfAborted();}}};
});
it("writes Divs, quoted code and horizontal rules to PPTX without rejecting ordinary blocks", async () => {
  const result = await writeDocument({blocks: [{t: "Div", c: [attr, [{t: "BlockQuote", c: [{t: "CodeBlock", c: [attr, "const n = 1;\nprint(n);"]}]}, {t: "HorizontalRule"}, {t: "Para", c: [{t: "Quoted", c: ["DoubleQuote", [str("Quote")]]}]}]]}], metadata: {}, resources: []}, {to: "pptx"}, context);
  if (result.kind !== "binary") throw new Error("Expected PPTX");
  const plain = await convert([{bytes: result.bytes}], {from: "pptx", to: "plain"}, context);
  expect(plain).toMatchObject({text: expect.stringContaining("const n = 1;")});
  expect(plain).toMatchObject({text: expect.stringContaining("print(n);")});
  expect(plain).toMatchObject({text: expect.stringContaining("“Quote”")});
});
it.each(["Strikeout", "Superscript", "Subscript"] as const)("preserves nested %s in PPTX", async t => {
  const result = await writeDocument({blocks: [{t: "Para", c: [{t: "Link", c: [attr, [{t: "Strong", c: [{t, c: [str("styled")]}]}], ["https://example.com", ""]]}]}], metadata: {}, resources: []}, {to: "pptx"}, context);
  if (result.kind !== "binary") throw new Error("Expected PPTX");
  const xml = new TextDecoder().decode(readZipArchiveEntries(result.bytes).get("ppt/slides/slide1.xml"));
  expect(xml).toContain(t === "Strikeout" ? 'strike="sngStrike"' : `baseline="${t === "Superscript" ? 30000 : -25000}"`);
  expect(xml).toContain('b="1"');
  expect(xml).toContain("hlinkClick");
});
it("embeds a standalone image nested in a Div", async () => {
  const block: Block = {t: "Div", c: [attr, [{t: "Para", c: [{t: "Image", c: [attr, [str("fruit")], ["fruit.jpg", ""]]}]}]]};
  const image = new Uint8Array(jpeg({width: 2, height: 1, data: Buffer.alloc(8, 255)}, 80).data);
  const result = await writeDocument({blocks: [block], metadata: {}, resources: [{id: "fruit.jpg", bytes: image}]}, {to: "pptx"}, context);
  if (result.kind !== "binary") throw new Error("Expected PPTX");
  expect([...readZipArchiveEntries(result.bytes)].some(([name, bytes]) => name.startsWith("ppt/media/") && Buffer.from(bytes).equals(image))).toBe(true);
});
it("preserves rich text and hyperlinks inside PPTX table cells", async () => {
  const result = await convert([{bytes: new TextEncoder().encode("| Name | Detail |\n|---|---|\n| **Fruit** | [site](https://example.com) and ~~old~~ |\n")}], {from: "gfm", to: "pptx"}, context);
  if (result.kind !== "binary") throw new Error("Expected PPTX");
  const parts = readZipArchiveEntries(result.bytes);
  const xml = new TextDecoder().decode(parts.get("ppt/slides/slide1.xml"));
  expect(xml).toContain('b="1"');
  expect(xml).toContain('strike="sngStrike"');
  expect(xml).toContain("hlinkClick");
  expect(new TextDecoder().decode(parts.get("ppt/slides/_rels/slide1.xml.rels"))).toContain("https://example.com");
  const plain = await convert([{bytes: result.bytes}], {from: "pptx", to: "plain"}, context);
  expect(plain).toMatchObject({text: expect.stringContaining("Fruit")});
  expect(plain).toMatchObject({text: expect.stringContaining("site and old")});
});

it("renders citations and paginates multi-section decks with multiple images across continuation slides", async () => {
  const img1 = new Uint8Array(jpeg({width: 4, height: 2, data: Buffer.alloc(32, 200)}, 80).data);
  const img2 = new Uint8Array(jpeg({width: 2, height: 2, data: Buffer.alloc(16, 120)}, 80).data);
  const md = [
    "# Executive Summary",
    "",
    "Overview with citation [@smith2024].",
    "",
    "## Matrix",
    "",
    "| Stage | Status |",
    "| --- | --- |",
    "| Build | PASS |",
    "| Test | PASS |",
    "| Release | PASS |",
    "| Verify | PASS |",
    "| Audit | PASS |",
    "",
    "## Visual Assets",
    "",
    "![Banner](banner.jpg)",
    "",
    "![Sheet](sheet.jpg)",
    ""
  ].join("\n");
  const result = await convert([{bytes: new TextEncoder().encode(md)}], {from: "markdown", to: "pptx"}, {
    ...context,
    resources: {resolve: async id => id === "banner.jpg" ? img1 : img2}
  });
  expect(result.kind).toBe("binary");
  if (result.kind !== "binary") throw new Error("Expected PPTX");
  const parts = readZipArchiveEntries(result.bytes);
  const mediaCount = [...parts.keys()].filter(name => name.startsWith("ppt/media/")).length;
  expect(mediaCount).toBe(2);
  const slideCount = [...parts.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  expect(slideCount).toBeGreaterThanOrEqual(2);
});
