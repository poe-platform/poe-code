import {expect, it, vi} from "vitest";
import {encode} from "jpeg-js";
import {PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream} from "pdf-lib";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {convert, writeDocument} from "./engine.js";
import type {Document} from "./types.js";
import type {Block, Cell, Inline, Row} from "./ast-types.js";

const context = {yield: async () => {}};
const attr = ["", [], []] as const;
async function docxParts(document: Document) {
  const result = await writeDocument(document, {to: "docx"}, context);
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  const parts = readZipArchiveEntries(result.bytes);
  return (name: string) => new TextDecoder().decode(parts.get(name));
}
function painting(document: PDFDocument) {
  return document.getPages().map(page => {
    const streams = page.node.Contents();
    if (!(streams instanceof PDFArray)) throw Error("Expected PDF content streams");
    return streams.asArray().map(ref => {
      const stream = document.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) throw Error("Expected raw PDF stream");
      return new TextDecoder().decode(decodePDFRawStream(stream).decode());
    }).join("\n");
  });
}

it.each((["html", "json"] as const).flatMap(from => (["docx", "pdf"] as const).map(to => ({from, to}))))("resolves encoded text and image fragment destinations through $from in $to", async ({from, to}) => {
  const cases = [
    ["hello%20world", "hello world"],
    ["caf%C3%A9", "café"],
    ["percent%2520name", "percent%20name"],
    ["bad%GG%20escape", "bad%GG escape"],
    ["a+b", "a+b"],
    ["broken%FF%20name", "broken\uFFFD name"],
    ["exact%20name", "exact%20name"],
  ] as const;
  // Put decoded distractors first to distinguish exact lookup from traversal order
  // and a single percent-decoding pass from recursive decoding/form decoding.
  const ids = ["percent name", "a b", "exact name", ...cases.map(([, target]) => target)];
  const image = "pixel.jpg", imageBytes = new Uint8Array(encode({width: 2, height: 1, data: new Uint8Array(8).fill(255)}, 80).data);
  const render = async (resolved: boolean) => {
    const links = cases.map(([fragment, target]) => `#${resolved ? target : fragment}`);
    const blocks: Block[] = links.map((href, index) => ({t: "Para", c: [
      {t: "Link", c: [attr, [{t: "Str", c: `Link${index}`}], [href, ""]]}, {t: "Space"},
      {t: "Link", c: [attr, [{t: "Image", c: [["", [], [["width", "8px"], ["height", "8px"]]], [{t: "Str", c: "Pixel"}], [image, ""]]}], [href, ""]]},
    ]}));
    blocks.push(...ids.map((id, index): Block => ({t: "Div", c: [[id, [], []], [{t: "Para", c: [{t: "Str", c: `Target${index}`}]}]]})));
    const input = from === "html"
      ? links.map((href, index) => `<p><a href="${href}">Link${index}</a> <a href="${href}"><img src="${image}" width="8" height="8" alt="Pixel"></a></p>`).join("") + ids.map((id, index) => `<div id="${id}"><p>Target${index}</p></div>`).join("")
      : JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks});
    const result = await convert([{bytes: new TextEncoder().encode(input)}], {from, to}, {...context, resources: {resolve: async source => {expect(source).toBe(image); return imageBytes;}}});
    if (result.kind !== "binary") throw Error("Expected binary document");
    return result.bytes;
  };
  const bytes = await render(false);
  if (to === "docx") {
    const xml = new TextDecoder().decode(readZipArchiveEntries(bytes).get("word/document.xml"));
    const anchors = [...xml.matchAll(/<w:hyperlink w:anchor="([^"]*)"/g)].map(match => match[1]);
    expect(anchors).toEqual(cases.flatMap(([, target]) => [target, target]));
    for (const id of ids) expect(xml).toContain(`w:name="${id}"`);
    expect([...xml.matchAll(/<w:hyperlink\b[^>]*>(.*?)<\/w:hyperlink>/gs)].filter(match => match[1]!.includes("<w:drawing"))).toHaveLength(cases.length);
  } else {
    const output = await PDFDocument.load(bytes), control = await PDFDocument.load(await render(true));
    const destinations = (pdf: PDFDocument) => pdf.getPages().flatMap(page => (page.node.Annots()?.asArray() ?? []).map(ref => {
      const destination = pdf.context.lookup(ref, PDFDict).lookup(PDFName.of("Dest"), PDFArray);
      return [pdf.getPages().findIndex(candidate => candidate.ref.toString() === destination.get(0).toString()), destination.lookup(3, PDFNumber).asNumber()];
    }));
    const actual = destinations(output), expected = destinations(control);
    expect(expected).toHaveLength(cases.length * 2);
    expect(actual).toEqual(expected);
    expect(painting(output)).toEqual(painting(control));
    for (let index = 0; index < actual.length; index += 2) expect(actual[index]).toEqual(actual[index + 1]);
    expect(new Set(actual.map(destination => destination.join(":"))).size).toBe(cases.length);
  }
});

