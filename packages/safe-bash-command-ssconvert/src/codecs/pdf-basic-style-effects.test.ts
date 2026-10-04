import {expect, it, vi} from "vitest";
import {PDFPage, PDFName, PDFDict, PDFNumber, PDFArray, PDFRawStream, decodePDFRawStream, rgb} from "pdf-lib";
import {suppliedDefaultFont} from "safe-bash-pdf-engine";
import type {CapabilityContext, FontCapability} from "../contracts.js";
import {createFormattingCapability} from "@poe-code/spreadsheet-engine/formatting";
import {readGnumeric} from "./gnumeric.js";
import {writePdf} from "./pdf.js";
import {pdfText} from "./pdf-text.test-support.js";
const context: CapabilityContext = {signal: new AbortController().signal, own() {},
  environment: {env: {}, locale: "C", timezone: "UTC"},
  limits: {inputBytes: 1000000, outputBytes: 4000000, workbookWork: 6000000, cells: 10000, sheets: 4, operations: 100}};
const attributes = 'HAlign="GNM_HALIGN_GENERAL" VAlign="GNM_VALIGN_BOTTOM" WrapText="0" ShrinkToFit="0" Rotation="0" Shade="0" Indent="0" Locked="1" Hidden="0" Fore="0:0:0" Back="FFFF:FFFF:FFFF" PatternColor="0:0:0" Format="General"';
const font = '<g:Font Unit="10" Bold="0" Italic="0" Underline="0" StrikeThrough="0" Script="0">Sans</g:Font>';
async function fixture(cases: readonly {text: string; attributes?: string; font?: string; type?: string}[]) {
  return readGnumeric(new TextEncoder().encode(`<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets><g:Sheet><g:Name>S</g:Name><g:Cols DefaultSizePts="72"/><g:Rows DefaultSizePts="20"/><g:PrintInformation><g:paper>na_letter</g:paper><g:Margins><g:top Points="72"/><g:bottom Points="72"/><g:left Points="72"/><g:right Points="72"/></g:Margins><g:Header Left="" Middle="" Right=""/><g:Footer Left="" Middle="" Right=""/></g:PrintInformation><g:Styles>${cases.map((c, row) => `<g:StyleRegion startRow="${row}" endRow="${row}" startCol="0" endCol="0"><g:Style ${c.attributes ?? attributes}>${c.font ?? font}</g:Style></g:StyleRegion>`).join("")}</g:Styles><g:Cells>${cases.map((c, row) => `<g:Cell Row="${row}" Col="0" ValueType="${c.type ?? "60"}">${c.text}</g:Cell>`).join("")}</g:Cells></g:Sheet></g:Sheets></g:Workbook>`), context);
}
it("paints selected bold fonts, native cell sizes, foreground and solid background", async () => {
  const bytes = suppliedDefaultFont().bytes;
  const resolve = vi.fn<FontCapability["resolve"]>(async () => bytes);
  const book = await fixture([{text: "normal"}, {text: "bold", font: font.replace('Bold="0"', 'Bold="1"')},
    {text: "small", font: font.replace('Unit="10"', 'Unit="8"')}, {text: "large", font: font.replace('Unit="10"', 'Unit="14"')},
    {text: "red", attributes: attributes.replace('Fore="0:0:0"', 'Fore="FFFF:0:0"')},
    {text: "fill", attributes: attributes.replace('Back="FFFF:FFFF:FFFF"', 'Back="FFFF:FFFF:0"').replace('Shade="0"', 'Shade="1"')}]);
  const before = structuredClone(book), rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const {pdf, runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve}}));
    expect(pdf.getPageCount()).toBe(1);
    expect(runs.map(run => run.text)).toEqual(["normal", "bold", "small", "large", "red", "fill"]);
    expect(runs.map(run => run.size)).toEqual([7.5, 7.5, 6, 10.5, 7.5, 7.5]);
    expect(runs[4]!.color).toEqual([1, 0, 0]);
    expect(rectangle.mock.calls.map(([options]) => options)).toContainEqual(expect.objectContaining({x: 74, y: 599.8, width: 72.2, height: 20.2, color: rgb(1, 1, 0)}));
    expect(resolve.mock.calls).toHaveLength(2);
    expect(resolve.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({family: "Sans", bold: false, italic: false, maxBytes: 1000000}),
      expect.objectContaining({family: "Sans", bold: true, italic: false, maxBytes: 1000000 - bytes.byteLength})]);
    expect(book).toEqual(before);
  } finally {rectangle.mockRestore();}
});
it("paints a blank solid background without requesting unused font bytes", async () => {
  const resolve = vi.fn<FontCapability["resolve"]>(async () => undefined), rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const book = await fixture([{text: "", type: "10", attributes: attributes.replace('Shade="0"', 'Shade="1"').replace('Back="FFFF:FFFF:FFFF"', 'Back="FFFF:FFFF:0"')}]);
    await writePdf(book, [], {...context, fonts: {resolve}});
    expect(rectangle).toHaveBeenCalledWith(expect.objectContaining({color: rgb(1, 1, 0)}));
    expect(resolve).not.toHaveBeenCalled();
  } finally {rectangle.mockRestore();}
});
it.each(['Bold="1"', 'Italic="1"', "DejaVu Serif"])("shares a byte budget across separately selected fonts: %s", async variant => {
  const bytes = suppliedDefaultFont().bytes, resolve = vi.fn<FontCapability["resolve"]>(async () => bytes);
  const selected = variant === "DejaVu Serif" ? font.replace(">Sans<", ">DejaVu Serif<") : font.replace(variant.replace("1", "0"), variant);
  const book = await fixture([{text: "normal"}, {text: "other", font: selected}]);
  await expect(writePdf(book, [], {...context, fonts: {resolve}, limits: {...context.limits, inputBytes: bytes.byteLength * 2 - 1}})).rejects.toThrow("font bytes limit exceeded");
  expect(resolve.mock.calls).toHaveLength(2);
});
it("retains explicit refusal for unsupported shading and font decorations before font selection", async () => {
  const resolve = vi.fn<FontCapability["resolve"]>(async () => suppliedDefaultFont().bytes);
  for (const c of [{text: "shade", attributes: attributes.replace('Shade="0"', 'Shade="2"')},
    {text: "underline", font: font.replace('Underline="0"', 'Underline="5"')},
    {text: "strike", font: font.replace('StrikeThrough="0"', 'StrikeThrough="2"')}])
    await expect(writePdf(await fixture([c]), [], {...context, fonts: {resolve}})).rejects.toThrow("styled or merged cells");
  expect(resolve).not.toHaveBeenCalled();
});
it("selects host font families and italic variants independently of fractional sizes", async () => {
  const bytes = suppliedDefaultFont().bytes, resolve = vi.fn<FontCapability["resolve"]>(async () => bytes);
  const book = await fixture([
    {text: "eleven", font: font.replace('Unit="10"', 'Unit="11"')},
    {text: "fraction", font: font.replace('Unit="10"', 'Unit="11.5"')},
    {text: "serif", font: font.replace('>Sans<', '>DejaVu Serif<')},
    {text: "italic", font: font.replace('>Sans<', '>DejaVu Sans Mono<').replace('Italic="0"', 'Italic="1"')},
    {text: "bold italic", font: font.replace('>Sans<', '>DejaVu Sans Mono<').replace('Italic="0"', 'Italic="1"').replace('Bold="0"', 'Bold="1"')}
  ]);
  const {runs} = await pdfText(await writePdf(book, [], {...context, limits: {...context.limits, inputBytes: bytes.byteLength * 4}, fonts: {resolve}}));
  expect(runs.map(run => run.size)).toEqual([8.25, 8.625, 7.5, 7.5, 7.5]);
  expect(resolve.mock.calls.map(([request]) => [request.family, request.bold, request.italic])).toEqual([
    ["Sans", false, false], ["DejaVu Serif", false, false], ["DejaVu Sans Mono", false, true], ["DejaVu Sans Mono", true, true]
  ]);
});
it.each(['>DejaVu Serif<', 'italic'])("requires an explicit host font for %s", async variant => {
  const selected = variant === "italic" ? font.replace('Italic="0"', 'Italic="1"') : font.replace('>Sans<', variant);
  await expect(writePdf(await fixture([{text: "text", font: selected}]), [], context)).rejects.toThrow("styled or merged cells");
});
it.each(["0", "-1", "NaN", "Infinity", "1e309", ""])("rejects invalid font size %s before host selection", async unit => {
  const resolve = vi.fn<FontCapability["resolve"]>(async () => suppliedDefaultFont().bytes);
  await expect(writePdf(await fixture([{text: "text", font: font.replace('Unit="10"', `Unit="${unit}"`)}]), [], {...context, fonts: {resolve}})).rejects.toThrow("styled or merged cells");
  expect(resolve).not.toHaveBeenCalled();
});
it.each([
  ["0:FFFF:0", [0, 1, 0]],
  ["0:0:FFFF", [0, 0, 1]],
  ["1234:5678:9ABC", [18 / 255, 86 / 255, 154 / 255]],
  ["ff:100:1ff", [0, 1 / 255, 1 / 255]],
  ["abcd:ef01:2345:FFFF", [171 / 255, 239 / 255, 35 / 255]]
] as const)("prints foreground and solid background %s with native channel quantization", async (color, channels) => {
  const resolve = async () => suppliedDefaultFont().bytes, rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const book = await fixture([{text: "color", attributes: attributes.replace('Fore="0:0:0"', `Fore="${color}"`).replace('Back="FFFF:FFFF:FFFF"', `Back="${color}"`).replace('PatternColor="0:0:0"', 'PatternColor="FFFF:0:FFFF"').replace('Shade="0"', 'Shade="1"')}]);
    const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve}}));
    expect(runs[0]!.color).toEqual(channels);
    expect(rectangle).toHaveBeenCalledWith(expect.objectContaining({color: rgb(channels[0], channels[1], channels[2])}));
  } finally {rectangle.mockRestore();}
});
it.each(["", "0:0", "0:0:10000", "0:0:-1", "0:0:GG", "0:0:ffjunk", "0:0:0:FFFF:0"])("refuses malformed color %s before font selection", async color => {
  const resolve = vi.fn<FontCapability["resolve"]>(async () => suppliedDefaultFont().bytes);
  await expect(writePdf(await fixture([{text: "color", attributes: attributes.replace('Fore="0:0:0"', `Fore="${color}"`)}]), [], {...context, fonts: {resolve}})).rejects.toThrow("styled or merged cells");
  expect(resolve).not.toHaveBeenCalled();
});
it.each([['8000', 128 / 255], ['0000', 0], ['00ff', 0]])("applies native alpha %s to text and fills without leaking into adjacent cells", async (alpha, opacity) => {
  const resolve = async () => suppliedDefaultFont().bytes;
  const transparent = attributes.replace('Fore="0:0:0"', `Fore="FFFF:0:0:${alpha}"`).replace('Back="FFFF:FFFF:FFFF"', `Back="0:0:FFFF:${alpha}"`).replace('Shade="0"', 'Shade="1"');
  const book = await fixture([{text: "alpha", attributes: transparent}, {text: "opaque"}]);
  const rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const {pdf, runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve}}));
    expect(runs.map(run => run.text)).toEqual(["alpha", "opaque"]);
    expect(rectangle).toHaveBeenCalledWith(expect.objectContaining({color: rgb(0, 0, 1), opacity}));
    const page = pdf.getPage(0), resources = page.node.Resources()!.lookup(PDFName.of("ExtGState"), PDFDict);
    expect(resources.entries().map(([,ref]) => pdf.context.lookup(ref, PDFDict).lookup(PDFName.of("ca"), PDFNumber).asNumber())).toContain(opacity);
    const contents = page.node.Contents() as PDFArray;
    const operations = contents.asArray().map(ref => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref) as PDFRawStream).decode())).join("\n");
    const textPrefixes = operations.split("BT");
    const firstPrefix = textPrefixes[0]!.slice(textPrefixes[0]!.lastIndexOf("\nq\n"));
    const alphaOperator = firstPrefix.split("\n").find(line => line.endsWith(" gs"))!;
    expect(alphaOperator).toBeDefined();
    const selected = resources.lookup(PDFName.of(alphaOperator.split(" ")[0]!.slice(1)), PDFDict);
    expect(selected.lookup(PDFName.of("ca"), PDFNumber).asNumber()).toBe(opacity);
    expect(textPrefixes[1]!.slice(textPrefixes[1]!.lastIndexOf("\nq\n"))).not.toContain(" gs");
    const textStates = operations.split("BT").slice(1).map(part => part.slice(part.indexOf("ET") + 2).trimStart().startsWith("EMC\nQ"));
    expect(textStates).toEqual([true, true]);
  } finally {rectangle.mockRestore();}
});

