import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const target of ["BaseStyle", "ParagraphStyle", "CharacterStyle", "_TableStyle", "_NumberingStyle", "entry", "default", "count"])
for (const value of [-Number.MAX_SAFE_INTEGER, -2147483649, 2147483648, Number.MAX_SAFE_INTEGER]) for (const route of ["model", "sdk", "cli"])
it(`${route} reads and preserves preexisting wide signed-safe XML for ${target}=${value}; strict=${strict}`, async () => {
 const styleType = target === "CharacterStyle" ? "character" : target === "_TableStyle" ? "table" : target === "_NumberingStyle" ? "numbering" : "paragraph";
 const input = await textFixture('<w:p><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:latentStyles w:defUIPriority="${value}" w:count="${value}"><w:lsdException w:name="Selected latent" w:uiPriority="${value}"/></w:latentStyles><w:style w:type="${styleType}" w:styleId="Selected"><w:name w:val="Selected"/><w:uiPriority w:val="${value}"/><w:aliases w:val="Retain aliases"/><!--retained--><?policy keep?></w:style></w:styles>` } }, strict);
 const original = readPackage(input), memory = Volume.fromJSON({ "/output": "" }), ref = (resultHandle: string) => ({ resultHandle });
 const member = target === "default" ? "default_priority" : target === "count" ? "load_count" : "priority";
 const operations: { operation: string; receiver: { resultHandle: string }; arguments: Record<string, unknown>; resultHandle?: string }[] = [{ operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" }];
 if (["entry", "default", "count"].includes(target)) { operations.push({ operation: "model.styles.styles.Styles.latent_styles.get", receiver: ref("styles"), arguments: {}, resultHandle: target === "entry" ? "latent" : "owner" }); if (target === "entry") operations.push({ operation: "model.styles.latent.LatentStyles.__getitem__.call", receiver: ref("latent"), arguments: { key: "Selected latent" }, resultHandle: "owner" }); }
 else operations.push({ operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: "Selected" }, resultHandle: "owner" });
 const ownerType = target === "entry" ? "latent._LatentStyle" : ["default", "count"].includes(target) ? "latent.LatentStyles" : "style." + target;
 operations.push({ operation: `model.styles.${ownerType}.${member}.get`, receiver: ref("owner"), arguments: {} });
 const batch = { version: 1, operations }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
 let output: Uint8Array = input;
 if (route === "model") {
  const document = await api.Document(input, textContext), owner = target === "entry" ? document.styles.latent_styles.at("Selected latent") : ["default", "count"].includes(target) ? document.styles.latent_styles : document.styles.at("Selected"), before = owner.part.blob;
  expect(Reflect.get(owner, member)).toBe(value); expect(() => Reflect.set(owner, member, value)).toThrow(api.InvalidValueError); expect(owner.part.blob).toEqual(before);
  await document.save(sink); output = new Uint8Array(memory.readFileSync("/output") as Buffer);
 } else if (route === "sdk") {
  const result = await api.applyStyleModelBatch(input, batch, textContext); expect(result.results.at(-1)!.value).toBe(value); expect(result.affected).toBe(0); await result.save(sink); output = new Uint8Array(memory.readFileSync("/output") as Buffer);
 } else {
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify(batch)));
  const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try { const result = await shell.exec("docx batch /input --ops-file /ops --output /out --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(true); expect(envelope.affected).toBe(0); expect(envelope.data.results.at(-1).data).toBe(value); output = await fs.readFile("/out"); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
 }
 expect(readPackage(output)).toEqual(original);
 const document = await api.Document(output, textContext); expect(document.styles.at("Selected").priority).toBe(value); expect(document.styles.latent_styles.default_priority).toBe(value); expect(document.styles.latent_styles.load_count).toBe(value); expect(document.styles.latent_styles.at("Selected latent").priority).toBe(value);
 document.paragraphs[0]!.runs[0]!.bold = true; memory.writeFileSync("/output", ""); await document.save(sink);
 const edited = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)); expect([...edited.keys()]).toEqual([...original.keys()]); for (const [name, bytes] of original) if (name !== "word/document.xml") expect(edited.get(name)).toEqual(bytes);
 expect((await api.validateDocument(input, textContext)).valid).toBe(true); expect(document.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊");
});