it.each(["docx", "pdf"] as const)("preserves table sections and row-header roles in %s", async to => {
  const row = (left: string, right: string): Row => [attr, [left, right].map(text => [attr, "AlignDefault", 1, 1, [{t: "Plain", c: [{t: "Str", c: text}]}]])];
  const document: Document = {metadata: {}, resources: [], blocks: [{t: "Table", c: [
    attr, [null, []], [["AlignDefault", {t: "ColWidthDefault"}], ["AlignDefault", {t: "ColWidthDefault"}]],
    [attr, [row("ColumnA", "ColumnB")]],
    [[attr, 1, [row("SectionOne", "DetailsOne")], [row("RowLabel", "RegularValue")]],
      [attr, 0, [row("SectionTwo", "DetailsTwo")], [row("AnotherLabel", "AnotherValue")]]],
    [attr, []],
  ]}]};
  const result = await writeDocument(document, {to}, context);
  if (result.kind !== "binary") throw Error("Expected binary document");
  if (to === "docx") {
    const xml = new TextDecoder().decode(readZipArchiveEntries(result.bytes).get("word/document.xml"));
    const rows = [...xml.matchAll(/<w:tr>(.*?)<\/w:tr>/gs)].map(match => match[1]!);
    expect(rows).toHaveLength(5);
    expect(rows.map(row => row.includes("<w:tblHeader"))).toEqual([true, false, false, false, false]);
    expect(rows.map(row => [...row.matchAll(/<w:tc>(.*?)<\/w:tc>/gs)].map(match => match[1]!.includes("<w:b/>"))))
      .toEqual([[true, true], [true, true], [true, false], [true, true], [false, false]]);
  } else {
    const text = await convert([{bytes: result.bytes}], {from: "pdf", to: "plain"}, context);
    expect(text).toMatchObject({kind: "text"});
    if (text.kind !== "text") throw Error("Expected text");
    for (const label of ["ColumnA", "ColumnB", "SectionOne", "DetailsOne", "RowLabel", "RegularValue", "SectionTwo", "DetailsTwo", "AnotherLabel", "AnotherValue"]) expect(text.text).toContain(label);
  }
});

it("keeps geometric row-header columns across DOCX rowspans", async () => {
  const cell = (text: string, rowspan = 1): Cell => [attr, "AlignDefault", rowspan, 1, [{t: "Plain", c: [{t: "Str", c: text}]}]];
  const document: Document = {metadata: {}, resources: [], blocks: [{t: "Table", c: [
    attr, [null, []], Array.from({length: 3}, () => ["AlignDefault", {t: "ColWidthDefault"}] as const), [attr, []],
    [[attr, 2, [], [[attr, [cell("LabelA", 2), cell("LabelB"), cell("ValueOne")]], [attr, [cell("LabelC"), cell("ValueTwo")]]]]], [attr, []],
  ]}]};
  const xml = (await docxParts(document))("word/document.xml");
  expect(xml).not.toContain("<w:tblHeader");
  expect(xml).toContain('<w:vMerge w:val="restart"/>');
  const cells = [...xml.matchAll(/<w:tc>(.*?)<\/w:tc>/gs)].map(match => match[1]!);
  for (const [label, bold] of [["LabelA", true], ["LabelB", true], ["LabelC", true], ["ValueOne", false], ["ValueTwo", false]] as const) {
    const actual = cells.find(cell => cell.includes(label));
    expect(actual).toBeDefined();
    expect(actual!.includes("<w:b/>")).toBe(bold);
  }
});

it.each((["html", "pandoc"] as const).flatMap(from => (["docx", "pdf"] as const).map(to => ({from, to}))))("preserves rich mixed header cells from $from in $to", async ({from, to}) => {
  const document: Document = {metadata: {}, resources: [], blocks: [{t: "Table", c: [
    attr, [null, []], Array.from({length: 3}, () => ["AlignDefault", {t: "ColWidthDefault"}] as const), [attr, []],
    [[attr, 0, [], [[attr, [
      [attr, "AlignDefault", 1, 1, [{t: "Plain", c: [{t: "Str", c: "REGULAR"}]}]],
      [["", [], [["role", "cell"], ["scope", "col"]]], "AlignDefault", 1, 1, [{t: "CodeBlock", c: [attr, "CODEHEADER"]}]],
      [["", [], [["role", "rowheader"]]], "AlignDefault", 1, 1, [{t: "CodeBlock", c: [attr, "ROLEHEADER"]}]],
    ]]]]], [attr, []],
  ]}]};
  const result = from === "html"
    ? await convert([{bytes: new TextEncoder().encode('<table><tbody><tr><td>REGULAR</td><th role="cell"><pre>CODEHEADER</pre></th><td role="rowheader"><pre>ROLEHEADER</pre></td></tr></tbody></table>')}], {from, to}, context)
    : await writeDocument(document, {to}, context);
  if (result.kind !== "binary") throw Error("Expected binary document");
  if (to === "docx") {
    const xml = new TextDecoder().decode(readZipArchiveEntries(result.bytes).get("word/document.xml"));
    expect(xml).not.toContain("<w:tblHeader");
    const cells = [...xml.matchAll(/<w:tc>(.*?)<\/w:tc>/gs)].map(match => match[1]!);
    for (const [label, bold] of [["REGULAR", false], ["CODEHEADER", true], ["ROLEHEADER", true]] as const) {
      const actual = cells.find(cell => cell.includes(label));
      expect(actual).toBeDefined();
      expect(actual!.includes("<w:b/>")).toBe(bold);
    }
  } else {
    const output = await convert([{bytes: result.bytes}], {from: "pdf", to: "plain"}, context);
    if (output.kind !== "text") throw Error("Expected text");
    for (const label of ["REGULAR", "CODEHEADER", "ROLEHEADER"]) expect(output.text).toContain(label);
  }
});

