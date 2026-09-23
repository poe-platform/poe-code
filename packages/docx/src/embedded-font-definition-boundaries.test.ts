import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, replaceDocumentXmlPart, writeArchive, createDocxInspectionCommandEngine } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";

const enc = (text: string) => new TextEncoder().encode(text);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const embedding of ["embedRegular", "embedBold", "embedItalic", "embedBoldItalic"] as const)
for (const mutation of ["font-name", "key", "remove", "noop", "unembedded"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} preserves ${embedding} definition for ${mutation}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const embedded = `<w:${embedding} r:id="font" w:fontKey="{12345678-1234-1234-1234-123456789ABC}"/>`;
  const source = `<w:fonts xmlns:w="${w}" xmlns:r="${r}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:coastal:future" mc:Ignorable="f" mc:ProcessContent="f:bridge"><mc:AlternateContent><mc:Choice Requires="w"><w:font w:name="Embedded Face"><f:bridge>${embedded}</f:bridge><!--retained--></w:font></mc:Choice><mc:Fallback><f:kept/></mc:Fallback></mc:AlternateContent><w:font w:name="Ordinary Face"/></w:fonts>`;
  const replacement = enc(mutation === "font-name" ? source.replace("Embedded Face", "Changed Face") : mutation === "key" ? source.replace("789ABC", "789ABD") : mutation === "remove" ? source.replace(embedded, "") : mutation === "unembedded" ? source.replace("Ordinary Face", "Another Face") : source);
  const parts = readPackage(await chartFixture({ strict, definitions: [], resources: [{ name: "fonts/table.xml", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml;Audit=Coast", bytes: source }, { name: "fonts/payload.bin", type: "application/x-fontdata", bytes: Uint8Array.of(8, 9, 10) }], relationships: [{ owner: "/fonts/table.xml", id: "font", type: r + "/font", target: "payload.bin" }] }));
  parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), rejected = !["noop", "unembedded"].includes(mutation);
  if (route === "sdk") {
    const pending = replaceDocumentXmlPart(input, replacement, { part: "/fonts/table.xml", output: "-" }, { ...chartContext, encoding: { order: "input", compression: "store" }, stdout: sink });
    if (rejected) await expect(pending).rejects.toMatchObject({ code: "unsupported-edit", message: expect.stringContaining("Embedded font") });
    else expect(await pending).toMatchObject({ changed: mutation === "unembedded" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement); await fs.writeFile("/output", enc("Existing destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: chartContext.limits }) }));
    try {
      const result = await shell.exec("docx xml set /input --part /fonts/table.xml --file /replacement --output /output --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(rejected ? 1 : 0);
      if (rejected) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit", message: expect.stringContaining("Embedded font") }] }); expect(await fs.readFile("/output")).toEqual(enc("Existing destination")); }
      else memory.writeFileSync("/output", await fs.readFile("/output"));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (rejected) expect(memory.readFileSync("/output")).toHaveLength(0);
  else {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
    for (const [name, bytes] of parts) expect(saved.get(name), name).toEqual(name === "fonts/table.xml" ? replacement : bytes);
    expect(await Document(output, chartContext)).toBeDefined();
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