it.each([1, 2, 3, 4])("paints native underline %i without decorating adjacent cells", async underline => {
  const rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const book = await fixture([{text: "jAy pq", font: font.replace('Underline="0"', `Underline="${underline}"`)}, {text: "Neighbor"}]);
    const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}}));
    expect(runs.map(run => run.text)).toEqual(["jAy pq", "Neighbor"]);
    const lines = rectangle.mock.calls.map(([options]) => options!);
    expect(lines).toHaveLength(underline === 2 || underline === 4 ? 2 : 1);
    expect(lines[0]).toEqual(expect.objectContaining({color: rgb(0, 0, 0), height: expect.any(Number), width: expect.any(Number)}));
    // Supplied JetBrains Mono: 1000 units/em, underline -155/50, ink descender -180.
    expect(lines[0]!.height).toBe(0.375);
    expect(lines[0]!.width).toBe(27);
    expect(lines[0]!.x).toBe(runs[0]!.glyphs[0]!.x);
    expect(lines[0]!.y).toBeCloseTo(runs[0]!.glyphs[0]!.y - (underline === 3 ? 2.1 : 1.5375), 8);
    if (lines.length === 2) expect(Math.abs(lines[0]!.y! - lines[1]!.y!)).toBeCloseTo(2 * lines[0]!.height!, 8);
  } finally {rectangle.mockRestore();}
});