it.each(["html", "pandoc"] as const)("preserves Word direction scopes and logical text through %s", async from => {
  const html = '<body dir="rtl"><p>OUTER</p><div dir="ltr"><p>RESET <bdo dir="rtl">ABC 123</bdo></p></div></body>';
  const document: Document = {direction: "rtl", metadata: {}, resources: [], blocks: [
    {t: "Para", c: [{t: "Str", c: "OUTER"}]},
    {t: "Div", c: [["", [], [["dir", "ltr"]]], [{t: "Para", c: [
      {t: "Str", c: "RESET "},
      {t: "Span", c: [["", [], [["dir", "rtl"], ["style", "unicode-bidi:isolate-override"]]], [{t: "Str", c: "ABC 123"}]]},
    ]}]]},
  ]};
  const render = (to: "docx" | "pdf") => from === "html"
    ? convert([{bytes: new TextEncoder().encode(html)}], {from, to}, context)
    : writeDocument(document, {to}, context);
  const output = await render("docx");
  if (output.kind !== "binary") throw Error("Expected DOCX");
  const xml = new TextDecoder().decode(readZipArchiveEntries(output.bytes).get("word/document.xml"));
  expect(xml).toContain('<w:bidi w:val="true"/>');
  expect(xml).toContain('<w:bidi w:val="false"/>');
  expect(xml).toContain('<w:bdo w:val="rtl">');
  const logicalText = [...xml.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/gs)].map(match => match[1]).join("").replace(/[\u2066-\u2069]/g, "");
  expect(logicalText).toBe("OUTERRESET ABC 123");
  await expect(render("pdf")).rejects.toMatchObject({code: "E_CAPABILITY", message: expect.stringContaining("right-to-left direction")});
});

it.each(["html", "pandoc"] as const)("rejects PDF directional overrides through %s even with ASCII text", async from => {
  const document: Document = {metadata: {}, resources: [], blocks: [{t: "Para", c: [
    {t: "Span", c: [["", [], [["dir", "ltr"], ["style", "unicode-bidi:isolate-override"]]], [{t: "Str", c: "ABC 123"}]]},
  ]}]};
  const result = from === "html"
    ? convert([{bytes: new TextEncoder().encode('<p><bdo dir="ltr">ABC 123</bdo></p>')}], {from, to: "pdf"}, context)
    : writeDocument(document, {to: "pdf"}, context);
  await expect(result).rejects.toMatchObject({code: "E_CAPABILITY", message: expect.stringContaining("directional overrides")});
});

it.each(["html", "pandoc"] as const)("keeps explicit LTR PDF scopes supported through %s", async from => {
  const document: Document = {direction: "ltr", metadata: {}, resources: [], blocks: [{t: "Para", c: [
    {t: "Span", c: [["", [], [["dir", "ltr"]]], [{t: "Str", c: "ABC 123"}]]},
  ]}]};
  const result = from === "html"
    ? await convert([{bytes: new TextEncoder().encode('<body dir="ltr"><p><bdi dir="ltr">ABC 123</bdi></p></body>')}], {from, to: "pdf"}, context)
    : await writeDocument(document, {to: "pdf"}, context);
  if (result.kind !== "binary") throw Error("Expected PDF");
  expect(await convert([{bytes: result.bytes}], {from: "pdf", to: "plain"}, context)).toMatchObject({kind: "text", text: expect.stringContaining("ABC 123")});
});

it.each(["html", "pandoc"] as const)("rejects unresolved direction and unrepresentable inline CSS through %s", async from => {
  for (const [key, value] of [["dir", "auto"], ["dir", " rtl "], ["style", "direction:rtl"], ["style", "unicode-bidi:isolate-override"]]) {
    const document: Document = {metadata: {}, resources: [], blocks: [{t: "Para", c: [
      {t: "Span", c: [["", [], [[key!, value!]]], [{t: "Str", c: "ABC 123"}]]},
    ]}]};
    for (const to of ["docx", "pdf"] as const) {
      const result = from === "html"
        ? convert([{bytes: new TextEncoder().encode(`<p><span ${key}="${value}">ABC 123</span></p>`)}], {from, to}, context)
        : writeDocument(document, {to}, context);
      await expect(result).rejects.toMatchObject({code: "E_CAPABILITY"});
    }
  }
});

it.each((["html", "pandoc"] as const).flatMap(from => [
  {text: "مرحبا بالعالم", codepoint: "0645"},
  {text: "שלום עולם", codepoint: "05E9"},
  {text: "a\u0301", codepoint: "0301"},
  {text: "😀\ufe0f", codepoint: "FE0F"},
  {text: "😀\u{1f3fb}", codepoint: "1F3FB"},
].map(input => ({from, ...input}))))("rejects unshaped PDF text through $from while preserving DOCX: $text", async ({from, text, codepoint}) => {
  const render = (to: "pdf" | "docx") => from === "html"
    ? convert([{bytes: new TextEncoder().encode(`<p>${text}</p>`)}], {from, to}, context)
    : writeDocument({blocks: [{t: "Para", c: [{t: "Str", c: text}]}], metadata: {}, resources: []}, {to}, context);
  await expect(render("pdf")).rejects.toMatchObject({
    code: "E_CAPABILITY",
    message: `Unsupported PDF script or combining sequence U+${codepoint}; text shaping is not available`,
  });
  const word = await render("docx");
  if (word.kind !== "binary") throw Error("Expected DOCX");
  expect(new TextDecoder().decode(readZipArchiveEntries(word.bytes).get("word/document.xml"))).toContain(text);
});

