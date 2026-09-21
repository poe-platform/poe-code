import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { parseDocumentXml } from "./package-xml.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const variant of ["choice", "fallback", "process", "markers", "multiple-markers"] as const) for (const route of ["model", "sdk", "cli"] as const)
it(`${route} replaces cell text while retaining native ${variant} properties and required markers; strict=${strict}; kind=${kind}`, async () => {
  const properties = '<w:tcPr><w:tcW w:type="dxa" w:w="1440"/><w:vAlign w:val="center"/></w:tcPr>';
  const inactive = '<w:tcPr f:identity="inactive"><w:tcW w:type="dxa" w:w="2880"/></w:tcPr>';
  const carrier = variant.endsWith("markers") ? properties : variant === "process" ? `<f:pass>${properties}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${variant === "choice" ? "w" : "f"}">${variant === "choice" ? properties : inactive}</mc:Choice><mc:Fallback>${variant === "fallback" ? properties : inactive}</mc:Fallback></mc:AlternateContent>`;
  const markers = variant.endsWith("markers") ? ['<w:bookmarkStart w:id="7" w:name="OriginalAnchor"/>', '<w:bookmarkEnd w:id="7"/>'] : ["", ""];
  const selected = `<w:tc xmlns:f="urn:original:cell-text" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">${carrier}<!--cell-retain--><?policy keep?><w:p><w:pPr><w:keepNext/></w:pPr>${markers[0]}<w:r><w:rPr><w:i/></w:rPr><w:t>Old é 日本 עברית 🌊</w:t></w:r>${variant === "multiple-markers" ? `<!--first-paragraph-retain--></w:p><w:p xmlns:q="${strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}"><w:pPr><w:keepNext/></w:pPr><q:r><q:rPr><q:b/></q:rPr><q:t>Later text</q:t></q:r><!--later-paragraph-retain--><?later keep?>` : ""}${markers[1]}</w:p></w:tc>`;
  const untouched = '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1440"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Untouched é 日本 עברית 🌊</w:t></w:r></w:p><!--untouched-retain--><?policy keep?></w:tc>';
  const original = await textFixture(`<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid><w:tr>${selected}${untouched}</w:tr></w:tbl><w:p><w:r><w:t>Outside 日本 עברית 🌊</w:t></w:r></w:p>`, {}, strict);
  const parts = readPackage(original), memory = Volume.fromJSON({ "/input": "", "/out": "" });
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = "Created é 日本 עברית 🌊\tLine\nNext", before = await api.Document(input, textContext);
  expect(before.tables[0]!.cell(0, 0).width!.inches).toBe(1); expect(before.tables[0]!.cell(0, 0).vertical_alignment!.name).toBe("CENTER");
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  const operations = [
    { operation: "model.document.Document.tables.get", receiver: ref("document"), arguments: {}, resultHandle: "tables" },
    { operation: "model.table.Table.cell.call", receiver: ref("tables", 0), arguments: { rowIdx: 0, colIdx: 0 }, resultHandle: "cell" },
    { operation: "model.table._Cell.text.set", receiver: ref("cell"), arguments: { value } },
    { operation: "model.table._Cell.text.get", receiver: ref("cell"), arguments: {} }
  ], sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  if (route === "model") { const document = await api.Document(input, textContext), cell = document.tables[0]!.cell(0, 0); cell.text = value; expect(cell.text).toBe(value); await document.save(sink); }
  else if (route === "sdk") { const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(result.results.at(-1)!.value).toBe(value); await result.save(sink); }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /out --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(value); memory.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved); expect((await api.validateDocument(output, textContext)).valid).toBe(true);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(saved.get("word/document.xml"));
  expect.soft(xml).toContain(carrier); expect.soft(xml).toContain("<!--cell-retain--><?policy keep?>"); expect.soft(xml).toContain(untouched);
  if (variant === "markers") { expect.soft(xml).toContain(markers[0]); expect.soft(xml).toContain(markers[1]); }
  if (variant.endsWith("markers")) {
    const root = parseDocumentXml(saved.get("word/document.xml")!, {}).root;
    const nodes = (node: typeof root): typeof root[] => [node, ...node.children.flatMap(nodes)];
    for (const localName of ["bookmarkStart", "bookmarkEnd"]) {
      const found = nodes(root).filter(node => node.namespace === root.namespace && node.localName === localName);
      expect.soft(found).toHaveLength(1);
      expect.soft(found[0]!.attributes.find(attribute => attribute.namespace === root.namespace && attribute.localName === "id")!.value).toBe("7");
      if (localName === "bookmarkStart") expect.soft(found[0]!.attributes.find(attribute => attribute.namespace === root.namespace && attribute.localName === "name")!.value).toBe("OriginalAnchor");
    }
  }
  if (variant === "multiple-markers") { expect.soft(xml).toContain("<!--first-paragraph-retain-->"); expect.soft(xml).toContain("<!--later-paragraph-retain--><?later keep?>"); }
  const fresh = await api.Document(output, textContext), cell = fresh.tables[0]!.cell(0, 0); expect(cell.text).toBe(value); expect(cell.width!.inches).toBe(1); expect(cell.vertical_alignment!.name).toBe("CENTER");
  expect(cell.paragraphs.length).toBe(1); expect(cell.paragraphs[0]!.paragraph_format.keep_with_next).toBe(null); expect(cell.paragraphs[0]!.runs[0]!.italic).toBe(null);
  expect(fresh.tables[0]!.cell(0, 1).text).toBe("Untouched é 日本 עברית 🌊"); expect(fresh.paragraphs[0]!.text).toBe("Outside 日本 עברית 🌊"); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const variant of ["rich", "opaque-block", "duplicate-properties", "opaque-format", "field", "review", "opaque-later-owner"] as const) for (const route of ["model", "sdk", "cli"] as const)