it.each([0, 1, 2, 3, 4])("combines strikethrough with underline %i using independent ink bounds", async underline => {
  const rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const book = await fixture([{text: "jAy pq", font: font.replace('StrikeThrough="0"', 'StrikeThrough="1"').replace('Underline="0"', `Underline="${underline}"`)}, {text: "Neighbor"}]);
    const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}}));
    expect(runs.map(run => run.text)).toEqual(["jAy pq", "Neighbor"]);
    const lines = rectangle.mock.calls.map(([options]) => options!);
    expect(lines).toHaveLength(underline === 0 ? 1 : underline === 2 || underline === 4 ? 3 : 2);
    const strike = lines.at(-1)!;
    expect(strike.height).toBeGreaterThan(0);
    expect(strike.y).toBeGreaterThan(runs[0]!.glyphs[0]!.y);
    expect(strike.x).toBeGreaterThan(runs[0]!.glyphs[0]!.x);
    expect(strike.width).toBeLessThan(27);
  } finally {rectangle.mockRestore();}
});

it("does not draw nonfinite strikethrough rectangles for inkless spaces", async () => {
  const rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const book = await fixture([{text: "   ", font: font.replace('StrikeThrough="0"', 'StrikeThrough="1"')}]);
    await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}});
    expect(rectangle).not.toHaveBeenCalled();
  } finally {rectangle.mockRestore();}
});