it.each(["html", "pandoc"] as const)("preserves supported multilingual PDF text through %s", async from => {
  const text = "Zażółć café Ελληνικά Привет → ✓ ⚽ ⚾ ⑪ Ⓐ 😀 😃 🙀";
  const result = from === "html"
    ? await convert([{bytes: new TextEncoder().encode(`<p>${text}</p>`)}], {from, to: "pdf"}, context)
    : await writeDocument({blocks: [{t: "Para", c: [{t: "Str", c: text}]}], metadata: {}, resources: []}, {to: "pdf"}, context);
  if (result.kind !== "binary") throw Error("Expected PDF");
  const roundtrip = await convert([{bytes: result.bytes}], {from: "pdf", to: "plain"}, context);
  expect(roundtrip).toMatchObject({kind: "text", text: expect.stringContaining(text)});
});

it.each(["html", "pandoc"] as const)("rejects unsupported joiner sequences and missing Emoticon glyphs through %s", async from => {
  for (const text of ["😀\u200d😀", "🙏"]) {
    const result = from === "html"
      ? convert([{bytes: new TextEncoder().encode(`<p>${text}</p>`)}], {from, to: "pdf"}, context)
      : writeDocument({blocks: [{t: "Para", c: [{t: "Str", c: text}]}], metadata: {}, resources: []}, {to: "pdf"}, context);
    await expect(result).rejects.toMatchObject({code: "E_CAPABILITY"});
  }
});

it.each(["docx", "pdf"] as const)("preserves authored Attr destinations without adding layout in %s", async to => {
  const ids = ["link-id", "heading-id", "span-id", "div-id", "inline-code-id", "image-id", "block-code-id", "figure-id", "empty-div-id", "trailing-div-id"];
  const bytes = new Uint8Array(encode({width: 2, height: 1, data: new Uint8Array(8).fill(255)}, 80).data);
  const document = (identified: boolean): Document => {
    const attributes = (id: string) => [identified ? id : "", [], []] as const;
    return {metadata: {}, resources: [{id: "picture.jpg", bytes}], blocks: [
      {t: "Para", c: ids.flatMap((id, index): Inline[] => [
        {t: "Link", c: [index === 0 ? attributes("link-id") : attr, [{t: "Str", c: String(index)}], [`#${id}`, ""]]}, {t: "Space"},
      ])},
      {t: "Header", c: [2, attributes("heading-id"), [{t: "Span", c: [attributes("span-id"), [{t: "Str", c: "HEADING"}]]}]]},
      {t: "Div", c: [attributes("div-id"), [{t: "Para", c: [
        {t: "Code", c: [attributes("inline-code-id"), "INLINECODE"]}, {t: "Space"},
        {t: "Image", c: [[identified ? "image-id" : "", [], [["width", "16px"], ["height", "16px"]]], [{t: "Str", c: "pixel"}], ["picture.jpg", ""]]},
      ]}]]},
      {t: "Div", c: [attributes("empty-div-id"), []]},
      {t: "CodeBlock", c: [attributes("block-code-id"), "BLOCKCODE"]},
      {t: "Figure", c: [attributes("figure-id"), [null, [{t: "Para", c: [{t: "Str", c: "CAPTION"}]}]], [{t: "Para", c: [{t: "Str", c: "FIGUREBODY"}]}]]},
      {t: "Div", c: [attributes("trailing-div-id"), []]},
    ]};
  };
  const output = await writeDocument(document(true), {to}, context);
  const control = await writeDocument(document(false), {to}, context);
  if (output.kind !== "binary" || control.kind !== "binary") throw Error("Expected binary documents");
  if (to === "docx") {
    const xml = new TextDecoder().decode(readZipArchiveEntries(output.bytes).get("word/document.xml"));
    const plain = new TextDecoder().decode(readZipArchiveEntries(control.bytes).get("word/document.xml"));
    for (const id of ids) {
      expect(xml.split(`w:name="${id}"`)).toHaveLength(2);
      expect(xml).toContain(`w:anchor="${id}"`);
    }
    expect(xml.split("<w:p>")).toHaveLength(plain.split("<w:p>").length);
  } else {
    const pdf = await PDFDocument.load(output.bytes), plain = await PDFDocument.load(control.bytes);
    expect(painting(pdf)).toEqual(painting(plain));
    const page = pdf.getPages()[0]!;
    const annotations = page.node.Annots()!;
    expect(annotations.size()).toBe(ids.length);
    for (const ref of annotations.asArray()) {
      const destination = pdf.context.lookup(ref, PDFDict).lookup(PDFName.of("Dest"), PDFArray);
      expect(destination.get(0)).toEqual(page.ref);
      expect(destination.lookup(3, PDFNumber).asNumber()).toBeGreaterThan(0);
    }
  }
});

