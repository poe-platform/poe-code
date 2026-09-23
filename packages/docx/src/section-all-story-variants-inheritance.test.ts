import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const variants = ["default", "first", "even"] as const;
const storyProperties = ["header", "first_page_header", "even_page_header", "footer", "first_page_footer", "even_page_footer"] as const;
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const route of ["model", "sdk", "cli"] as const)
it(`${route} adds a section inheriting all six distinct native story variants; strict=${strict}; kind=${kind}`, async () => {
  const stories = Object.fromEntries((["header", "footer"] as const).flatMap(type => variants.map(variant => [type + "-" + variant, {
    kind: type,
    xml: `<w:${type === "header" ? "hdr" : "ftr"} xmlns:w="${w}"><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>${type} ${variant} é 日本 עברית 🌊</w:t></w:r></w:p><!--story-retain--><?policy keep?></w:${type === "header" ? "hdr" : "ftr"}>`
  }])));
  const bindings = (["header", "footer"] as const).flatMap(type => variants.map(variant => `<w:${type}Reference w:type="${variant}" r:id="${type}-${variant}"/>`)).join("");
  const original = await textFixture(`<w:p><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p><!--body-retain--><?policy keep?><w:sectPr>${bindings}<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:left="1440" w:right="1440"/></w:sectPr>`, stories, strict);
  const parts = readPackage(original), memory = Volume.fromJSON({ "/input": "", "/out": "" });
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  const operations: api.DocxBatchOperation[] = [{ operation: "model.document.Document.add_section.call", receiver: ref("document"), arguments: {}, resultHandle: "added" }];
  for (const property of storyProperties) {
    operations.push({ operation: `model.section.Section.${property}.get`, receiver: ref("added"), arguments: {}, resultHandle: property });
    operations.push({ operation: `model.section.${property.includes("header") ? "_Header" : "_Footer"}.is_linked_to_previous.get`, receiver: ref(property), arguments: {} });
  }
  if (route === "model") {
    const document = await api.Document(input, textContext), added = document.add_section();
    expect(document.sections.length).toBe(2);
    for (const property of storyProperties) expect(added[property].is_linked_to_previous).toBe(true);
    await document.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    for (let i = 2; i < result.results.length; i += 2) expect(result.results[i]!.value).toBe(true);
    await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /out --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const outcomes = JSON.parse(result.stdout).data.results;
      for (let i = 2; i < outcomes.length; i += 2) expect(outcomes[i].data).toBe(true);
      memory.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
  expect(saved.size).toBe(parts.size);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  const fresh = await api.Document(output, textContext); expect(fresh.sections.length).toBe(2);
  for (const property of storyProperties) {
    const type = property.includes("header") ? "header" : "footer", variant = property.startsWith("first_") ? "first" : property.startsWith("even_") ? "even" : "default";
    expect(fresh.sections.at(0)[property].is_linked_to_previous).toBe(false);
    expect(fresh.sections.at(1)[property].is_linked_to_previous).toBe(true);
    expect(fresh.sections.at(1)[property].paragraphs[0]!.text).toBe(`${type} ${variant} é 日本 עברית 🌊`);
    expect(fresh.sections.at(1)[property].paragraphs[0]!.runs[0]!.italic).toBe(true);
  }
  expect(new TextDecoder().decode(saved.get("word/document.xml"))).toContain("<!--body-retain--><?policy keep?>");
  expect(fresh.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊"); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});

for (const strict of [false, true]) for (const variant of ["duplicate", "opaque"] as const) for (const route of ["model", "sdk", "cli"] as const)
it(`${route} refuses ${variant} selected section story bindings without mutation or publication; strict=${strict}`, async () => {
  const binding = `<w:headerReference w:type="default" r:id="header"${variant === "opaque" ? ' f:identity="selected"' : ""}/>`;
  const input = await textFixture(`<w:p><w:r><w:t>Original 日本 עברית 🌊</w:t></w:r></w:p><w:sectPr xmlns:f="urn:original:section-inheritance" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f">${binding}${variant === "duplicate" ? binding : ""}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`, { header: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p/></w:hdr>` } }, strict);
  const operations = [{ operation: "model.document.Document.add_section.call", receiver: ref("document"), arguments: {} }];
  if (route === "model") {
    const document = await api.Document(input, textContext), original = document.element.serialize();
    expect(() => document.add_section()).toThrow(api.UnsupportedEditError);
    expect(document.element.serialize()).toEqual(original); expect(document.sections.length).toBe(1);
  } else if (route === "sdk") {
    const memory = Volume.fromJSON({ "/out": "retained destination" });
    await expect(api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(memory.readFileSync("/out", "utf8")).toBe("retained destination");
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/out", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /out --force --json");
      expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/out")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
});
