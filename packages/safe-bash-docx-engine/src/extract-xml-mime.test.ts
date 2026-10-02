import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, extractDocumentArchive, packDocumentArchive, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { extractionPublication } from "../tests/fixtures/extraction-publication.js";
import { readPackage } from "../tests/assertions.js";

const types = [
  ...(["UTF-8", "UTF-16LE", "UTF-16BE"] as const).flatMap(encoding => [
    {name: "audit/record.data", type: "application/xml", encoding},
    {name: "audit/record.XML", type: "text/xml", encoding},
    {name: "audit/record.data", type: "application/x-audit+xml", encoding}
  ]), {name: "audit/binary.xml", type: "application/octet-stream", encoding: "binary" as const}
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const variant of types) for (const parameter of ["", ";audit=native", '; audit="coast; dune"'])
for (const pretty of [false, true]) for (const route of ["sdk", "shell"] as const)
it(`${route} extracts ${variant.name} ${variant.type}${parameter} ${variant.encoding} pretty=${pretty}; ${kind} strict=${strict}`, async () => {
  const enc = (text: string) => new TextEncoder().encode(text), dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const root = '<audit xmlns:f="urn:original:future"><f:empty/><text xml:space="preserve"> \t海 &amp; dunes </text><!--inside--><?audit retain?></audit>', before = '<!--before--><?audit original?>', after = '<!--after-->';
  const markup = `<?xml version="1.0" encoding="${variant.encoding === "UTF-8" ? "UTF-8" : "UTF-16"}"?>${before}${root}${after}`;
  let payload: Uint8Array;
  if (variant.encoding === "binary") payload = Uint8Array.of(0,255,128,60,0,19);
  else if (variant.encoding === "UTF-8") payload = enc(markup);
  else {const buffer = Buffer.from("\ufeff" + markup, "utf16le"); if (variant.encoding === "UTF-16BE") buffer.swap16(); payload = new Uint8Array(buffer);}
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original retained body</w:t></w:r></w:p>', {}, strict));
  parts.set("[Content_Types].xml", enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`).replace("</Types>", `<Override PartName="/${variant.name}" ContentType="${(variant.type+parameter).replaceAll('"', '&quot;')}"/></Types>`))); parts.set(variant.name, payload);
  const volume = Volume.fromJSON({"/archive": ""}); await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {volume.appendFileSync("/archive", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(volume.readFileSync("/archive") as Buffer), {fs, volume: output} = extractionPublication(input);
  if (route === "sdk") expect((await extractDocumentArchive(input, {outputDir: "/new", pretty, allowPartialOutput: true}, {...textContext, filesystem: fs})).complete).toBe(true);
  else {
    const shellFs = new MemoryFileSystem(); await shellFs.writeFile("/input", input); const shell = new Shell({fs: shellFs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec(`docx extract /input --output-dir /new --allow-partial-output ${pretty ? "--pretty" : ""} --json`); expect(result.exitCode, result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.complete).toBe(true); expect(await shellFs.readFile("/input")).toEqual(input);
    output.mkdirSync("/new"); for (const name of [...parts.keys(), "manifest.json"]) {output.mkdirSync("/new/" + name.split("/").slice(0,-1).join("/"), {recursive: true}); output.writeFileSync("/new/"+name, await shellFs.readFile("/new/"+name));}
  }
  const expected = pretty && variant.encoding !== "binary" ? enc(`<?xml version="1.0" encoding="UTF-8"?>${before}<audit xmlns:f="urn:original:future">\n  <f:empty/>\n  <text xml:space="preserve"> \t海 &amp; dunes </text>\n  <!--inside-->\n  <?audit retain?>\n</audit>${after}`) : payload;
  expect(output.readFileSync("/new/"+variant.name)).toEqual(Buffer.from(expected));
  const manifest = JSON.parse(output.readFileSync("/new/manifest.json", "utf8") as string); expect(manifest).toMatchObject({kind, dialect: strict ? "strict" : "transitional", pretty, selection: "all"}); expect(manifest.entries).toHaveLength(parts.size);
  for (const entry of manifest.entries) {const bytes = new Uint8Array(output.readFileSync("/new/"+entry.path) as Buffer); expect(entry.bytes).toBe(bytes.length); expect(entry.sha256).toBe([...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2,"0")).join("")); if (!pretty) expect(bytes).toEqual(parts.get(entry.path));}
  await packDocumentArchive(manifest, {output: "-"}, {...textContext, filesystem: fs, inventoryDirectory: "/new", stdout: {async write(bytes) {output.appendFileSync("/packed", bytes);}}}); const packed = new Uint8Array(output.readFileSync("/packed") as Buffer); for (const [name, bytes] of readPackage(packed)) expect(bytes).toEqual(new Uint8Array(output.readFileSync("/new/"+name) as Buffer)); expect((await Document(packed, textContext)).paragraphs[0]!.text).toBe("Original retained body");
  expect(output.readFileSync("/input")).toEqual(Buffer.from(input)); expect(output.readFileSync("/keep", "utf8")).toBe("Retained");
});