it.each([[4, 1, 40], [6, 2, 136]] as const)("keeps a public HTML paragraph destination with its content after %s introductory paragraphs", async (count, pages, y) => {
  const prefix = '<p><a href="#target">LINK</a></p>' + Array.from({length: count}, (_, index) => `<p>Intro${index}</p>`).join("");
  const options = {from: "html", to: "pdf", pdfPage: {width: 300, height: 180, margin: 20}};
  const output = await convert([{bytes: new TextEncoder().encode(prefix + '<p id="target">TARGETBODY</p>')}], options, context);
  const control = await convert([{bytes: new TextEncoder().encode(prefix + '<p>TARGETBODY</p>')}], options, context);
  if (output.kind !== "binary" || control.kind !== "binary") throw Error("Expected PDF documents");
  const pdf = await PDFDocument.load(output.bytes), plain = await PDFDocument.load(control.bytes);
  expect(painting(pdf)).toEqual(painting(plain));
  expect(pdf.getPageCount()).toBe(plain.getPageCount());
  expect(pdf.getPageCount()).toBe(pages);
  const annotations = pdf.getPages()[0]!.node.Annots()!;
  expect(annotations.size()).toBe(1);
  const destination = pdf.context.lookup(annotations.get(0), PDFDict).lookup(PDFName.of("Dest"), PDFArray);
  expect(destination.get(0)).toEqual(pdf.getPages().at(-1)!.ref);
  expect(destination.lookup(3, PDFNumber).asNumber()).toBeCloseTo(y, 5);
});

it.each([false, true])("preserves table, group, row and cell destinations with caption=%s", async caption => {
  const identified = (id: string) => [id, [], []] as const;
  const row = (name: string): Row => [identified(`${name}row`), [
    [identified(`${name}cell`), "AlignDefault", 1, 1, [{t: "Plain", c: [{t: "Str", c: name}]}]],
  ]];
  const ids = ["table", "head", "headrow", "headcell", "body", "bodyrow", "bodycell", "foot", "footrow", "footcell"];
  const table: Block = {t: "Table", c: [identified("table"), [null, caption ? [{t: "Para", c: [{t: "Str", c: "Caption"}]}] : []],
    [["AlignDefault", {t: "ColWidthDefault"}]], [identified("head"), [row("head")]],
    [[identified("body"), 0, [], [row("body")]]], [identified("foot"), [row("foot")]]]};
  const document: Document = {blocks: [{t: "Para", c: ids.flatMap((id, index): Inline[] => [
    {t: "Link", c: [attr, [{t: "Str", c: String(index)}], [`#${id}`, ""]]}, {t: "Space"},
  ])}, table], metadata: {}, resources: []};
  const xml = (await docxParts(document))("word/document.xml");
  for (const id of ids) {
    expect(xml.split(`w:name="${id}"`)).toHaveLength(2);
    expect(xml).toContain(`w:anchor="${id}"`);
  }
  if (caption) expect(xml.indexOf('w:name="table"')).toBeLessThan(xml.indexOf("Caption"));
  const result = await writeDocument(document, {to: "pdf"}, context);
  if (result.kind !== "binary") throw Error("Expected PDF");
  const pdf = await PDFDocument.load(result.bytes);
  const page = pdf.getPages()[0]!;
  const destinations = page.node.Annots()!.asArray().map(ref => pdf.context.lookup(ref, PDFDict).lookup(PDFName.of("Dest"), PDFArray));
  expect(destinations).toHaveLength(ids.length);
  for (const destination of destinations) expect(destination.get(0)).toEqual(page.ref);
  const y = destinations.map(destination => destination.lookup(3, PDFNumber).asNumber());
  expect(y.slice(1, 4)).toEqual([y[1], y[1], y[1]]);
  expect(y.slice(4, 7)).toEqual([y[4], y[4], y[4]]);
  expect(y.slice(7)).toEqual([y[7], y[7], y[7]]);
  expect(y[0]!).toBeGreaterThanOrEqual(y[1]!);
  expect(y[1]!).toBeGreaterThan(y[4]!);
  expect(y[4]!).toBeGreaterThan(y[7]!);
});

it.each([false, true])("preserves HTML paragraph destinations inside PDF cells with wrapper=%s", async wrapper => {
  const paragraph = '<p id="target">Target</p>';
  const html = `<p><a href="#target">Jump</a></p><table><tr><td>${wrapper ? `<div id="wrapper">${paragraph}</div>` : paragraph}</td></tr></table>`;
  const result = await convert([{bytes: new TextEncoder().encode(html)}], {from: "html", to: "pdf"}, context);
  if (result.kind !== "binary") throw Error("Expected PDF");
  const pdf = await PDFDocument.load(result.bytes);
  const page = pdf.getPages()[0]!;
  const annotations = page.node.Annots()!;
  expect(annotations.size()).toBe(1);
  const destination = pdf.context.lookup(annotations.get(0), PDFDict).lookup(PDFName.of("Dest"), PDFArray);
  expect(destination.get(0)).toEqual(page.ref);
  expect(destination.lookup(3, PDFNumber).asNumber()).toBeGreaterThan(0);
});