it.each(["TOP", "CENTER", "JUSTIFY", "DISTRIBUTED"])("uses native single-line vertical alignment %s", async alignment => {
  const book = await fixture([{text: "text", attributes: attributes.replace('GNM_VALIGN_BOTTOM', `GNM_VALIGN_${alignment}`)}, {text: "Neighbor"}]);
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}}));
  // JetBrains Mono ascent 1020, descent -300, at 7.5pt; 20pt row minus 1pt grid.
  const offset = alignment === "CENTER" || alignment === "DISTRIBUTED" ? 4.55 : 0;
  expect(runs[0]!.glyphs[0]!.y).toBeCloseTo(720 - 0.75 - offset - 7.65, 8);
  expect(runs[1]!.glyphs[0]!.y).toBeCloseTo(720 - 40 + 0.25 + 2.25, 8);
});

it.each(["TOP", "CENTER", "BOTTOM"])("clamps negative vertical spacing for %s", async alignment => {
  const book = await fixture([{text: "x", attributes: attributes.replace('GNM_VALIGN_BOTTOM', `GNM_VALIGN_${alignment}`), font: font.replace('Unit="10"', 'Unit="19.5"')}]);
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}}));
  expect(runs[0]!.glyphs[0]!.y).toBeCloseTo(720 - 0.75 - 19.5 * 0.75 * 1.02, 8);
});

