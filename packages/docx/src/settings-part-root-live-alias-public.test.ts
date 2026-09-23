import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime;
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const runtime of ["source", "native"] as const) for (const route of ["model", "sdk", "cli"] as const)
for (const before of [false, true])
it(`settings root aliases stay live through native part XML changes; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}; before=${before}`, async () => {
  const product: typeof api = runtime === "native" ? native : api;
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retained</w:t></w:r></w:p>', { settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:evenAndOddHeaders w:val="${before ? "1" : "0"}"/><!--retain--><?audit exact?></w:settings>` } }, strict, { kind }));
  if (codec !== "utf8") for (const [name, bytes] of parts) {
    const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
    if (codec === "utf16be") encoded.swap16();
    parts.set(name, new Uint8Array(encoded));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const operations = [
    { operation: "model.document.Document.settings.get", receiver: ref("document"), arguments: {}, resultHandle: "settings" },
    { operation: "model.settings.Settings.part.get", receiver: ref("settings"), arguments: {}, resultHandle: "part" },
    { operation: "model.opc.part.XmlPart.element.get", receiver: ref("part"), arguments: {}, resultHandle: "root" },
    { operation: "model.XmlElementView.children.get", receiver: ref("root"), arguments: {}, resultHandle: "children" },
    { operation: "model.XmlElementView.set_attribute.call", receiver: ref("children", 0), arguments: { name: { namespaceURI: word, localName: "val" }, value: before ? "0" : "1" } },
    { operation: "model.settings.Settings.odd_and_even_pages_header_footer.get", receiver: ref("settings"), arguments: {} }
  ];
  let output: Uint8Array;
  if (route === "model") {
    const document = await product.Document(input, context), settings = document.settings, part = settings.part;
    expect(settings.odd_and_even_pages_header_footer).toBe(before);
    part.element.children[0]!.set_attribute({ namespaceURI: word, localName: "val" }, before ? "0" : "1");
    expect(settings.odd_and_even_pages_header_footer).toBe(!before);
    expect(document.settings.odd_and_even_pages_header_footer).toBe(!before);
    expect(settings.part).toBe(part);
    await document.save({ async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } });
    output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else if (route === "sdk") {
    const result = await product.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } });
    expect(result.results.at(-1)!.data).toBe(!before);
    output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const response = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(0); expect(JSON.parse(response.stdout).data.results.at(-1).data).toBe(!before); output = await fs.readFile("/output"); expect(await fs.readFile("/input")).toEqual(original); } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original);
  const saved = readPackage(output);
  for (const [name, bytes] of parts) if (name !== "word/settings.xml") expect(saved.get(name), name).toEqual(bytes);
  expect((await product.Document(output, context)).settings.odd_and_even_pages_header_footer).toBe(!before);
});