it("rejects unsupported mathematical typesetting inside PDF cell wrappers", async () => {
  const html = '<table><tr><td><div id="wrapper"><p><math><mi>x</mi></math></p></div></td></tr></table>';
  await expect(convert([{bytes: new TextEncoder().encode(html)}], {from: "html", to: "pdf"}, context))
    .rejects.toMatchObject({code: "E_CAPABILITY", message: "Unsupported Pdf inline: Math"});
});

it.each(["docx", "pdf"] as const)("preserves structural table destinations through the public HTML reader in %s", async to => {
  const ids = ["table", "head", "headrow", "headcell", "body", "bodyrow", "bodycell", "foot", "footrow", "footcell"];
  const row = (name: string, cell: string) => `<tr id="${name}row"><${cell} id="${name}cell">${name}</${cell}></tr>`;
  const html = `<p>${ids.map((id, index) => `<a href="#${id}">${index}</a>`).join(" ")}</p><table id="table"><thead id="head">${row("head", "th")}</thead><tbody id="body">${row("body", "td")}</tbody><tfoot id="foot">${row("foot", "td")}</tfoot></table>`;
  const result = await convert([{bytes: new TextEncoder().encode(html)}], {from: "html", to}, context);
  if (result.kind !== "binary") throw Error("Expected binary document");
  if (to === "docx") {
    const xml = new TextDecoder().decode(readZipArchiveEntries(result.bytes).get("word/document.xml"));
    for (const id of ids) expect(xml.split(`w:name="${id}"`)).toHaveLength(2);
  } else {
    const pdf = await PDFDocument.load(result.bytes);
    const page = pdf.getPages()[0]!;
    const annotations = page.node.Annots()!;
    expect(annotations.size()).toBe(ids.length);
    for (const ref of annotations.asArray()) {
      const destination = pdf.context.lookup(ref, PDFDict).lookup(PDFName.of("Dest"), PDFArray);
      expect(destination.get(0)).toEqual(page.ref);
    }
  }
});

it("preserves external hyperlinks whose only content is an image", async () => {
  const bytes = new Uint8Array(encode({width: 2, height: 1, data: new Uint8Array(8).fill(255)}, 80).data);
  const xml = await docxParts({blocks: [{t: "Para", c: [{t: "Link", c: [attr, [
    {t: "Image", c: [attr, [{t: "Str", c: "Preview"}], ["preview.jpg", "Preview"]]}
  ], ["https://example.com/report", ""]]}]}], metadata: {}, resources: [{id: "preview.jpg", bytes}]});
  expect(xml("word/document.xml")).toMatch(/<w:hyperlink\b[^>]*>[\s\S]*?<w:drawing\b[^>]*>[\s\S]*?<\/w:hyperlink>/);
  expect(xml("word/_rels/document.xml.rels")).toContain('Target="https://example.com/report"');
});

it.each(["background-color:#fc3", "BACKGROUND-COLOR: #ffcc33"])("preserves authored inline highlight %s", async style => {
  const xml = await docxParts({blocks: [{t: "Para", c: [{t: "Span", c: [["", [], [["style", style]]], [{t: "Str", c: "Highlighted"}]]}]}], metadata: {}, resources: []});
  expect(xml("word/document.xml")).toContain('w:fill="FFCC33"');
});

it("accepts block and structured metadata in DOCX without rejecting the document body", async () => {
  const xml = await docxParts({blocks: [{t: "Para", c: [{t: "Str", c: "Document body"}]}], resources: [], metadata: {
    title: {t: "MetaBlocks", c: [{t: "Para", c: [{t: "Str", c: "Block title"}]}]},
    author: {t: "MetaMap", c: {name: {t: "MetaString", c: "Author name"}}}
  }});
  expect(xml("word/document.xml")).toContain("Document body");
  expect(xml("word/document.xml")).toContain("Block title");
  expect(xml("word/document.xml")).not.toContain("Author name");
});

it("preserves quotation marks when projecting inline PDF metadata", async () => {
  const result = await writeDocument({blocks: [{t: "Para", c: [{t: "Str", c: "Document body"}]}], resources: [], metadata: {
    title: {t: "MetaInlines", c: [{t: "Quoted", c: ["DoubleQuote", [{t: "Str", c: "Quoted title"}]]}]}
  }}, {to: "pdf"}, context);
  if (result.kind !== "binary") throw new Error("Expected PDF");
  expect((await PDFDocument.load(result.bytes)).getTitle()).toBe("“Quoted title”");
});

