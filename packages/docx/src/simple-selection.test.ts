import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as sdk from "./index.js";

const context: sdk.ArchiveContext = { signal: new AbortController().signal, limits: {
  maxArchiveBytes: 65536, maxEntryBytes: 32768, maxTotalBytes: 65536, maxMembers: 32,
  maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 0, maxCommentBytes: 0,
  maxRetainedBytes: 32 * 1024 * 1024, chunkSize: 512
} };
const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const picture = '<w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="art"/></w:drawing></w:r>';
async function fixture(change?: (files: Map<string, string>) => void) {
  const files = new Map([
    ["[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'],
    ["_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="art" Type="${r}/image" Target="media/mark.png"/><Relationship Id="head" Type="${r}/header" Target="header.xml"/></Relationships>`],
    ["word/document.xml", `<w:document xmlns:w="${w}" xmlns:r="${r}"><w:body>${p("Coast 🌊")}${p("Second")}<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p("Wide")}<w:p>${picture}${picture}</w:p></w:tc></w:tr></w:tbl><w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="head"/></w:sectPr></w:pPr></w:p>${p("Last section")}<w:sectPr/></w:body></w:document>`],
    ["word/header.xml", `<w:hdr xmlns:w="${w}">${p("Shared header")}</w:hdr>`],
    ["word/media/mark.png", "original synthetic image"]
  ]);
  change?.(files);
  const fs = Volume.fromJSON({ "/document": "" });
  await sdk.writeArchive({ comment: new Uint8Array(), members: [...files].map(([name, value]) => ({ name,
    bytes: new TextEncoder().encode(value), directory: false, modified: new Date("2025-01-02T00:00:00Z") })) },
  { async write(bytes) { fs.appendFileSync("/document", bytes); } }, { order: "input", compression: "store" }, context);
  return sdk.openDocumentLocations(new Uint8Array(fs.readFileSync("/document") as Uint8Array), context);
}
const parse = (...args: string[]) => sdk.parseDocxArguments(args.map(arg => new TextEncoder().encode(arg)));

it("resolves paired direct flags and SDK selectors inside a logical merged cell", async () => {
  const document = await fixture();
  const cli = parse("images", "get", "coast ü.docx", "--table", "1", "--cell", "B1", "--paragraph", "2", "--image", "2");
  const request = { operation: "images.get", inputs: ["coast ü.docx"], options: { table: 1, cell: "B1", paragraph: 2, image: 2 } };
  const selected = sdk.resolveDocxSelection(document, request);
  expect(sdk.resolveDocxSelection(document, cli)).toEqual(selected);
  expect(selected).toHaveLength(1);
  expect(selected[0]!.value.path).toEqual([0, 2, 1, 0, 2, 1, 0, 0]);
});
it("resolves merged slots to one anchor and keeps paragraph ordinals owner-local", async () => {
  const document = await fixture();
  const resolve = (cell: string) => sdk.resolveDocxSelection(document, parse("tables", "set", "in", "--table", "1", "--cell", cell, "--text", "New", "--dry-run"));
  expect(resolve("B1")).toEqual(resolve("A1"));
  const paragraph = sdk.resolveDocxSelection(document, parse("paragraphs", "get", "in", "--table", "1", "--cell", "B1", "--paragraph", "1"));
  expect(paragraph[0]!.positions.paragraph).toBe(1);
});
it("selects section-local body paragraphs and inherited header references", async () => {
  const document = await fixture();
  const body = sdk.resolveDocxSelection(document, parse("paragraphs", "get", "in", "--section", "2", "--paragraph", "1"));
  expect(body[0]!.value.path).toEqual([0, 4]);
  const header = sdk.resolveDocxSelection(document, parse("headers", "get", "in", "--section", "2"));
  expect(header[0]!.value.part).toBe("/word/header.xml");
  expect(() => sdk.resolveDocxSelection(document, parse("headers", "set", "in", "--section", "2", "--text", "x", "--dry-run")))
    .toThrowError(expect.objectContaining({ code: "ambiguous-selection" }));
  expect(sdk.resolveDocxSelection(document, parse("headers", "set", "in", "--section", "2", "--shared", "--text", "x", "--dry-run"))).toHaveLength(1);
});
it("keeps image occurrence selection isolated unless shared intent is explicit", async () => {
  const document = await fixture();
  const args = ["images", "replace", "in", "--image", "1", "--file", "mark.png", "--dry-run"];
  expect(sdk.resolveDocxSelection(document, parse(...args))).toHaveLength(1);
  expect(sdk.resolveDocxSelection(document, parse(...args, "--shared"))).toHaveLength(2);
});
it.each(["headers", "footers"] as const)("resolves explicit section-local unlink intent for shared %s", async resource => {
  const document = await fixture(resource === "footers" ? files => {
    const entries = [...files];
    files.clear();
    for (const [name, xml] of entries) files.set(name.replaceAll("header", "footer"),
      xml.replaceAll("header", "footer").replaceAll("w:hdr", "w:ftr"));
  } : undefined);
  const original = document.snapshot();
  for (const text of [undefined, "Local heading"]) {
    const options = { section: 2, linkToPrevious: false, dryRun: true, ...(text === undefined ? {} : { text }) };
    const selected = sdk.resolveDocxSelection(document, { operation: `${resource}.set`, inputs: ["in"], options });
    const cli = parse(resource, "set", "in", "--section", "2", "--link-to-previous", "false", "--dry-run",
      ...(text === undefined ? [] : ["--text", text]));
    expect(sdk.resolveDocxSelection(document, cli)).toEqual(selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.positions.section).toBe(2);
    expect(document.references(selected[0]!.token)).toHaveLength(2);
    expect(() => sdk.resolveDocxSelection(document, { operation: `${resource}.set`, inputs: ["in"],
      options: { select: selected[0]!.token, linkToPrevious: false, dryRun: true } }))
      .toThrowError(expect.objectContaining({ code: "ambiguous-selection" }));
  }
  expect(document.snapshot()).toEqual(original);
});
it("preserves fresh tokens and rejects stale and wrong-kind tokens", async () => {
  const document = await fixture();
  const token = document.at("paragraph", 1).token;
  expect(sdk.resolveDocxSelection(document, parse("paragraphs", "get", "in", "--select", token))[0]!.token).toBe(token);
  const stale = sdk.encodeLocation({ ...sdk.decodeLocation(token), generation: 1 });
  expect(() => sdk.resolveDocxSelection(document, parse("paragraphs", "get", "in", "--select", stale))).toThrowError(expect.objectContaining({ code: "stale-selection" }));
  expect(() => sdk.resolveDocxSelection(document, parse("images", "get", "in", "--select", token))).toThrowError(expect.objectContaining({ code: "missing-selection" }));
});
it("does not apply text match cardinality to the paragraph owner inventory", async () => {
  const document = await fixture();
  for (const cardinality of [["--first"], ["--all"], ["--occurrence", "2"]]) {
    expect(sdk.resolveDocxSelection(document, parse("text", "replace", "in", "--find", "Coast", "--with", "Bay", ...cardinality, "--dry-run")))
      .toHaveLength(6);
  }
});
it("allows empty read inventories but never swallows a missing explicit target", async () => {
  const document = await fixture();
  expect(sdk.resolveDocxSelection(document, parse("images", "list", "in", "--scope", "footers"))).toEqual([]);
  expect(() => sdk.resolveDocxSelection(document, parse("images", "get", "in", "--image", "99"))).toThrowError(expect.objectContaining({ code: "missing-selection" }));
});
it("selects all resources only within the requested scope and reports ambiguity candidates", async () => {
  const document = await fixture();
  const selected = sdk.resolveDocxSelection(document, parse("paragraphs", "set", "in", "--all", "--text", "New", "--dry-run"));
  expect(selected).toHaveLength(6);
  expect(selected.every(location => location.value.story.endsWith("#body"))).toBe(true);
  const table = document.at("table", 1).token;
  expect(() => sdk.resolveDocxSelection(document, parse("paragraphs", "get", "in", "--table", "1", "--cell", "A1", "--paragraph", "99")))
    .toThrowError(expect.objectContaining({ code: "missing-selection" }));
  expect(() => sdk.resolveDocxSelection(document, parse("paragraphs", "get", "in", "--select", table)))
    .toThrowError(expect.objectContaining({ code: "missing-selection" }));
  try { document.select(document.list("image"), {}, "mutation"); }
  catch (error) {
    expect(error).toMatchObject({ code: "ambiguous-selection", candidates: expect.any(Array) });
    expect((error as sdk.SelectionError).candidates).toHaveLength(2);
    expect(String(error)).not.toContain("Coast");
  }
});
it("retains source-local cardinality after scoped owner selection", async () => {
  const document = await fixture();
  const paragraph = sdk.resolveDocxSelection(document, parse("text", "replace", "in", "--paragraph", "1", "--find", "o", "--with", "a", "--occurrence", "2", "--dry-run"))[0]!;
  const matches = [document.range(paragraph.token, 0, 1), document.range(paragraph.token, 1, 2)];
  expect(document.select(matches, { first: true }, "text")).toEqual([matches[0]]);
  expect(document.select(matches, { all: true }, "text")).toEqual(matches);
  expect(document.select(matches, { occurrence: 2 }, "text")).toEqual([matches[1]]);
  expect(document.select([], { all: true, allowEmpty: true }, "text")).toEqual([]);
  expect(() => document.select([], { first: true }, "text")).toThrowError(expect.objectContaining({ code: "missing-selection" }));
});
it("resolves header all-stories requests without widening to body or footer stories", async () => {
  const document = await fixture();
  expect(sdk.resolveDocxSelection(document, parse("headers", "get", "in", "--section", "2", "--scope", "all-stories")))
    .toHaveLength(1);
});
it("uses the selected paragraph as the container for inline image insertion", async () => {
  const document = await fixture();
  const selected = sdk.resolveDocxSelection(document, parse("images", "add", "in", "--paragraph", "2", "--file", "image.png", "--dry-run"));
  expect(selected).toHaveLength(1);
  expect(selected[0]!.kind).toBe("paragraph");
  expect(selected[0]!.value.path).toEqual([0, 1]);
});
it("does not silently ignore descendant selectors on paragraph targets", async () => {
  const document = await fixture();
  expect(() => sdk.resolveDocxSelection(document, parse("paragraphs", "get", "in", "--paragraph", "4", "--image", "1")))
    .toThrowError(expect.objectContaining({ code: "usage" }));
});
it("preserves the direct command engine and SDK selection handoff with spaces and Unicode", async () => {
  const document = await fixture();
  const fs = Volume.fromJSON({ "/stdout": "", "/stderr": "" });
  let selected: readonly sdk.Location[] = [];
  const engine = sdk.createDocxCommandEngine({ async execute(invocation) {
    selected = sdk.resolveDocxSelection(document, invocation);
    return { exitCode: 0 };
  } });
  const args = ["tables", "set", "--table", "1", "--cell", "B1", "--text", "Port ü", "--dry-run", "--", "-coast ü.docx"];
  const result = await engine.execute({ args: args.map(arg => new TextEncoder().encode(arg)),
    stdin: (async function* () {})(), signal: context.signal,
    stdout: { async write(bytes) { fs.appendFileSync("/stdout", bytes); } },
    stderr: { async write(bytes) { fs.appendFileSync("/stderr", bytes); } }
  });
  expect(result.exitCode).toBe(0);
  expect(selected).toEqual(sdk.resolveDocxSelection(document, { operation: "tables.set", inputs: ["-coast ü.docx"], options: { table: 1, cell: "B1", text: "Port ü", dryRun: true } }));
  expect(fs.readFileSync("/stderr", "utf8")).toBe("");
  expect(document.generation).toBe(0);
});
it("validates destination intent identically before SDK and CLI selector resolution", async () => {
  const document = await fixture();
  for (const options of [{}, { inPlace: true, output: "out" }, { inPlace: true, force: true }, { output: "-", json: true }]) {
    const value = { operation: "paragraphs.set", inputs: ["in"], options: { paragraph: 1, text: "Next", ...options } };
    expect(() => sdk.resolveDocxSelection(document, value)).toThrowError(expect.objectContaining({ code: "usage" }));
  }
  const original = document.snapshot();
  const output = Volume.fromJSON({ "/stdout": "" });
  const invocation = parse("paragraphs", "set", "in", "--paragraph", "1", "--text", "Next", "--output", "-", "--json", "--dry-run");
  expect(sdk.resolveDocxSelection(document, invocation)).toHaveLength(1);
  await sdk.publishDocumentArchive(original, { output: "-", json: true, dryRun: true }, { ...context,
    encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { output.appendFileSync("/stdout", bytes); } } });
  expect(output.readFileSync("/stdout", "utf8")).toBe("");
  expect(document.snapshot()).toEqual(original);
});
it("rejects tokens for the wrong story", async () => {
  const document = await fixture();
  const body = document.list("story")[0]!.token;
  expect(() => sdk.resolveDocxSelection(document, parse("headers", "get", "in", "--select", body)))
    .toThrowError(expect.objectContaining({ code: "missing-selection" }));
});
it("requires a scalar table token to identify a cell", async () => {
  const document = await fixture();
  const table = document.at("table", 1).token;
  expect(() => sdk.resolveDocxSelection(document, parse("tables", "set", "in", "--select", table, "--text", "New", "--dry-run")))
    .toThrowError(expect.objectContaining({ code: "usage" }));
});
it("appends block insertions to the unique story and preserves explicit anchors", async () => {
  const document = await fixture();
  expect(sdk.resolveDocxSelection(document, parse("paragraphs", "add", "in", "--text", "New", "--dry-run"))[0]!.kind).toBe("story");
  expect(sdk.resolveDocxSelection(document, parse("paragraphs", "add", "in", "--paragraph", "2", "--text", "New", "--before", "--dry-run"))[0]!.positions.paragraph).toBe(2);
});
it("retains the requested section in inherited header display positions", async () => {
  const document = await fixture();
  expect(sdk.resolveDocxSelection(document, parse("headers", "get", "in", "--section", "2"))[0]!.positions.section).toBe(2);
});
it("rejects accessor-backed SDK invocations without invoking them", async () => {
  const document = await fixture();
  let calls = 0;
  const invocation = { get operation() { calls++; return "paragraphs.get"; }, inputs: ["in"], options: { paragraph: 1 } };
  expect(() => sdk.resolveDocxSelection(document, invocation)).toThrowError(expect.objectContaining({ code: "usage" }));
  expect(calls).toBe(0);
});
it("expands explicit shared images across story owners", async () => {
  const document = await fixture(files => {
    files.set("word/header.xml", `<w:hdr xmlns:w="${w}" xmlns:r="${r}"><w:p>${picture}</w:p></w:hdr>`);
    files.set("word/_rels/header.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="art" Type="${r}/image" Target="media/mark.png"/></Relationships>`);
  });
  const one = parse("images", "replace", "in", "--image", "1", "--file", "mark.png", "--dry-run");
  expect(sdk.resolveDocxSelection(document, one)).toHaveLength(1);
  const shared = sdk.resolveDocxSelection(document, { ...one, options: { ...one.options, shared: true } });
  expect(shared).toHaveLength(3);
  expect(shared[2]!.value.part).toBe("/word/header.xml");
});
it("accepts insertion anchor tokens", async () => {
  const document = await fixture();
  const paragraph = document.at("paragraph", 1);
  expect(sdk.resolveDocxSelection(document, parse("paragraphs", "add", "in", "--select", paragraph.token, "--text", "Next", "--dry-run"))[0]!.token).toBe(paragraph.token);
});
it("does not discard ranges on whole paragraph edits", async () => {
  const document = await fixture();
  const paragraph = document.at("paragraph", 1);
  const range = document.range(paragraph.token, 0, 1).token;
  expect(() => sdk.resolveDocxSelection(document, parse("paragraphs", "set", "in", "--select", range, "--text", "Next", "--dry-run")))
    .toThrowError(expect.objectContaining({ code: "usage" }));
});
it("handles a section break nested in a structured body container", async () => {
  const document = await fixture(files => {
    const source = files.get("word/document.xml")!;
    const start = source.indexOf('<w:p><w:pPr><w:sectPr>');
    const end = source.indexOf('</w:p>', start) + '</w:p>'.length;
    files.set("word/document.xml", source.slice(0, start) + '<w:sdt><w:sdtContent>' + source.slice(start, end) + '</w:sdtContent></w:sdt>' + source.slice(end));
  });
  const selected = sdk.resolveDocxSelection(document, parse("paragraphs", "get", "in", "--section", "2", "--paragraph", "1"));
  expect(selected[0]!.value.path).toEqual([0, 4]);
});
it("defers shared-story mutation checks until actual text matches are known", async () => {
  const document = await fixture();
  const owners = sdk.resolveDocxSelection(document, parse("text", "replace", "in", "--scope", "all-stories", "--find", "Coast", "--with", "Bay", "--first", "--dry-run"));
  expect(owners).toHaveLength(7);
  const header = owners.find(location => location.value.part === "/word/header.xml")!;
  expect(() => document.mutate([document.range(header.token, 0, 1)], {}, () => []))
    .toThrowError(expect.objectContaining({ code: "ambiguous-selection" }));
});
