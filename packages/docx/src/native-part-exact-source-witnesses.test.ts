import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { nativePartSourceCases, nativePartSourceParts } from "../tests/fixtures/native-part-exact-source.js";
import { readPackage, assertPackageLinks, xmlStructure } from "../tests/assertions.js";

const ref = (resultHandle: string) => ({ resultHandle });
const context = { ...textContext, limits: { ...textContext.limits, maxMembers: 128 } };
const owners = { header: api.HeaderPart, footer: api.FooterPart, comments: api.CommentsPart, settings: api.SettingsPart, styles: api.StylesPart };

for (const strict of [false, true]) for (const kind of ["document", "template"] as const)
for (const c of nativePartSourceCases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact native part witness R${c.row}; ${kind}; strict=${strict}`, async () => {
  const f = nativePartSourceParts(c, strict, kind), volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...f.parts].map(([name, bytes]) =>
    ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
  { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  const prefix = `model.parts.${c.kind === "header" || c.kind === "footer" ? "hdrftr" : c.kind}.${c.kind[0]!.toUpperCase() + c.kind.slice(1)}Part`;
  const loading = c.action === "load" || c.action === "view";
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: `${prefix}.${loading ? "load" : c.action}.call`, arguments: { ownerPackage: ref("package"),
      ...(loading ? { partname: f.partname, contentType: f.type, blob: { kind: "bytes", base64: Buffer.from(f.blob).toString("base64") } } : {}) }, resultHandle: "part" },
    { operation: `${prefix}.partname.get`, receiver: ref("part"), arguments: {} },
    { operation: `${prefix}.content_type.get`, receiver: ref("part"), arguments: {} },
    ...(c.action === "view" ? [
      { operation: `${prefix}.${c.kind}.get`, receiver: ref("part"), arguments: {}, resultHandle: "view" },
      { operation: c.kind === "settings" ? "model.settings.Settings.odd_and_even_pages_header_footer.get" : c.kind === "comments" ? "model.comments.Comments.__len__.get" : "model.styles.styles.Styles.__len__.get", receiver: ref("view"), arguments: {} }
    ] : [])
  ];
  const observe = (values: unknown[]) => {
    expect(values[2]).toMatchObject({ type: c.kind[0]!.toUpperCase() + c.kind.slice(1) + "Part" });
    expect(values[3]).toBe(f.partname); expect(values[4]).toBe(f.type);
    if (c.action === "view") expect(values.at(-1)).toBe(c.kind === "settings" ? false : 0);
  };
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, context), owner = owners[c.kind];
    const pending = loading ? owner.load(f.partname, f.type, f.blob, doc.part.package) : undefined;
    if (pending) expect(pending).toBeInstanceOf(Promise);
    const part = pending ? await pending : c.kind === "header" ? api.HeaderPart.new(doc.part.package) :
      c.kind === "footer" ? api.FooterPart.new(doc.part.package) : c.kind === "settings" ?
        api.SettingsPart.default(doc.part.package) : c.kind === "comments" ? api.CommentsPart.default(doc.part.package) : api.StylesPart.default(doc.part.package);
    expect(part).toBeInstanceOf(owner); expect(part.package).toBe(doc.part.package);
    expect(String(part.partname)).toBe(f.partname); expect(part.content_type).toBe(f.type);
    expect(doc.part.package.parts).not.toContain(part); expect(doc.part.related_parts.size).toBe(c.reserved + 1);
    if (c.action === "view" && part instanceof api.SettingsPart) {
      expect(part.settings.equals(part.settings)).toBe(true); expect(part.settings.part).toBe(part);
      expect(part.settings.element.serialize()).toEqual(part.element.serialize());
      expect(part.settings.odd_and_even_pages_header_footer).toBe(false);
    }
    if (c.action === "view" && part instanceof api.StylesPart) {
      expect(part.styles.part).toBe(part); expect(part.styles.element.serialize()).toEqual(part.element.serialize());
      expect(part.styles.length).toBe(0);
    }
    if (c.action === "view" && part instanceof api.CommentsPart) {
      expect(part.comments).toBe(part.comments); expect(part.comments.length).toBe(0);
      expect([...part.comments]).toEqual([]); expect(part.comments.get(0)).toBeNull();
    }
    await doc.save(sink);
  } else if (route === "sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context);
    observe(batch.results.map(result => result.value)); await batch.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --force --json`);
      expect(r.exitCode, r.stdout + r.stderr).toBe(0);
      observe(JSON.parse(r.stdout).data.results.map((result: { data: unknown }) => result.data));
      volume.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const saved = readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer)); assertPackageLinks(saved);
  expect(saved.size).toBe(f.parts.size + 1);
  for (const [name, bytes] of f.parts) if (name !== "[Content_Types].xml") expect(saved.get(name), name).toEqual(bytes);
  const bytes = saved.get(f.partname.slice(1))!;
  if (loading) expect(bytes).toEqual(f.blob);
  const root = xmlStructure(bytes).children.find(child => typeof child !== "string")!;
  expect(typeof root).not.toBe("string"); if (typeof root === "string") throw new Error("Missing root");
  expect(root.name).toBe(`{${f.w}}${c.root}`);
  if (!loading) {
    expect(root.children.filter(child => typeof child !== "string")).toHaveLength(c.kind === "settings" || c.kind === "comments" ? 0 : c.kind === "styles" ? 5 : 1);
    if (c.kind === "styles") {
      const definitions = root.children.filter(child => typeof child !== "string");
      expect(definitions.map(node => node.name)).toEqual([`{${f.w}}docDefaults`, ...Array.from({ length: 4 }, () => `{${f.w}}style`)]);
      expect(definitions.slice(1).map(node => [node.attributes[`{${f.w}}type`], node.attributes[`{${f.w}}styleId`], node.attributes[`{${f.w}}default`],
        node.children.filter(child => typeof child !== "string").map(child => [child.name, child.attributes[`{${f.w}}val`]])])).toEqual([
        ["paragraph", "Normal", "1", [[`{${f.w}}name`, "Normal"]]],
        ["character", "DefaultParagraphFont", "1", [[`{${f.w}}name`, "Default Paragraph Font"]]],
        ["table", "NormalTable", "1", [[`{${f.w}}name`, "Normal Table"]]],
        ["numbering", "NoList", "1", [[`{${f.w}}name`, "No List"]]]
      ]);
    }
    if (c.kind === "header" || c.kind === "footer") expect(root.children).toEqual([{ name: `{${f.w}}p`, attributes: {}, children: [] }]);
  }
  const reopened = await api.Document(new Uint8Array(volume.readFileSync("/out") as Buffer), context);
  expect(reopened.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊");
  expect(reopened.part.related_parts.size).toBe(c.reserved + 1);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
