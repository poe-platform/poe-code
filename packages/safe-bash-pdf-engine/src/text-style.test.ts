import { expect, it } from "vitest";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { renderPdf, suppliedDefaultFont, type Placement } from "./index.js";

const fonts = [suppliedDefaultFont()];
const context = { yield: async () => {} };

it("renders bold, oblique, and struck text with explicit PDF graphics operators", async () => {
  const bytes = await renderPdf({ fonts, blocks: [{ kind: "paragraph", runs: [
    { text: "normal " }, { text: "bold ", bold: true },
    { text: "italic ", italic: true }, { text: "both ", bold: true, italic: true },
    { text: "removed", strikeout: true }, { text: " plain" }
  ] }] }, context);
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPages()[0]!.node.Contents()!;
  if (!(contents instanceof PDFArray)) throw new Error("Expected page content array");
  const operators = Array.from({ length: contents.size() }, (_, i) =>
    new TextDecoder().decode(decodePDFRawStream(contents.lookup(i, PDFRawStream)).decode())
  ).join("\n");
  expect(operators).toContain("2 Tr");
  expect(operators).toContain("0 Tr");
  expect(operators).toContain("1 0 0.2 1 ");
  expect(operators.split("\n").filter(line => line === "S")).toHaveLength(1);
});

it("aligns wrapped table cells on every page and repeats aligned headers", async () => {
  const boxes: Placement[] = [];
  const p = (text: string, align: "left" | "center" | "right") => ({ kind: "paragraph" as const, runs: [{ text }], align });
  await renderPdf({ fonts, page: { width: 320, height: 100, margin: 10 }, blocks: [{
    kind: "table", widths: [1 / 3, 1 / 3, 1 / 3], headerRows: 1, rowSplit: "lines",
    rows: [[p("L", "left"), p("C", "center"), p("R", "right")],
      [p("a\nb\nc\nd\ne\nf", "left"), p("c\nd", "center"), p("r\ns", "right")]]
  }] }, { ...context, onPlacement: box => boxes.push(box) });
  expect(new Set(boxes.map(box => box.page)).size).toBeGreaterThan(1);
  for (const box of boxes.filter(box => box.kind === "text")) {
    const cell = boxes.find(cell => cell.kind === "cell" && cell.page === box.page &&
      box.y >= cell.y && box.y < cell.y + cell.height && box.x >= cell.x && box.x < cell.x + cell.width)!;
    if (cell.x < 100) expect(box.x).toBeCloseTo(cell.x + 4);
    else if (cell.x < 200) expect(box.x + box.width / 2).toBeCloseTo(cell.x + cell.width / 2);
    else expect(box.x + box.width).toBeCloseTo(cell.x + cell.width - 4);
  }
});

it("places a horizontal rule within the page and keeps a preceding heading with it", async () => {
  const boxes: Placement[] = [];
  const p = (text: string) => ({ kind: "paragraph" as const, runs: [{ text }], spaceAfter: 0 });
  await renderPdf({ fonts, page: { width: 160, height: 100, margin: 10 }, blocks: [
    p("a\nb\nc\nd"), { ...p("heading"), keepWithNext: true }, { kind: "rule", indent: 18 }, p("after")
  ] }, { ...context, onPlacement: box => boxes.push(box) });
  const rule = boxes.find(box => box.kind === "rule")!;
  expect(rule).toMatchObject({ page: 2, x: 28, width: 122 });
  expect(boxes.find(box => box.text === "heading")!.page).toBe(rule.page);
  for (const box of boxes) expect(box.y + box.height).toBeLessThanOrEqual(90);
});

it("positions super/subscripts and paints inline highlights without changing neighboring baselines", async () => {
  const bytes = await renderPdf({fonts, blocks:[{kind:"paragraph", runs:[
    {text:"base"}, {text:"up",size:8,rise:4}, {text:"down",size:8,rise:-2}, {text:"mark",background:"FFF3A3"}, {text:"plain"}
  ]}]}, context);
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPages()[0]!.node.Contents() as PDFArray;
  const operators = Array.from({length:contents.size()},(_,i)=>new TextDecoder().decode(decodePDFRawStream(contents.lookup(i,PDFRawStream)).decode())).join("\n");
  const baselines = operators.split("\n").filter(line=>line.endsWith(" Tm")).map(line=>Number(line.split(" ")[5]));
  expect(baselines[1]! - baselines[0]!).toBeCloseTo(4);
  expect(baselines[2]! - baselines[0]!).toBeCloseTo(-2);
  expect(baselines.at(-1)).toBe(baselines[0]);
  expect(operators).toContain("1 0.9529411764705882 0.6392156862745098 rg");
  expect(operators).toContain("h\nf");
});

it("keeps inline images between adjacent text on the same line", async () => {
  const {encode} = await import("jpeg-js");
  const bytes = new Uint8Array(encode({width:2,height:1,data:new Uint8Array(8).fill(255)},80).data);
  const boxes: Placement[]=[];
  await renderPdf({fonts,blocks:[{kind:"paragraph",runs:[{text:"before "},{text:"",image:{bytes,media:"jpeg",width:20,height:10}},{text:" after"}]}]}, {...context,onPlacement:box=>boxes.push(box)});
  const image=boxes.find(box=>box.kind==="image")!;
  expect(image).toBeDefined();
  expect(image.x).toBeGreaterThan(48);
  expect(boxes.filter(box=>box.kind==="text").map(box=>box.text).join("")).toBe("before  after");
  expect(new Set(boxes.map(box=>box.page))).toEqual(new Set([1]));
});
