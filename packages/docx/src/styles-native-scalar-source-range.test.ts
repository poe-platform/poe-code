import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const targets = ["BaseStyle", "ParagraphStyle", "CharacterStyle", "TableStyle", "_NumberingStyle", "latent-entry", "latent-default", "latent-count"] as const;
const values = [-2147483649, -2147483648, -1, 0, 99, 100, 2147483647, 2147483648, Number.MAX_SAFE_INTEGER, null, 1.25, "1", true] as const;
for (const strict of [false, true]) for (const target of targets) for (const value of values) for (const route of ["model", "sdk", "cli"] as const)
it(`${route} preserves native integer setter bounds for ${target}: ${String(value)} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const styleType = target === "CharacterStyle" ? "character" : target === "TableStyle" ? "table" : target === "_NumberingStyle" ? "numbering" : "paragraph";
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p>', {}, strict));
  parts.set("word/styles.xml", new TextEncoder().encode(`<w:styles xmlns:w="${w}"><w:latentStyles w:defUIPriority="17" w:count="17"><w:lsdException w:name="Latent selected" w:uiPriority="17"/></w:latentStyles><w:style w:type="${styleType}" w:styleId="Selected" w:customStyle="1"><w:name w:val="Selected"/><w:aliases w:val="Retain aliases"/><w:uiPriority w:val="17"/><!--retain--><?policy keep?></w:style></w:styles>`));
  const ct = new TextDecoder().decode(parts.get("[Content_Types].xml")); parts.set("[Content_Types].xml", new TextEncoder().encode(ct.replace("</Types>", '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')));
  parts.set("word/_rels/document.xml.rels", new TextEncoder().encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="${r}/styles" Target="styles.xml"/></Relationships>`));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), valid = value === null || typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
  expect((await api.validateDocument(input, textContext)).valid).toBe(true);
  const ref = (resultHandle: string) => ({ resultHandle });
  const operations: { operation: string; receiver: { resultHandle: string }; arguments: Record<string, unknown>; resultHandle?: string }[] = [{ operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" }];
  if (target.startsWith("latent")) {
    operations.push({ operation: "model.styles.styles.Styles.latent_styles.get", receiver: ref("styles"), arguments: {}, resultHandle: "latent" });
    if (target === "latent-entry") operations.push({ operation: "model.styles.latent.LatentStyles.__getitem__.call", receiver: ref("latent"), arguments: { key: "Latent selected" }, resultHandle: "owner" });
  } else operations.push({ operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: "Selected" }, resultHandle: "owner" });
  const operation = target === "latent-entry" ? "model.styles.latent._LatentStyle.priority.set" : target === "latent-default" ? "model.styles.latent.LatentStyles.default_priority.set" : target === "latent-count" ? "model.styles.latent.LatentStyles.load_count.set" : `model.styles.style.${target === "TableStyle" ? "_TableStyle" : target}.priority.set`;
  operations.push({ operation, receiver: ref(target === "latent-default" || target === "latent-count" ? "latent" : "owner"), arguments: { value } });
  const batch = { version: 1 as const, operations };
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  let output: Uint8Array = input;
  if (route === "model") {
    const document = await api.Document(input, textContext), styles = document.styles;
    const owner = target === "latent-entry" ? styles.latent_styles.at("Latent selected") : target.startsWith("latent") ? styles.latent_styles : styles.at("Selected"), key = target === "latent-default" ? "default_priority" : target === "latent-count" ? "load_count" : "priority", before = owner.part.blob;
    const action = () => Reflect.set(owner, key, value);
    if (valid) { action(); expect(Reflect.get(owner, key)).toBe(value); }
    else { expect(action).toThrowError(expect.objectContaining({ code: "usage" })); expect(owner.part.blob).toEqual(before); expect(Reflect.get(owner, key)).toBe(17); }
    await document.save(sink); output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else if (route === "sdk") {
    if (valid) { const result = await api.applyStyleModelBatch(input, batch, textContext); await result.save(sink); output = new Uint8Array(memory.readFileSync("/output") as Buffer); }
    else { await expect(api.applyStyleModelBatch(input, batch, textContext)).rejects.toMatchObject({ code: "usage" }); expect(memory.readFileSync("/output").length).toBe(0); }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination")); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /out --force --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(valid ? 0 : 2); const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(valid);
      if (valid) { expect(envelope.errors).toEqual([]); output = await fs.readFile("/out"); }
      else { expect(envelope.errors[0].code).toBe("usage"); expect(envelope.data).toBeNull(); expect(envelope.affected).toBe(0); expect(envelope.locations).toEqual([]); expect(await fs.readFile("/out")).toEqual(new TextEncoder().encode("Original destination")); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const saved = readPackage(output); expect([...saved.keys()]).toEqual([...parts.keys()]); for (const [name, bytes] of parts) if (!valid || name !== "word/styles.xml") expect(saved.get(name)).toEqual(bytes);
  const reopened = await api.Document(output, textContext), owner = target === "latent-entry" ? reopened.styles.latent_styles.at("Latent selected") : target.startsWith("latent") ? reopened.styles.latent_styles : reopened.styles.at("Selected"), key = target === "latent-default" ? "default_priority" : target === "latent-count" ? "load_count" : "priority";
  expect(Reflect.get(owner, key)).toBe(valid ? value : 17); expect(reopened.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊"); expect((await api.validateDocument(output, textContext)).valid).toBe(true);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