it.each(["TOP", "CENTER", "BOTTOM"])("clips oversized text to its own row with %s alignment", async alignment => {
  const book = await fixture([{text: "x", attributes: attributes.replace('GNM_VALIGN_BOTTOM', `GNM_VALIGN_${alignment}`), font: font.replace('Unit="10"', 'Unit="48"')}, {text: "Neighbor"}]);
  const {pdf, runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}}));
  expect(runs.map(run => run.text)).toEqual(["x", "Neighbor"]);
  expect(runs[0]!.glyphs[0]!.y).toBeCloseTo(720 - 0.75 - 48 * 0.75 * 1.02, 8);
  const contents = pdf.getPage(0).node.Contents() as PDFArray;
  const operations = contents.asArray().map(ref => new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(ref) as PDFRawStream).decode())).join("\n");
  expect(operations).toContain("76 700 464 20 re\nW\nn");
  expect(operations).toContain("EMC\nQ\nq");
});

it.each(["LEFT", "RIGHT", "CENTER", "GENERAL"])("uses selected font digit widths for %s indentation", async alignment => {
  const styled = attributes.replace('GNM_HALIGN_GENERAL', `GNM_HALIGN_${alignment}`);
  const book = await fixture([0, 1, 3].map(indent => ({text: "x", attributes: styled.replace('Indent="0"', `Indent="${indent}"`)})));
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}}));
  const direction = alignment === "RIGHT" ? -1 : alignment === "CENTER" ? 0 : 1;
  expect(runs[1]!.glyphs[0]!.x - runs[0]!.glyphs[0]!.x).toBeCloseTo(direction * 4.5, 8);
  expect(runs[2]!.glyphs[0]!.x - runs[0]!.glyphs[0]!.x).toBeCloseTo(direction * 13.5, 8);
});

it.each(["-1", "1.5", "NaN", "Infinity", "2147483648", ""])("rejects invalid indent %s before requesting font bytes", async indent => {
  const resolve = vi.fn<FontCapability["resolve"]>(async () => suppliedDefaultFont().bytes);
  const book = await fixture([{text: "x", attributes: attributes.replace('Indent="0"', `Indent="${indent}"`)}]);
  await expect(writePdf(book, [], {...context, fonts: {resolve}})).rejects.toThrow("styled or merged cells");
  expect(resolve).not.toHaveBeenCalled();
});
it("indents general-aligned numbers from the right", async () => {
  const book = await fixture([0, 3].map(indent => ({text: "42", type: "40", attributes: attributes.replace('Indent="0"', `Indent="${indent}"`)})));
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}}));
  expect(runs[1]!.glyphs[0]!.x - runs[0]!.glyphs[0]!.x).toBe(-13.5);
});

it.each([["0", "0"], ["0", "1"], ["1", "1"]])("prints cell protection flags Locked=%s Hidden=%s without changing the workbook", async (locked, hidden) => {
  const book = await fixture([{text: "visible", attributes: attributes.replace('Locked="1"', `Locked="${locked}"`).replace('Hidden="0"', `Hidden="${hidden}"`)}]);
  const before = structuredClone(book);
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}}));
  expect(runs[0]!.text).toBe("visible");
  expect(book).toEqual(before);
});

it.each(["gnumeric", "normalized"])("prints formulas with general-left alignment and doubled columns from %s view metadata", async kind => {
  const original = await fixture([{text: "3", type: "40"}, {text: "anchor"}]), sheet = original.sheets[0]!;
  const book = {...original, sheets: [{...sheet, view: {...sheet.view, defaultColumnWidth: 60,
    ...(kind === "gnumeric" ? {gnumeric: {...sheet.view?.gnumeric as object, DisplayFormulas: "1"}} : {displayFormulas: true})},
    columns: [{index: 0, sizePoints: 60}, {index: 1, sizePoints: 60}],
    cells: sheet.cells.map((cell, index) => index === 0 ? {...cell, column: 1, formula: "=1+2"} : cell)}]};
  const before = structuredClone(book);
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}}));
  expect(runs.map(run => run.text)).toEqual(["=1+2", "anchor"]);
  expect(runs[0]!.glyphs[0]!.x).toBe(196.75);
  expect(book).toEqual(before);
});