it(`${route} ${variant === "opaque-block" ? "retains inert opaque block during" : "refuses consumed " + variant + " ownership during"} cell text assignment; strict=${strict}; kind=${kind}`, async () => {
  const simple = '<w:p><w:r><w:t>Original 日本 עברית 🌊</w:t></w:r></w:p>';
  const content = variant === "rich" ? simple + '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc>' + simple + '</w:tc></w:tr></w:tbl>' + simple : variant === "opaque-block" ? simple + '<f:owned mc:PreserveElements="f:owned">Opaque</f:owned>' : variant === "opaque-format" ? '<w:p><w:r><w:rPr><f:owned/></w:rPr><w:t>Original</w:t></w:r></w:p>' : variant === "field" ? '<w:p><w:fldSimple w:instr="DATE"><w:r><w:t>Cached only</w:t></w:r></w:fldSimple></w:p>' : variant === "review" ? '<w:p><w:ins w:id="7" w:author="Archivist"><w:r><w:t>Reviewed</w:t></w:r></w:ins></w:p>' : variant === "opaque-later-owner" ? simple + '<w:p f:identity="retain">' + '<w:r><w:t>Later</w:t></w:r></w:p>' : simple;
  const input0 = await textFixture(`<w:tbl xmlns:f="urn:original:cell-refusal" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:tcPr/>${variant === "duplicate-properties" ? '<w:tcPr/>' : ''}${content}</w:tc></w:tr></w:tbl>`, {}, strict);
  const parts = readPackage(input0), volume = Volume.fromJSON({ "/input": "", "/out": "" });
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), operations = [
    { operation: "model.document.Document.tables.get", receiver: ref("document"), arguments: {}, resultHandle: "tables" },
    { operation: "model.table.Table.cell.call", receiver: ref("tables", 0), arguments: { rowIdx: 0, colIdx: 0 }, resultHandle: "cell" },
    { operation: "model.table._Cell.text.set", receiver: ref("cell"), arguments: { value: "Replacement 日本 עברית 🌊" } }
  ];
  const inert = variant === "opaque-block", rich = variant === "rich", accepted = inert || rich, expectedCode = variant === "duplicate-properties" ? "invalid-package" : "unsupported-edit";
  const assertSaved = (output: Uint8Array) => {
    const saved = readPackage(output);
    for (const [name, bytes] of parts) if (!accepted || name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
    if (accepted) {
      const xml = new TextDecoder().decode(saved.get("word/document.xml"));
      if (inert) expect(xml).toContain('<f:owned mc:PreserveElements="f:owned">Opaque</f:owned>');
      if (rich) { const root = parseDocumentXml(saved.get("word/document.xml")!, {}).root;
        const nodes = (node: typeof root): typeof root[] => [node, ...node.children.flatMap(nodes)];
        expect(nodes(root).filter(node => node.namespace === root.namespace && node.localName === "tbl")).toHaveLength(1);
        expect(nodes(root).filter(node => node.namespace === root.namespace && node.localName === "p")).toHaveLength(1);
        expect(nodes(root).filter(node => node.namespace === root.namespace && node.localName === "r")).toHaveLength(1);
      }
      expect(xml).toContain("Replacement 日本 עברית 🌊");
    }
  };
  if (route === "model") {
    const document = await api.Document(input, textContext), before = document.part.blob;
    const assign = () => { document.tables[0]!.cell(0, 0).text = "Replacement 日本 עברית 🌊"; };
    if (accepted) assign();
    else { expect(assign).toThrowError(expect.objectContaining({ code: expectedCode })); expect(document.part.blob).toEqual(before); }
    const saving = document.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
    await saving; assertSaved(new Uint8Array(volume.readFileSync("/out") as Buffer));
  } else if (route === "sdk") {
    const result = api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    if (accepted) { await (await result).save({ async write(bytes) { volume.appendFileSync("/out", bytes); } }); assertSaved(new Uint8Array(volume.readFileSync("/out") as Buffer)); }
    else { await expect(result).rejects.toMatchObject({ code: expectedCode }); expect(volume.readFileSync("/out").length).toBe(0); }
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/out", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /out --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(accepted ? 0 : 1);
      const envelope = JSON.parse(result.stdout);
      if (accepted) { expect(envelope.affected).toBe(1); assertSaved(await fs.readFile("/out")); }
      else { expect(envelope.errors[0].code).toBe(expectedCode); expect(envelope.affected).toBe(0); expect(envelope.data).toBe(null); expect(await fs.readFile("/out")).toEqual(destination); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(input);
});
