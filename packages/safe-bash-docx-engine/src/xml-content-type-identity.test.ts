import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
const variants = [
  { name: "value-case", original: "multipart/mixed;boundary=CoastalBoundary", replacement: "multipart/mixed;boundary=coastalboundary", rejected: true },
  { name: "quoted-value-case", original: 'multipart/mixed;boundary="CoastalBoundary"', replacement: 'multipart/mixed;boundary="coastalboundary"', rejected: true },
  { name: "essence-case", original: "multipart/mixed;boundary=CoastalBoundary", replacement: "Multipart/Mixed;boundary=CoastalBoundary" },
  { name: "parameter-name-case", original: "multipart/mixed;boundary=CoastalBoundary", replacement: "multipart/mixed;BOUNDARY=CoastalBoundary" },
  { name: "unchanged-value", original: "multipart/mixed;boundary=CoastalBoundary", replacement: "multipart/mixed;boundary=CoastalBoundary" },
  { name: "quoted-equivalent", original: "multipart/mixed;boundary=CoastalBoundary", replacement: 'multipart/mixed;boundary="CoastalBoundary"' },
  { name: "escaped-equivalent", original: "multipart/mixed;boundary=CoastalBoundary", replacement: 'multipart/mixed;boundary="Coastal\\Boundary"' },
  { name: "parameter-whitespace", original: "multipart/mixed;boundary=CoastalBoundary", replacement: "multipart/mixed ; boundary=CoastalBoundary" },
  { name: "parameter-order", original: "multipart/mixed;boundary=CoastalBoundary;x=Keep", replacement: "multipart/mixed;x=Keep;boundary=CoastalBoundary" },
  { name: "parameter-added", original: "multipart/mixed;boundary=CoastalBoundary", replacement: "multipart/mixed;boundary=CoastalBoundary;x=Keep", rejected: true },
  { name: "parameter-removed", original: "multipart/mixed;boundary=CoastalBoundary;x=Keep", replacement: "multipart/mixed;boundary=CoastalBoundary", rejected: true },
  { name: "opaque-parameter-case", original: "multipart/mixed;boundary=CoastalBoundary;x=Keep", replacement: "multipart/mixed;boundary=CoastalBoundary;x=keep", rejected: true },
  { name: "charset-case", original: "text/plain;charset=UTF-8", replacement: "text/plain;charset=utf-8" },
  { name: "charset-changed", original: "text/plain;charset=UTF-8", replacement: "text/plain;charset=us-ascii", rejected: true },
  { name: "external-access-case", original: "message/external-body;access-type=URL", replacement: "message/external-body;access-type=url" },
  { name: "external-access-changed", original: "message/external-body;access-type=URL", replacement: "message/external-body;access-type=ftp", rejected: true },
  { name: "quoted-delimiter", original: 'multipart/mixed;boundary="Coastal;Boundary"', replacement: 'multipart/mixed;boundary="Coastal;Boundary";x=Keep', rejected: true },
  { name: "duplicate-parameter-count", original: "multipart/mixed;boundary=CoastalBoundary;x=Keep", replacement: "multipart/mixed;boundary=CoastalBoundary;x=Keep;x=Keep", rejected: true },
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const variant of variants)
for (const route of ["sdk", "shell"] as const)
it(`${route} preserves MIME parameter identity for ${variant.name}; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>', {}, strict));
  const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const originalType = escapeAttribute(variant.original), changedType = escapeAttribute(variant.replacement);
  const originalTypes = new TextDecoder().decode(parts.get("[Content_Types].xml")!)
    .replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)
    .replace("</Types>", `<Override PartName="/records/multipart.bin" ContentType="${originalType}"/></Types>`);
  const replacement = encode(originalTypes.replace(originalType, changedType));
  parts.set("[Content_Types].xml", encode(originalTypes));
  parts.set("records/multipart.bin", encode("--CoastalBoundary\r\nContent-Type: text/plain\r\n\r\nRetained payload\r\n--CoastalBoundary--\r\n"));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), rejected = variant.rejected ?? false;
  expect((await Document(input, textContext)).paragraphs[0]!.text).toBe("Retained body");
  if (route === "sdk") {
    const pending = replaceDocumentXmlPart(input, replacement, { part: "/[Content_Types].xml", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    if (rejected) await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
    else expect(await pending).toMatchObject({ changed: variant.name !== "unchanged-value" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement); await fs.writeFile("/output", encode("Existing destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx xml set /input --part '/[Content_Types].xml' --file /replacement --output /output --force --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(rejected ? 1 : 0);
      if (rejected) { expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/output")).toEqual(encode("Existing destination")); }
      else memory.writeFileSync("/output", await fs.readFile("/output"));
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (rejected) expect(memory.readFileSync("/output")).toHaveLength(0);
  else {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
    for (const [name, bytes] of parts) expect(saved.get(name), name).toEqual(name === "[Content_Types].xml" ? replacement : bytes);
    expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Retained body");
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
