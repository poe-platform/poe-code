import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createHash } from "node:crypto";
import {
  openDocumentLocations, encodeLocation, decodeLocation, writeArchive,
  DocumentBudget, type ArchiveContext, type LocationPayload
} from "./index.js";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const context: ArchiveContext = {
  signal: new AbortController().signal,
  limits: { maxArchiveBytes: 65536, maxEntryBytes: 32768, maxTotalBytes: 65536,
    maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 0,
    maxCommentBytes: 32, maxRetainedBytes: 32 * 1024 * 1024, chunkSize: 512 }
};
const main = "/reports/main.xml";
async function fixture(prefix = "w", pretty = false, media = 0x80, change?: (files: Map<string, string | Uint8Array>) => void) {
  const p = (text: string) => `<${prefix}:p><${prefix}:r><${prefix}:t>${text}</${prefix}:t></${prefix}:r></${prefix}:p>`;
  const body = `${p("Harbor 🌊 Harbor")}${p("Harbor 🌊 Harbor")}<${prefix}:tbl><${prefix}:tblGrid><${prefix}:gridCol/><${prefix}:gridCol/></${prefix}:tblGrid><${prefix}:tr><${prefix}:tc><${prefix}:tcPr><${prefix}:gridSpan ${prefix}:val="2"/></${prefix}:tcPr>${p("Wide")}</${prefix}:tc></${prefix}:tr></${prefix}:tbl><${prefix}:p><${prefix}:r><${prefix}:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="img"/></${prefix}:drawing></${prefix}:r><${prefix}:pPr><${prefix}:sectPr><${prefix}:headerReference ${prefix}:type="default" r:id="h1"/></${prefix}:sectPr></${prefix}:pPr></${prefix}:p><${prefix}:sectPr><${prefix}:headerReference ${prefix}:type="default" r:id="h2"/></${prefix}:sectPr>`;
  const mainXml = `<${prefix}:document xmlns:${prefix}="${w}" xmlns:r="${r}"><${prefix}:body>${body}</${prefix}:body></${prefix}:document>`;
  const rels = (content: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${content}</Relationships>`;
  const edge = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`;
  const files = new Map<string, string | Uint8Array>([
    ["[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="image/png"/><Override PartName="${main}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/reports/header.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`],
    ["_rels/.rels", rels(edge("main", "officeDocument", "reports/main.xml"))],
    [main.slice(1), pretty ? mainXml.split("><").join(">\n  <") : mainXml],
    ["reports/_rels/main.xml.rels", rels(edge("h1", "header", "header.xml") + edge("h2", "header", "header.xml") + edge("img", "image", "../assets/mark.bin"))],
    ["reports/header.xml", `<${prefix}:hdr xmlns:${prefix}="${w}">${p("Header")}</${prefix}:hdr>`],
    ["assets/mark.bin", Uint8Array.of(media)]
  ]);
  change?.(files);
  const fs = Volume.fromJSON({ "/document": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...files].map(([name, data]) => ({ name,
    bytes: typeof data === "string" ? new TextEncoder().encode(data) : data,
    directory: false, modified: new Date("2025-01-02T03:04:06Z") })) },
  { async write(bytes) { fs.appendFileSync("/document", bytes); } }, { order: "input", compression: "store" }, context);
  return new Uint8Array(fs.readFileSync("/document") as Uint8Array);
}

const payload: LocationPayload = { version: 1, sourceSha256: "a".repeat(64), generation: 0,
  part: main, story: main + "#body", path: [0, 1], range: null };

describe("document location tokens", () => {
  it("uses the exact ordered canonical token and detached values", () => {
    const token = "docx-loc-v1." + Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect(encodeLocation(payload)).toBe(token);
    const decoded = decodeLocation(token);
    expect(decoded).toEqual(payload);
    expect(Object.isFrozen(decoded.path)).toBe(true);
  });
  it.each([
    { ...payload, generation: -1 }, { ...payload, sourceSha256: "A".repeat(64) },
    { ...payload, path: [1.5] }, { ...payload, path: [-1] },
    { ...payload, part: "/reports/../main.xml" }, { ...payload, range: { start: 3, end: 2 } },
    { ...payload, extra: true }, { ...payload, version: 2 }
  ])("rejects malformed token data %#", data => {
    const token = "docx-loc-v1." + Buffer.from(JSON.stringify(data)).toString("base64url");
    expect(() => decodeLocation(token)).toThrowError(expect.objectContaining({ code: "usage" }));
  });
  it("rejects noncanonical encoding, duplicate keys, malformed UTF-8 and oversized tokens", () => {
    const json = JSON.stringify(payload);
    for (const token of [encodeLocation(payload) + "=", "docx-loc-v1./+", "docx-loc-v1.gA",
      "docx-loc-v1." + "A".repeat(100000),
      "docx-loc-v1." + Buffer.from(json.replace('{"version":1,', '{"version":1,"version":1,')).toString("base64url"),
      "docx-loc-v1." + Buffer.from(" " + json).toString("base64url")])
      expect(() => decodeLocation(token)).toThrowError(expect.objectContaining({ code: "usage" }));
  });
});

describe("document logical locations", () => {
  it("indexes typed resources with byte fingerprints, element paths and shared story owners", async () => {
    const bytes = await fixture();
    const doc = await openDocumentLocations(bytes, context);
    const p = doc.list("paragraph");
    expect(p).toHaveLength(4);
    expect(p[0]).toMatchObject({ kind: "paragraph", value: { sourceSha256: createHash("sha256").update(bytes).digest("hex"), generation: 0, part: main, story: main + "#body", path: [0, 0], range: null }, positions: { paragraph: 1 } });
    expect(doc.list("story", { scope: "headers" })).toHaveLength(1);
    expect(doc.list("paragraph", { scope: "headers" })).toHaveLength(1);
    expect(doc.list("image")).toHaveLength(1);
    expect(doc.list("part")).toHaveLength(6);
    expect(doc.list("part").some(p => p.value.part === "/[Content_Types].xml")).toBe(true);
    expect(JSON.stringify(p)).not.toContain("namespaces");
    expect(doc.resolve(p[1]!.token, "paragraph")).toEqual(p[1]);
  });
  it("keeps addresses stable across prefixes and pretty display but rejects changed source bytes", async () => {
    const a = await openDocumentLocations(await fixture(), context);
    const b = await openDocumentLocations(await fixture("q", true), context);
    expect(a.list("paragraph").map(x => x.value.path)).toEqual(b.list("paragraph").map(x => x.value.path));
    expect(() => b.resolve(a.list("paragraph")[0]!.token)).toThrowError(expect.objectContaining({ code: "stale-selection" }));
    const c = await openDocumentLocations(await fixture("w", false, 0x81), context);
    expect(new TextDecoder().decode(Uint8Array.of(0x80))).toBe(new TextDecoder().decode(Uint8Array.of(0x81)));
    expect(c.list("paragraph")[0]!.value.sourceSha256).not.toBe(a.list("paragraph")[0]!.value.sourceSha256);
  });
  it("validates owners, ranges, ordinal and logical cell coordinates without fallback", async () => {
    const doc = await openDocumentLocations(await fixture(), context);
    const p = doc.at("paragraph", 1);
    const range = doc.range(p.token, 7, 15);
    expect(range.value.range).toEqual({ start: 7, end: 15 });
    expect(() => doc.range(p.token, 0, 16)).toThrowError(expect.objectContaining({ code: "missing-selection" }));
    for (const patch of [{ story: main + "#other" }, { path: [0, 99] }, { range: { start: 0, end: 999 } }])
      expect(() => doc.resolve(encodeLocation({ ...p.value, ...patch }))).toThrowError(expect.objectContaining({ code: "stale-selection" }));
    expect(() => doc.at("paragraph", 99)).toThrowError(expect.objectContaining({ code: "missing-selection" }));
    expect(() => doc.at("paragraph", 0)).toThrowError(expect.objectContaining({ code: "usage" }));
    const table = doc.at("table", 1);
    expect(doc.cell(table.token, "B1").token).toBe(doc.cell(table.token, "A1").token);
    expect(() => doc.cell(table.token, "C1")).toThrowError(expect.objectContaining({ code: "missing-selection" }));
    expect(() => doc.cell(table.token, "b1")).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(doc.at("paragraph", 1, { owner: doc.cell(table.token, "A1").token }).positions.paragraph).toBe(1);
  });
  it("requires explicit text cardinality and never suppresses ambiguous or stale selections", async () => {
    const doc = await openDocumentLocations(await fixture(), context);
    const p = doc.at("paragraph", 1);
    const matches = [doc.range(p.token, 0, 6), doc.range(p.token, 9, 15)];
    expect(() => doc.select(matches, {}, "text")).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(doc.select(matches, { occurrence: 2 }, "text")).toEqual([matches[1]]);
    expect(doc.select(matches, { all: true }, "text")).toEqual(matches);
    expect(() => doc.select(matches, { first: true, all: true }, "text")).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(() => doc.select(matches, { allowEmpty: true }, "mutation")).toThrowError(expect.objectContaining({ code: "ambiguous-selection", candidates: matches.map(x => x.token) }));
    expect(doc.select([], { all: true, allowEmpty: true }, "mutation")).toEqual([]);
    expect(() => doc.select([], { all: true }, "mutation")).toThrowError(expect.objectContaining({ code: "missing-selection" }));
    expect(() => doc.select(matches, { occurrence: 9, allowEmpty: true }, "text")).toThrowError(expect.objectContaining({ code: "missing-selection" }));
  });
  it("preflights every selected token before staging and commits one generation with updated locations and counts", async () => {
    const doc = await openDocumentLocations(await fixture(), context);
    const targets = doc.list("paragraph").slice(0, 2);
    const edit = vi.fn((editor: Parameters<Parameters<typeof doc.mutate>[2]>[0]) => {
      const body = editor.xml(main.slice(1)).root.children[0]!;
      for (const p of body.children.slice(0, 2)) editor.xml(main.slice(1)).setText(p.children[0]!.children[0]!.content[0]!, "Safe harbor");
      return targets.map(before => ({ before: before.token, after: before.value }));
    });
    const stale = { ...targets[1]!, token: encodeLocation({ ...targets[1]!.value, generation: 99 }) };
    expect(() => doc.mutate([targets[0]!, stale], { all: true }, edit)).toThrowError(expect.objectContaining({ code: "stale-selection" }));
    expect(edit).not.toHaveBeenCalled();
    const result = doc.mutate(targets, { all: true }, edit);
    expect(result.affected).toBe(2);
    expect(result.locations).toHaveLength(2);
    expect(result.locations.every(x => x.value.generation === 1)).toBe(true);
    expect(() => doc.resolve(targets[0]!.token)).toThrowError(expect.objectContaining({ code: "stale-selection" }));
    expect(doc.resolve(result.locations[0]!.token)).toEqual(result.locations[0]);
    const noOp = doc.mutate(result.locations, { all: true }, () => []);
    expect(noOp).toMatchObject({ affected: 0, locations: [] });
    expect(doc.generation).toBe(1);
  });
  it("rolls back failed staging and invalid update receipts", async () => {
    const doc = await openDocumentLocations(await fixture(), context);
    const target = doc.at("paragraph", 1);
    expect(() => doc.mutate([target], {}, editor => {
      editor.xml(main.slice(1)).setText(editor.xml(main.slice(1)).root.children[0]!.children[0]!.children[0]!.children[0]!.content[0]!, "Changed");
      return [{ before: target.token, after: { ...target.value, path: [999] } }];
    })).toThrowError(expect.objectContaining({ code: "stale-selection" }));
    expect(doc.generation).toBe(0);
    expect(doc.resolve(target.token)).toEqual(target);
  });
});


describe("location safety boundaries", () => {
  it("does not collapse fields or tracked content into an apparently valid plain range", async () => {
    const bytes = await fixture("w", false, 0x80, files => {
      files.set(main.slice(1), String(files.get(main.slice(1))).replace("<w:t>Harbor 🌊 Harbor</w:t>", '<w:t>North</w:t><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>4</w:t><w:fldChar w:fldCharType="end"/><w:t>South</w:t>'));
    });
    const doc = await openDocumentLocations(bytes, context);
    expect(() => doc.range(doc.at("paragraph", 1).token, 0, 11)).toThrowError(expect.objectContaining({ code: "missing-selection" }));
    expect(() => doc.range(doc.at("paragraph", 1).token, 6, 10)).toThrowError(expect.objectContaining({ code: "missing-selection" }));
  });
  it("requires a paragraph owner for run ordinals and refuses unrelated owner chains", async () => {
    const doc = await openDocumentLocations(await fixture(), context);
    expect(() => doc.at("run", 1)).toThrowError(expect.objectContaining({ code: "usage" }));
    const p = doc.at("paragraph", 1);
    expect(doc.at("run", 1, { owner: p.token }).kind).toBe("run");
    expect(() => doc.list("run", { owner: doc.at("table", 1).token })).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(() => doc.list("paragraph", { owner: p.token, scope: "body" })).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(() => doc.select([], { occurrence: 2, allowEmpty: true }, "text")).toThrowError(expect.objectContaining({ code: "missing-selection" }));
  });
  it("rejects shared-story mutation without explicit shared intent before calling the stage", async () => {
    const doc = await openDocumentLocations(await fixture(), context);
    const target = doc.at("paragraph", 1, { scope: "headers" });
    const stage = vi.fn(() => []);
    expect(() => doc.mutate([target], {}, stage)).toThrowError(expect.objectContaining({ code: "ambiguous-selection" }));
    expect(stage).not.toHaveBeenCalled();
    expect(doc.references(target.token).map(x => [x.section, x.variant])).toEqual([[1, "default"], [2, "default"]]);
    const result = doc.mutate([target], { shared: true }, editor => {
      const xml = editor.xml("reports/header.xml");
      xml.setText(xml.root.children[0]!.children[0]!.children[0]!.content[0]!, "Shared header");
      return [{ before: target.token, after: target.value }];
    });
    expect(result.affected).toBe(1);
    expect(doc.references(result.locations[0]!.token)).toHaveLength(2);
  });
  it("deduplicates identical target receipts but keeps distinct repeated-text ranges", async () => {
    const doc = await openDocumentLocations(await fixture(), context);
    const p = doc.at("paragraph", 1);
    expect(doc.select([p, p], { all: true }, "mutation")).toHaveLength(1);
    const matches = [doc.range(p.token, 0, 6), doc.range(p.token, 9, 15)];
    expect(doc.select(matches, { all: true }, "text")).toHaveLength(2);
    const stage = vi.fn(() => []);
    expect(() => doc.mutate([p], { all: "true" } as never, stage)).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(stage).not.toHaveBeenCalled();
  });
  it("owns input before async admission and output snapshots after mutation", async () => {
    const bytes = await fixture();
    const expected = createHash("sha256").update(bytes).digest("hex");
    const pending = openDocumentLocations(bytes, context);
    bytes.fill(0);
    const doc = await pending;
    const target = doc.at("paragraph", 1);
    expect(target.value.sourceSha256).toBe(expected);
    const snapshot = doc.snapshot();
    snapshot.members.find(m => m.name === main.slice(1))!.bytes.fill(0);
    expect(doc.resolve(target.token)).toEqual(target);
    expect(new TextDecoder().decode(doc.snapshot().members.find(m => m.name === main.slice(1))!.bytes)).toContain("Harbor");
  });
  it("bounds index results and checks cancellation", async () => {
    const bytes = await fixture();
    const doc = await openDocumentLocations(bytes, { ...context, budget: new DocumentBudget({ matches: 1 }) });
    expect(() => doc.list("paragraph")).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
    const abort = new AbortController();
    const cancellable = await openDocumentLocations(bytes, { ...context, signal: abort.signal });
    abort.abort();
    expect(() => cancellable.list("paragraph")).toThrowError(expect.objectContaining({ code: "cancelled" }));
  });
});

describe("location data and traversal", () => {
  it("rejects inherited payload fields, sparse paths and accessors without executing them", () => {
    const access = vi.fn(() => 0);
    const path = [0];
    Object.defineProperty(path, "0", { get: access });
    for (const bad of [Object.create(payload), { ...payload, path }, { ...payload, path: new Array(1) },
      { ...payload, range: Object.create({ start: 0, end: 1 }) }])
      expect(() => encodeLocation(bad as LocationPayload)).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(access).not.toHaveBeenCalled();
  });
  it("indexes annotations, note stories and text boxes by their actual owners and raw paths", async () => {
    const bytes = await fixture("w", false, 0x80, files => {
      const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
      files.set(main.slice(1), String(files.get(main.slice(1))).replace('<w:t>Harbor 🌊 Harbor</w:t>', '<w:t>Harbor 🌊 Harbor</w:t><w:footnoteReference w:id="2"/><w:footnoteReference w:id="8"/>')
        .replace('</w:body>', `<w:p><w:r><w:txbxContent>${p("Box note")}</w:txbxContent></w:r></w:p></w:body>`));
      files.set("[Content_Types].xml", String(files.get("[Content_Types].xml")).replace("</Types>", '<Override PartName="/reports/notes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/reports/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>'));
      files.set("reports/_rels/main.xml.rels", String(files.get("reports/_rels/main.xml.rels")).replace("</Relationships>", `<Relationship Id="notes" Type="${r}/footnotes" Target="notes.xml"/><Relationship Id="comments" Type="${r}/comments" Target="comments.xml"/></Relationships>`));
      files.set("reports/notes.xml", `<w:footnotes xmlns:w="${w}"><w:footnote w:id="8">${p("Later note")}</w:footnote><w:footnote w:id="0" w:type="separator">${p("Separator")}</w:footnote><w:footnote w:id="2">${p("Earlier note")}</w:footnote></w:footnotes>`);
      files.set("reports/comments.xml", `<w:comments xmlns:w="${w}"><w:comment w:id="3" w:author="">${p("Review note")}</w:comment></w:comments>`);
    });
    const doc = await openDocumentLocations(bytes, context);
    expect(doc.list("story", { scope: "footnotes" }).map(x => [x.value.story, x.value.path])).toEqual([
      ["/reports/notes.xml#footnote:2", [2]], ["/reports/notes.xml#footnote:8", [0]]
    ]);
    expect(doc.list("paragraph", { scope: "text-boxes" })).toHaveLength(1);
    const annotation = doc.at("annotation", 1, { scope: "comments" });
    expect(annotation.value.story).toBe("/reports/comments.xml#comment:3");
    expect(doc.resolve(annotation.token, "annotation")).toEqual(annotation);
    const scopes = doc.list("story", { scope: "all-stories" }).map(x => x.value.story);
    expect(scopes.slice(0, 5)).toEqual([main + "#body", "/reports/header.xml#header", "/reports/notes.xml#footnote:2", "/reports/notes.xml#footnote:8", "/reports/comments.xml#comment:3"]);
    expect(doc.list("paragraph")).toHaveLength(5);
  });
  it("uses active compatibility branches while retaining raw element-child coordinates", async () => {
    const bytes = await fixture("w", false, 0x80, files => {
      files.set(main.slice(1), String(files.get(main.slice(1))).replace('<w:p><w:r><w:t>Harbor 🌊 Harbor</w:t></w:r></w:p>',
        '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:future"><mc:Choice Requires="x"><w:p><w:r><w:t>Inactive</w:t></w:r></w:p></mc:Choice><mc:Fallback><!--retain--><w:p><w:r><w:t>Active</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>'));
    });
    const doc = await openDocumentLocations(bytes, context);
    const p = doc.at("paragraph", 1);
    expect(p.value.path).toEqual([0, 0, 1, 0]);
    expect(() => doc.resolve(encodeLocation({ ...p.value, path: [0, 0, 0, 0] }))).toThrowError(expect.objectContaining({ code: "stale-selection" }));
  });
  it("resolves vertical spans to anchors and does not manufacture omitted cells", async () => {
    const bytes = await fixture("w", false, 0x80, files => {
      files.set(main.slice(1), String(files.get(main.slice(1))).replace('<w:gridSpan w:val="2"/>', '<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>')
        .replace('</w:tbl>', '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>'));
    });
    const doc = await openDocumentLocations(bytes, context);
    const table = doc.at("table", 1);
    expect(doc.cell(table.token, "B2").token).toBe(doc.cell(table.token, "A1").token);
    expect(() => doc.cell(table.token, "A3")).toThrowError(expect.objectContaining({ code: "missing-selection" }));
    expect(doc.cell(table.token, "B3").positions.cell).toBe("B3");
  });
  it("does not report a surviving object as deleted", async () => {
    const doc = await openDocumentLocations(await fixture(), context);
    const target = doc.at("paragraph", 1);
    expect(() => doc.mutate([target], {}, editor => {
      const xml = editor.xml(main.slice(1));
      xml.setText(xml.root.children[0]!.children[0]!.children[0]!.children[0]!.content[0]!, "Updated harbor");
      return [{ before: target.token, after: null }];
    })).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(doc.generation).toBe(0);
  });
});

describe("scoped location updates", () => {
  it("rejects inherited selection switches before staging", async () => {
    const doc = await openDocumentLocations(await fixture(), context);
    const stage = vi.fn(() => []);
    expect(() => doc.mutate(doc.list("paragraph"), Object.create({ all: true }), stage)).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(stage).not.toHaveBeenCalled();
  });
  it("orders nested text-box stories recursively and guards their shared part", async () => {
    const bytes = await fixture("w", false, 0x80, files => {
      files.set("reports/header.xml", `<w:hdr xmlns:w="${w}"><w:p><w:r><w:txbxContent><w:p><w:r><w:txbxContent><w:p/></w:txbxContent></w:r></w:p></w:txbxContent><w:txbxContent><w:p/></w:txbxContent></w:r></w:p></w:hdr>`);
    });
    const doc = await openDocumentLocations(bytes, context);
    const boxes = doc.list("story", { scope: "text-boxes" });
    expect(boxes.map(x => x.value.path)).toEqual([[0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 1]]);
    const target = doc.at("paragraph", 1, { owner: boxes[0]!.token });
    const stage = vi.fn(() => []);
    expect(() => doc.mutate([target], {}, stage)).toThrowError(expect.objectContaining({ code: "ambiguous-selection" }));
    expect(stage).not.toHaveBeenCalled();
  });
  it("returns resized match ranges and leaves earlier generations stale", async () => {
    const doc = await openDocumentLocations(await fixture(), context);
    const p = doc.at("paragraph", 1);
    const matches = [doc.range(p.token, 0, 6), doc.range(p.token, 9, 15)];
    const result = doc.mutate(matches, { all: true }, editor => {
      const xml = editor.xml(main.slice(1));
      xml.setText(xml.root.children[0]!.children[0]!.children[0]!.children[0]!.content[0]!, "Bay 🌊 Bay");
      return matches.map((before, i) => ({ before: before.token, after: { ...before.value, range: { start: i * 6, end: i * 6 + 3 } } }));
    });
    expect(result.affected).toBe(2);
    expect(result.locations.map(x => x.value.range)).toEqual([{ start: 0, end: 3 }, { start: 6, end: 9 }]);
    expect(result.locations.map(x => doc.resolve(x.token))).toEqual(result.locations);
    expect(() => doc.resolve(matches[1]!.token)).toThrowError(expect.objectContaining({ code: "stale-selection" }));
  });
  it("uses the same location contract for the strict namespace dialect", async () => {
    const bytes = await fixture("q", false, 0x80, files => {
      for (const [name, data] of files) if (typeof data === "string") files.set(name, data
        .split(w).join("http://purl.oclc.org/ooxml/wordprocessingml/main")
        .split(r).join("http://purl.oclc.org/ooxml/officeDocument/relationships")
        .split("http://schemas.openxmlformats.org/drawingml/2006/main").join("http://purl.oclc.org/ooxml/drawingml/main"));
    });
    const doc = await openDocumentLocations(bytes, context);
    expect(doc.at("paragraph", 1).value.path).toEqual([0, 0]);
    expect(doc.list("image")).toHaveLength(1);
    expect(doc.at("story", 1, { scope: "headers" }).value.story).toBe("/reports/header.xml#header");
  });
});

it("records a removed text range only as a before-location while its paragraph survives", async () => {
  const doc = await openDocumentLocations(await fixture(), context);
  const p = doc.at("paragraph", 1);
  const range = doc.range(p.token, 0, 15);
  const result = doc.mutate([range], { first: true }, editor => {
    const xml = editor.xml(main.slice(1));
    xml.setText(xml.root.children[0]!.children[0]!.children[0]!.children[0]!.content[0]!, "");
    return [{ before: range.token, after: null }];
  });
  expect(result).toMatchObject({ affected: 1, locations: [], changes: [{ before: range, after: null }] });
  expect(doc.at("paragraph", 1).value.generation).toBe(1);
  expect(() => doc.resolve(range.token)).toThrowError(expect.objectContaining({ code: "stale-selection" }));
});
