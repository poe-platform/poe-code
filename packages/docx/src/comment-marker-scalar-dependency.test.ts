import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const operation of ["format", "caret", "bookmark", "replace"] as const)
for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
it(`${route} ${operation} treats annotationRef as zero comment scalar through ${carrier}; ${kind}; strict=${strict}`, async () => {
  const wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` :
    `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const marker = "<w:annotationRef/>", before = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7" w:author="Original"><w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:comment-scalar" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r><w:rPr><w:rtl/></w:rPr>${wrap(marker + '<w:t>c🌊st</w:t>')}</w:r><!--paragraph retained--><?policy keep?></w:p></w:comment></w:comments>` }
  }, strict));
  if (kind === "dotx") before.set("[Content_Types].xml", new TextEncoder().encode(
    new TextDecoder().decode(before.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...before].map(([name, bytes]) =>
    ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
  { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), locations = await api.openDocumentLocations(input, textContext);
  expect(locations.text({ scope: "comments" }).text).toBe("c🌊st");
  expect((await api.Document(input, textContext)).comments.get(7)!.text).toBe("c🌊st");
  const paragraph = locations.at("paragraph", 1, { scope: "comments" });
  const select = operation === "replace" ? paragraph.token : locations.range(paragraph.token,
    operation === "caret" ? 2 : 1, operation === "caret" ? 2 : 3).token;
  const op = operation === "format" ? "runs.set" : operation === "caret" ? "paragraphs.add" :
    operation === "bookmark" ? "bookmarks.add" : "text.replace";
  const args = operation === "format" ? { select, bold: true } : operation === "caret" ? { select, text: "NEW" } :
    operation === "bookmark" ? { select, name: "OriginalRange" } : { select, find: "🌊s", with: "日本", all: true };
  const batch = { version: 1 as const, operations: [{ operation: op, arguments: args }] };
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const },
    stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
  if (route === "sdk") {
    if (operation === "format") await api.formatDocumentRuns(input, { select, bold: true, output: "-" }, context);
    else if (operation === "caret") await api.editDocumentParagraphs(input, { operation: "paragraphs.add", options: { select, text: "NEW", output: "-" } }, context);
    else if (operation === "bookmark") await api.editDocumentBookmarks(input, { operation: "bookmarks.add", options: { select, name: "OriginalRange", output: "-" } }, context);
    else await api.replaceDocumentText(input, { select, find: "🌊s", with: "日本", all: true, output: "-" }, context);
  } else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, context);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const flags = operation === "format" ? "--bold true" : operation === "caret" ? "--text NEW" :
        operation === "bookmark" ? "--name OriginalRange" : "--find '🌊s' --with '日本' --all";
      const r = await shell.exec(route === "shell" ? `docx ${op.split(".").join(" ")} /input --select '${select}' ${flags} --output - > /out` :
        `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`);
      expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input);
      volume.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
  for (const [name, bytes] of before) if (name !== "word/comments.xml") expect(saved.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(saved.get("word/comments.xml")); expect(xml.split(marker)).toHaveLength(2);
  expect(xml).toContain("<!--paragraph retained-->"); expect(xml).toContain("<?policy keep?>");
  const result = (await api.openDocumentLocations(output, textContext)).text({ scope: "comments" });
  expect(result.text).toBe(operation === "caret" ? "c🌊\nNEW\nst" : operation === "replace" ? "c日本t" : "c🌊st");
  if (operation === "format") expect(result.segments.find(segment => segment.text === "🌊s")!.formatting.bold).toBe(true);
  if (operation === "bookmark") expect(xml).toContain("OriginalRange");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const owner of ["body", "comments"] as const)
for (const marker of owner === "body" ? ["<w:annotationRef/>", "<w:annotationRef>opaque</w:annotationRef>", "<w:annotationRef><w:t>opaque</w:t></w:annotationRef>"] : ["<w:annotationRef>opaque</w:annotationRef>", "<w:annotationRef><w:t>opaque</w:t></w:annotationRef>"])
it(`annotationRef range refuses malformed or foreign marker; ${owner}; ${marker}; strict=${strict}`, async () => {
  const paragraph = `<w:p><w:r>${marker}<w:t>c🌊st</w:t></w:r></w:p>`;
  const input = await textFixture(owner === "body" ? paragraph : "<w:p/>", owner === "comments" ? {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7">${paragraph}</w:comment></w:comments>` }
  } : {}, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "Original destination" });
  const locations = await api.openDocumentLocations(new Uint8Array(volume.readFileSync("/input") as Buffer), textContext);
  const p = locations.at("paragraph", 1, { scope: owner });
  expect(() => locations.range(p.token, 1, 3)).toThrow();
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  expect(volume.readFileSync("/out", "utf8")).toBe("Original destination");
});