it("embeds GIF image resources in DOCX", async () => {
  const bytes = new Uint8Array(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
  const xml = await docxParts({blocks: [{t: "Para", c: [{t: "Image", c: [attr, [], ["pixel.gif", ""]]}]}], metadata: {}, resources: [{id: "pixel.gif", bytes}]});
  expect(xml("[Content_Types].xml")).toContain('ContentType="image/gif"');
  expect(xml("word/document.xml")).toContain("w:drawing");
});

it("honors JPEG density metadata for the native DOCX image size", async () => {
  const bytes = new Uint8Array(encode({width: 200, height: 100, data: new Uint8Array(200 * 100 * 4).fill(255)}, 80).data);
  expect(new TextDecoder().decode(bytes.subarray(6, 11))).toBe("JFIF\0");
  bytes[13] = 1; // JFIF density unit: dots per inch.
  new DataView(bytes.buffer).setUint16(14, 200);
  new DataView(bytes.buffer).setUint16(16, 200);
  const xml = await docxParts({blocks: [{t: "Para", c: [{t: "Image", c: [attr, [], ["photo.jpg", ""]]}]}], metadata: {}, resources: [{id: "photo.jpg", bytes}]});
  expect(xml("word/document.xml")).toContain('cx="914400" cy="457200"');
});

it.each(["parts", "xmlNodes", "xmlDepth", "binaryBytes", "expandedBytes", "compressedBytes"] as const)("enforces the configured DOCX %s budget", async limit => {
  const document: Document = {blocks: [{t: "Para", c: [{t: "Str", c: "Document body"}]}], metadata: {}, resources: []};
  const outcome = await writeDocument(document, {to: "docx"}, {...context, limits: {[limit]: 1}})
    .then(() => "accepted", (error: {code?: string}) => error.code);
  expect(outcome).toBe("E_LIMIT");
});


it("preserves supported deeply nested inline formatting without imposing a new implicit depth cap", async () => {
  let inline: Inline = {t: "Str", c: "Nested formatting"};
  for (let depth = 0; depth < 70; depth++) inline = {t: "Strong", c: [inline]};
  const xml = await docxParts({blocks: [{t: "Para", c: [inline]}], metadata: {}, resources: []});
  expect(xml("word/document.xml")).toContain("Nested formatting");
});

it("keeps column alignment after an earlier column continues a vertical merge", async () => {
  const cell = (label: string, rowspan = 1) => [attr, "AlignDefault", rowspan, 1, [{t: "Para", c: [{t: "Str", c: label}]}]] as const;
  const xml = await docxParts({blocks: [{t: "Table", c: [attr, [null, []], [
    ["AlignLeft", {t: "ColWidthDefault"}], ["AlignRight", {t: "ColWidthDefault"}]
  ], [attr, []], [[attr, 0, [], [[attr, [cell("Merged", 2), cell("First row")]], [attr, [cell("ROWSPAN-CONTINUATION")]]]]], [attr, []]]}], metadata: {}, resources: []});
  const continuation = [...xml("word/document.xml").matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map(match => match[0]).find(value => value.includes("ROWSPAN-CONTINUATION"));
  expect(continuation).toContain('w:jc w:val="right"');
});

it.each(["javascript:alert(1)", "file:///report.pdf", "ftp://example.com/report", "data:text/html,bad", "1:invalid", " javascript:alert(1)", "bad\npath", "bad\u007fpath"])("preserves explicit PDF rejection for unsupported link %s", async target => {
  await expect(writeDocument({blocks: [{t: "Para", c: [{t: "Link", c: [attr, [{t: "Str", c: "Link"}], [target, ""]]}]}], resources: [], metadata: {}}, {to: "pdf"}, context)).rejects.toMatchObject({code: "E_CAPABILITY"});
});

it("retains case-insensitive mailto annotations in PDF", async () => {
  const result = await writeDocument({blocks: [{t: "Para", c: [{t: "Link", c: [attr, [{t: "Str", c: "Email"}], ["MAILTO:report@example.com", ""]]}]}], resources: [], metadata: {}}, {to: "pdf"}, context);
  if (result.kind !== "binary") throw new Error("Expected PDF");
  const pdf = await PDFDocument.load(result.bytes);
  const annotations = pdf.getPages()[0]!.node.Annots()!;
  const uris = annotations.asArray().map(ref => {
    const annotation = pdf.context.lookup(ref, PDFDict);
    const uri = annotation.lookup(PDFName.of("A"), PDFDict).get(PDFName.of("URI"));
    if (!(uri instanceof PDFString) && !(uri instanceof PDFHexString)) throw new Error("Expected URI string");
    return uri.decodeText().toLowerCase();
  });
  expect(uris).toContain("mailto:report@example.com");
});

it.each(["", "README.md", "../notes/other.md#section", "/docs/intro", "//example.com/docs", "?view=print", "notes/part:two.md", "?next=https:example.com", "notes with spaces.md", "notes/%20.md"])("preserves the relative PDF URI reference %s", async target => {
  const result = await writeDocument({blocks: [{t: "Para", c: [{t: "Link", c: [attr, [{t: "Str", c: "Related note"}], [target, ""]]}]}], resources: [], metadata: {}}, {to: "pdf"}, context);
  if (result.kind !== "binary") throw Error("Expected PDF");
  const pdf = await PDFDocument.load(result.bytes);
  const annotation = pdf.context.lookup(pdf.getPages()[0]!.node.Annots()!.get(0), PDFDict);
  const uri = annotation.lookup(PDFName.of("A"), PDFDict).get(PDFName.of("URI"));
  if (!(uri instanceof PDFString) && !(uri instanceof PDFHexString)) throw Error("Expected URI string");
  expect(uri.decodeText()).toBe(target);
});

it.each(["docx", "pdf"] as const)("treats nested image-alt nodes as descriptions in %s", async to => {
  const bytes = new Uint8Array(encode({width: 2, height: 1, data: new Uint8Array(8).fill(255)}, 80).data);
  const result = await writeDocument({blocks: [{t: "Para", c: [{t: "Image", c: [attr, [
    {t: "Str", c: "foo"}, {t: "Space"},
    {t: "Link", c: [attr, [{t: "Str", c: "bar"}], ["javascript:never-an-annotation", ""]]}, {t: "Space"},
    {t: "Image", c: [attr, [{t: "Str", c: "baz"}], ["absent-inner.jpg", ""]]}
  ], ["outer.jpg", ""]]}]}], resources: [{id: "outer.jpg", bytes}], metadata: {}}, {to}, {
    ...context, limits: {images: 1},
    resources: {resolve: async source => {throw Error(`Unexpected resource: ${source}`);}}
  });
  if (result.kind !== "binary") throw Error("Expected binary document");
  if (to === "docx") {
    const parts = readZipArchiveEntries(result.bytes);
    expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain('descr="foo bar baz"');
    expect([...parts.keys()].filter(name => name.startsWith("word/media/"))).toHaveLength(1);
  } else {
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPages()[0]!.node.Annots()?.size() ?? 0).toBe(0);
  }
});

it.each(["docx", "pdf"] as const)("ignores notes containing figures inside image alt text in %s", async to => {
  const bytes = new Uint8Array(encode({width: 2, height: 1, data: new Uint8Array(8).fill(255)}, 80).data);
  const resolve = vi.fn(async (source: string) => {
    if (source !== "outer.jpg") throw Error(`Hidden note resource was resolved: ${source}`);
    return bytes;
  });
  const note: Inline = {t: "Note", c: [{t: "Figure", c: [attr, [null, []], [
    {t: "Para", c: [{t: "Image", c: [attr, [{t: "Str", c: "HIDDEN"}], ["missing.jpg", ""]]}]},
  ]]}]};
  const render = (alt: Inline[]) => writeDocument({blocks: [{t: "Para", c: [
    {t: "Image", c: [attr, alt, ["outer.jpg", ""]]},
  ]}], resources: [], metadata: {}}, {to}, {...context, limits: {images: 1}, resources: {resolve}});
  const expected = await render([{t: "Str", c: "description"}]);
  const actual = await render([{t: "Str", c: "description"}, note]);
  expect(actual.kind).toBe("binary");
  if (actual.kind !== "binary" || expected.kind !== "binary") throw Error("Expected binary document");
  expect(actual.bytes).toEqual(expected.bytes);
  expect(resolve.mock.calls.map(([source]) => source)).toEqual(["outer.jpg", "outer.jpg"]);
  if (to === "docx") {
    const parts = readZipArchiveEntries(actual.bytes);
    const xml = new TextDecoder().decode(parts.get("word/document.xml"));
    expect(xml).toContain('descr="description"');
    expect(xml).not.toContain("footnoteReference");
    expect(parts.has("word/footnotes.xml")).toBe(false);
  }
});

it("does not validate targets of empty PDF links that emit no annotation", async () => {
  const result = await writeDocument({blocks: [{t: "Para", c: [{t: "Str", c: "Visible"}, {t: "Link", c: [attr, [], ["javascript:never-an-annotation", ""]]}]}], resources: [], metadata: {}}, {to: "pdf"}, context);
  if (result.kind !== "binary") throw Error("Expected PDF");
  expect((await PDFDocument.load(result.bytes)).getPages()[0]!.node.Annots()?.size() ?? 0).toBe(0);
});

it("keeps descriptive image text subject to retained input limits", async () => {
  const bytes = new Uint8Array(encode({width: 2, height: 1, data: new Uint8Array(8).fill(255)}, 80).data);
  const render = (alt: string) => writeDocument({blocks: [{t: "Para", c: [{t: "Image", c: [attr, [{t: "Str", c: alt}], ["outer.jpg", ""]]}]}], resources: [{id: "outer.jpg", bytes}], metadata: {}}, {to: "docx"}, {...context, limits: {retainedBytes: 65536}});
  expect((await render("short description")).kind).toBe("binary");
  await expect(render("long description ".repeat(10000))).rejects.toMatchObject({code: "E_LIMIT"});
});

it("does not resolve image references used only in descriptive PDF metadata", async () => {
  const result = await writeDocument({blocks: [{t: "Para", c: [{t: "Str", c: "Body"}]}], resources: [], metadata: {subject: {t: "MetaInlines", c: [{t: "Image", c: [attr, [{t: "Str", c: "Metadata subject"}], ["absent.jpg", ""]]}]}}}, {to: "pdf"}, {...context, limits: {images: 0}, resources: {resolve: async () => {throw Error("Metadata resource must not be resolved");}}});
  if (result.kind !== "binary") throw Error("Expected PDF");
  expect((await PDFDocument.load(result.bytes)).getSubject()).toBe("Metadata subject");
});

it("still validates a rendered image's enclosing PDF hyperlink", async () => {
  const bytes = new Uint8Array(encode({width: 2, height: 1, data: new Uint8Array(8).fill(255)}, 80).data);
  const image: Inline = {t: "Image", c: [attr, [{t: "Str", c: "description"}], ["outer.jpg", ""]]};
  await expect(writeDocument({blocks: [{t: "Para", c: [{t: "Link", c: [attr, [image], ["javascript:active-link", ""]]}]}], resources: [{id: "outer.jpg", bytes}], metadata: {}}, {to: "pdf"}, context)).rejects.toMatchObject({code: "E_CAPABILITY"});
});