it.each(["gnumeric", "normalized"])("hides native near-zero numbers and FALSE with %s metadata while retaining text and fills", async kind => {
  const threshold = 64 * Number.EPSILON;
  const cases = [{text: "0", type: "40", attributes: attributes.replace('Shade="0"', 'Shade="1"')},
    {text: "-0", type: "40"}, {text: "FALSE", type: "20"}, {text: "0", type: "60"}, {text: "TRUE", type: "20"},
    ...[threshold * (1 - Number.EPSILON / 2), threshold, threshold * (1 + Number.EPSILON),
      -threshold * (1 - Number.EPSILON / 2), -threshold, -threshold * (1 + Number.EPSILON)].map(value => ({text: String(value), type: "40"}))];
  const original = await fixture(cases), sheet = original.sheets[0]!;
  const book = {...original, sheets: [{...sheet, columns: [{index: 0, sizePoints: 180}], view: {...sheet.view,
    ...(kind === "gnumeric" ? {gnumeric: {...sheet.view?.gnumeric as object, HideZero: "1"}} : {hideZero: true})}}]};
  const before = structuredClone(book), rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle");
  try {
    const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}}));
    expect(runs.map(run => run.text).slice(0, 2)).toEqual(["0", "TRUE"]);
    expect(runs.map(run => run.glyphs[0]!.y)).toEqual([3, 4, 6, 7, 9, 10].map(row => 720 - (row + 1) * 20 + 2.5));
    expect(rectangle).toHaveBeenCalledTimes(1);
    expect(book).toEqual(before);
  } finally {rectangle.mockRestore();}
});
it("displays a zero-valued formula when both formula display and zero hiding are enabled", async () => {
  const original = await fixture([{text: "0", type: "40"}]), sheet = original.sheets[0]!;
  const book = {...original, sheets: [{...sheet, view: {...sheet.view, gnumeric: {...sheet.view?.gnumeric as object, HideZero: "1", DisplayFormulas: "1"}},
    cells: [{...sheet.cells[0]!, formula: "=0"}]}]};
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {resolve: async () => suppliedDefaultFont().bytes}}));
  expect(runs.map(run => run.text)).toEqual(["=0"]);
});

it.each(["short", "a long string that exceeds its cell", "12.5"])("prints retained ShrinkToFit without scaling, as native does: %s", async text => {
  const normal = await fixture([{text}]);
  const flagged = await fixture([{text, attributes: attributes.replace('ShrinkToFit="0"', 'ShrinkToFit="1"')}]);
  const before = structuredClone(flagged);
  const ctx = {...context, fonts: {async resolve() {return suppliedDefaultFont().bytes;}}};
  const expected = await pdfText(await writePdf(normal, [], ctx));
  const actual = await pdfText(await writePdf(flagged, [], ctx));
  expect(actual.runs).toEqual(expected.runs);
  expect(actual.runs[0]!.size).toBe(7.5);
  expect(flagged).toEqual(before);
});

it.each([undefined, createFormattingCapability()])("formats General numbers to column width without changing the stored value", async formatting => {
  const original = await fixture([{text: "123456789012345", type: "40"}]);
  const book = {...original, sheets: original.sheets.map(sheet => ({...sheet, columns: [], view: {...sheet.view, defaultColumnWidth: 48}}))};
  const before = structuredClone(book);
  const {runs} = await pdfText(await writePdf(book, [], {...context, ...(formatting ? {formatting} : {}), fonts: {async resolve() {return suppliedDefaultFont().bytes;}}}));
  expect(runs[0]!.text).toBe("1.23457E+14");
  expect(book).toEqual(before);
});

it("retains custom formatting authority during numeric layout", async () => {
  const book = await fixture([{text: "123456789012345", type: "40"}]);
  const format = vi.fn(async () => "custom");
  const {runs} = await pdfText(await writePdf(book, [], {...context, formatting: {format},
    fonts: {async resolve() {return suppliedDefaultFont().bytes;}}}));
  expect(runs[0]!.text).toBe("custom");
  expect(format).toHaveBeenCalledTimes(1);
});

it("wraps cell words while preserving the stored string", async () => {
  const original = await fixture([{text: "alpha beta gamma delta", attributes: attributes.replace('WrapText="0"', 'WrapText="1"')}]);
  const book = {...original, sheets: original.sheets.map(sheet => ({...sheet, columns: [], rows: [], view: {...sheet.view, defaultColumnWidth: 36, defaultRowHeight: 60}}))};
  const before = structuredClone(book);
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {async resolve() {return suppliedDefaultFont().bytes;}}}));
  expect(runs.map(run => run.text)).toEqual(["alpha", "beta", "gamma", "delta"]);
  expect(book).toEqual(before);
});

