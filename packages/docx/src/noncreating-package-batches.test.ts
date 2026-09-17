import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, PackageView, Inches, Image, applyStyleModelBatch, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { textContext, textFixture, paragraph, w } from "../tests/fixtures/text.js";
import { replacementPng } from "../tests/fixtures/image-replacement.js";
import { readPackage } from "../tests/assertions.js";
const encode = (text: string) => new TextEncoder().encode(text);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const existingStyles of [false, true]) for (const operation of ["package-open", "values", "image", "empty"] as const) for (const route of ["model", "sdk", "shell"] as const) it(`${route} ${operation} does not create styles; ${kind} strict=${strict} existingStyles=${existingStyles}`, async () => {
  const parts = readPackage(await textFixture(paragraph("Original report"), existingStyles ? { styles: { kind: "styles", xml: '<w:styles xmlns:w="' + w + '"><w:style w:type="paragraph" w:styleId="Original"><w:name w:val="Original"/></w:style></w:styles>' } } : {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), png = replacementPng(12), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = operation === "package-open" ? [
    { operation: "model.opc.package.OpcPackage.open.call", arguments: { pkgFile: { kind: "bytes", base64: Buffer.from(input).toString("base64") } }, resultHandle: "package" },
    { operation: "model.opc.package.OpcPackage.parts.get", receiver: { resultHandle: "package" }, arguments: {} }
  ] : operation === "values" ? [
    { operation: "model.shared.Inches.call", arguments: { inches: 2 }, resultHandle: "length" },
    { operation: "model.shared.Inches.emu.get", receiver: { resultHandle: "length" }, arguments: {} },
    { operation: "model.enum.style.WD_STYLE_TYPE.PARAGRAPH.get", arguments: {}, resultHandle: "kind" },
    { operation: "model.enum.style.WD_STYLE_TYPE.value.get", receiver: { resultHandle: "kind" }, arguments: {} }
  ] : operation === "image" ? [
    { operation: "model.image.image.Image.from_blob.call", arguments: { blob: { kind: "bytes", base64: Buffer.from(png).toString("base64") } }, resultHandle: "image" },
    { operation: "model.image.image.Image.blob.get", receiver: { resultHandle: "image" }, arguments: {} }
  ] : [];
  const check = (result: { affected: number; results: readonly { value: unknown }[] }) => {
    expect(result.affected).toBe(0);
    if (operation === "package-open") expect(result.results.at(-1)!.value).toHaveLength(existingStyles ? 2 : 1);
    else if (operation === "values") { expect(result.results[1]!.value).toBe(1828800); expect(result.results[3]!.value).toBe(1); }
    else if (operation === "image") expect(result.results.at(-1)!.value).toEqual({ kind: "bytes", base64: Buffer.from(png).toString("base64") });
    else expect(result.results).toEqual([]);
  };
  if (route === "model") {
    if (operation === "package-open") { const pkg = await PackageView.open(input, textContext); expect(pkg.parts.map(p => p.partname.toString())).toEqual(existingStyles ? ["/word/document.xml", "/word/styles.xml"] : ["/word/document.xml"]); await pkg.save(sink); }
    else { const document = await Document(input, textContext); if (operation === "values") expect(Inches(2).emu).toBe(1828800); else if (operation === "image") expect((await Image.from_blob(png, textContext)).blob).toEqual(png); await document.save(sink); }
  } else if (route === "sdk") {
    const result = await applyStyleModelBatch(input, { version: 1, operations }, textContext); check(result); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops.json", encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const result = await shell.exec("docx batch /input --ops-file /ops.json --json"); expect(result.exitCode, result.stderr).toBe(0);
    const envelope = JSON.parse(result.stdout); expect(envelope).toMatchObject({ ok: true, affected: 0, errors: [], data: operation === "empty" ? { publication: null } : { output: [] } }); check({ affected: envelope.affected, results: envelope.data.results });
    expect(await fs.readFile("/input")).toEqual(input);
    // Outer create-from-template is the documented copy/save route, without
    // invoking a definition-creating getter or a nested sink operation.
    const copy = await shell.exec("docx create --template /input --output - > /copy"); expect(copy.exitCode, copy.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/copy"));
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer); expect(readPackage(output)).toEqual(parts); expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Original report");
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
