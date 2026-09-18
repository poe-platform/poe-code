import {Volume} from "memfs";
import {expect, it} from "vitest";
import {MemoryFileSystem, Shell} from "virtual-bash";
import {docxCommands} from "virtual-bash/commands/docx";
import {Document, createDocxInspectionCommandEngine, replaceDocumentXmlPart, writeArchive} from "./index.js";
import {textFixture, textContext} from "../tests/fixtures/text.js";
import {readPackage} from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"])
for (const codec of ["utf8", "bom", "utf16le", "utf16be"])
for (const owner of ["opaque-root", "native-root"])
for (const mode of ["add", "remove", "change-prolog", "change-epilog"])
for (const route of ["sdk", "shell"])
it(`${route} changes XML declaration framing while retaining ${owner} content; ${mode} ${codec} ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict));
  const native = owner === "native-root", name = native ? "word/document.xml" : "assets/opaque.xml";
  let types = new TextDecoder().decode(parts.get("[Content_Types].xml"));
  if (!native) types = types.replace("</Types>", '<Override PartName="/assets/opaque.xml" ContentType="application/xml"/></Types>');
  if (kind === "dotx") types = types.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml");
  parts.set("[Content_Types].xml", enc(types));
  const content = native ? new TextDecoder().decode(parts.get(name)) : '<f:audit xmlns:f="urn:original:future" xml:lang="pl" xml:space="preserve" xml:base="../retained"><!--inner-->海<?keep inner?><f:item f:value="original"/></f:audit>';
  const framing = '<!--prolog--><?keep before?>' + content + '<?keep after?><!--epilog-->';
  const declaration = `<?xml version="1.0" encoding="${codec.startsWith("utf16") ? "UTF-16" : "UTF-8"}"?>`;
  const encode = (value: string) => codec === "utf8" ? enc(value) : codec === "bom" ? new Uint8Array([239,187,191,...enc(value)]) : new Uint8Array(codec === "utf16be" ? Buffer.from("\ufeff" + value, "utf16le").swap16() : Buffer.from("\ufeff" + value, "utf16le"));
  const original = encode((mode === "add" ? "" : declaration) + framing);
  const changed = mode === "change-prolog" ? framing.replace("prolog", "changed") : mode === "change-epilog" ? framing.replace("epilog", "changed") : framing;
  const replacement = encode((mode === "remove" ? "" : declaration) + changed), admitted = mode === "add" || mode === "remove" || native;
  parts.set(name, original);
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "sdk") {
    const pending = replaceDocumentXmlPart(input, replacement, {part: "/" + name, output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}});
    if (admitted) expect(await pending).toMatchObject({changed: true}); else await expect(pending).rejects.toMatchObject({code: "unsupported-edit"});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/xml", replacement); await fs.writeFile("/output", enc("sentinel"));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx xml set /input --part '/" + name + "' --file /xml --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(admitted ? 0 : 1);
    if (admitted) memory.writeFileSync("/output", await fs.readFile("/output")); else {expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, errors: [{code: "unsupported-edit"}]}); expect(await fs.readFile("/output")).toEqual(enc("sentinel"));}
    expect(await fs.readFile("/input")).toEqual(input);
  }
  if (admitted) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), expected = new Map(parts); expected.set(name, replacement);
    expect(readPackage(output)).toEqual(expected); expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Original coast");
  } else expect(memory.readFileSync("/output")).toHaveLength(0);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