it.each(["ab", "12"])("fills a cell by repeating %s without mutating its value", async text => {
  const original = await fixture([{text, type: text === "12" ? "40" : "60", attributes: attributes.replace('HAlign="GNM_HALIGN_GENERAL"', 'HAlign="GNM_HALIGN_FILL"')}]);
  const book = {...original, sheets: original.sheets.map(sheet => ({...sheet, columns: [], view: {...sheet.view, defaultColumnWidth: 36}}))};
  const before = structuredClone(book);
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {async resolve() {return suppliedDefaultFont().bytes;}}}));
  expect(runs[0]!.text.split("​").join("")).toBe(text.repeat(3));
  expect(book).toEqual(before);
});

it("ignores wrapping and indentation for filled cells", async () => {
  const plain = attributes.replace('HAlign="GNM_HALIGN_GENERAL"', 'HAlign="GNM_HALIGN_FILL"');
  const ctx = {...context, fonts: {async resolve() {return suppliedDefaultFont().bytes;}}};
  const expected = await pdfText(await writePdf(await fixture([{text: "ab", attributes: plain}]), [], ctx));
  const actual = await pdfText(await writePdf(await fixture([{text: "ab", attributes: plain.replace('WrapText="0"', 'WrapText="1"').replace('Indent="0"', 'Indent="8"')}]), [], ctx));
  expect(actual.runs).toEqual(expected.runs);
});
it("refuses unqualified single-paragraph control glyphs in filled cells", async () => {
  const book = await fixture([{text: "ab\u2028cd", attributes: attributes.replace('HAlign="GNM_HALIGN_GENERAL"', 'HAlign="GNM_HALIGN_FILL"')}]);
  await expect(writePdf(book, [], {...context, fonts: {async resolve() {return suppliedDefaultFont().bytes;}}})).rejects.toThrow("fill control-character layout");
});

it("prints LF as a return arrow in filled strings", async () => {
  const book = await fixture([{text: "ab\ncd", attributes: attributes.replace('HAlign="GNM_HALIGN_GENERAL"', 'HAlign="GNM_HALIGN_FILL"')}]);
  const before = structuredClone(book);
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {async resolve() {return suppliedDefaultFont().bytes;}}}));
  expect(runs[0]!.text.split("\u200b").join("")).toBe("ab↩cdab↩cd");
  expect(book).toEqual(before);
});
it("keeps paragraph separators inside one Fill line without joining glyph clusters", async () => {
  const book = await fixture([{text: "a\u2029b", attributes: attributes.replace('HAlign="GNM_HALIGN_GENERAL"', 'HAlign="GNM_HALIGN_FILL"')}]);
  const before = structuredClone(book);
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {async resolve() {return suppliedDefaultFont().bytes;}}}));
  expect(runs).toHaveLength(1);
  expect(runs[0]!.text.split("\u200b").join("")).toBe("ab".repeat(7));
  expect(book).toEqual(before);
});
it("keeps Fill tabs aligned to shared stops across repeated copies", async () => {
  const original = await fixture([{text: "a\tb", attributes: attributes.replace('HAlign="GNM_HALIGN_GENERAL"', 'HAlign="GNM_HALIGN_FILL"')}]);
  const book = {...original, sheets: original.sheets.map(sheet => ({...sheet, columns: [], view: {...sheet.view, defaultColumnWidth: 144}}))};
  const before = structuredClone(book);
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {async resolve() {return suppliedDefaultFont().bytes;}}}));
  const glyphs = runs[0]!.glyphs.filter(glyph => glyph.text === "a" || glyph.text === "b");
  expect(glyphs.map(glyph => glyph.text).join("")).toBe("ababab");
  expect(glyphs.map(glyph => glyph.x)).toEqual([76.75, 112.75, 117.25, 148.75, 153.25, 184.75]);
  expect(book).toEqual(before);
});
it("omits fully clipped glyphs after a Fill tab from PDF text", async () => {
  const book = await fixture([{text: "abcdefgh\tb", font: font.replace('Unit="10"', 'Unit="14"'), attributes: attributes.replace('HAlign="GNM_HALIGN_GENERAL"', 'HAlign="GNM_HALIGN_FILL"')}]);
  const {runs} = await pdfText(await writePdf(book, [], {...context, fonts: {async resolve() {return suppliedDefaultFont().bytes;}}}));
  expect(runs.map(run => run.text).join("")).toBe("abcdefgh");
});
