import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const layout of ["mixed", "marker-only", "separate"] as const) for (const clear of [false, true]) for (const route of ["model", "sdk", "shell", "sdk-batch", "shell-batch", "sdk-model-batch"] as const)
 it(`${route} paragraph assignment retains annotationRef through ${carrier}; layout=${layout}; clear=${clear}; strict=${strict}`, async () => {
  const inert = '<f:shadow f:id="retained-native-note"><w:t>INERT</w:t></f:shadow>';
  const wrap = (active: string) => carrier === "direct" ? active + inert : carrier === "process" ? `<f:pass>${active}${inert}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inert}</mc:Fallback></mc:AlternateContent>`;
  const marker = `<w:annotationRef/>`, run = (content: string) => `<w:r xml:lang="ar-SA"><w:rPr><w:rtl/></w:rPr>${wrap(content)}</w:r>`, runs = layout === "mixed" ? run(marker + '<w:t>c🌊st</w:t>') : layout === "marker-only" ? run(marker) : run(marker) + run('<w:t>c🌊st</w:t>'), story = { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7"><w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:note-scalar" mc:Ignorable="f" mc:ProcessContent="f:pass">${runs}</w:p></w:comment></w:comments>` }, original = await textFixture("<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>", { comments: story }, strict);
  const parts = readPackage(original);
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const fixture = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { fixture.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(fixture.readFileSync("/input") as Buffer);
  const locations = await api.openDocumentLocations(input, textContext), p = locations.at("paragraph", 1, { scope: "comments" }), select = p.token, memory = Volume.fromJSON({ "/out": "" });
  const op = "paragraphs.set" as const, args = { select, text: clear ? null : "NEW" }, batch = { version: 1 as const, operations: [{ operation: op, arguments: args }] }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  if (route === "model") {
    const doc = await api.Document(input, context); doc.comments.get(7)!.paragraphs[0]!.text = clear ? "" : "NEW";
    await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  } else if (route === "sdk-model-batch") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations: [
      { operation: "paragraphs.get", arguments: { select }, resultHandle: "owner" },
      { operation: "model.text.paragraph.Paragraph.text.set", receiver: { resultHandle: "owner" }, arguments: { value: clear ? "" : "NEW" } }
    ] }, context); await result.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  } else if (route === "sdk") await api.editDocumentParagraphs(input, { operation: op, options: { ...args, output: "-" } }, context);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, context);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(route === "shell" ? `docx paragraphs set /input --select '${select}' --text ${clear ? "''" : "NEW"} --output - > /out` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output), dirty = "word/comments.xml"; assertPackageLinks(after); for (const [name, bytes] of before) if (name !== dirty) expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get(dirty)); expect(xml.split(marker)).toHaveLength(2); const text = (await api.openDocumentLocations(output, textContext)).text({ scope: "comments" }); expect(text.text).toBe(clear ? "" : "NEW");
  const descendants = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(descendants)], root = api.parseDocumentXml(after.get(dirty)!, {}).root, nodes = descendants(root), owningRuns = nodes.filter(node => node.localName === "r" && descendants(node).some(child => child.localName === "annotationRef"));
  expect(xml.split(inert)).toHaveLength((layout === "separate" ? 2 : 1) + 1);
  expect(owningRuns).toHaveLength(1); expect(owningRuns[0]!.attributes.find(a => a.localName === "lang")?.value).toBe("ar-SA"); expect(descendants(owningRuns[0]!).filter(node => node.localName === "rtl")).toHaveLength(1);
  expect(text.segments.filter(s => s.kind === "text").every(s => s.formatting.rtl === null)).toBe(true);
 });

for (const strict of [false, true]) for (const owner of ["body", "comments"] as const)
for (const marker of owner === "body" ? ["<w:annotationRef/>"] : ["<w:annotationRef>opaque</w:annotationRef>", "<w:annotationRef><w:t>opaque</w:t></w:annotationRef>"])
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} refuses foreign or malformed paragraph annotationRef; owner=${owner}; marker=${marker}; strict=${strict}`, async () => {
  const content = `<w:p><w:r>${marker}<w:t>c🌊st</w:t></w:r></w:p>`;
  const input = await textFixture(owner === "body" ? content : "<w:p/>", owner === "comments" ? {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7">${content}</w:comment></w:comments>` }
  } : {}, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "Original destination" });
  const p = (await api.openDocumentLocations(input, textContext)).at("paragraph", 1, { scope: owner });
  const operations = [
    { operation: "paragraphs.get", arguments: { select: p.token }, resultHandle: "owner" },
    { operation: "model.text.paragraph.Paragraph.text.set", receiver: { resultHandle: "owner" }, arguments: { value: "NEW" } }
  ];
  if (route === "model") {
    const doc = await api.Document(input, textContext), paragraph = owner === "body" ? doc.paragraphs[0]! : doc.comments.get(7)!.paragraphs[0]!;
    const original = paragraph.element.serialize();
    expect(() => { paragraph.text = "NEW"; }).toThrow(expect.objectContaining({ code: "unsupported-edit" }));
    expect(paragraph.element.serialize()).toEqual(original);
  } else if (route === "sdk") await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "unsupported-edit", operationIndex: 1 });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: "unsupported-edit", operationIndex: 1 }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
    } finally { await shell.dispose(); }
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); expect(volume.readFileSync("/out", "utf8")).toBe("Original destination");
});
