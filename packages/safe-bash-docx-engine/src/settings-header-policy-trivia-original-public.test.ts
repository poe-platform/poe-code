import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const native = await compiledPublicRuntime;
const encode = (value: string) => new TextEncoder().encode(value);
const reference = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const runtime of ["source", "native"] as const) for (const route of ["model", "sdk", "cli"] as const)
for (const content of ["trivia", "whitespace", "inert-attribute"] as const)
for (const initial of [false, true]) for (const assigned of [false, true])
it(`preserves unselected native Settings flag XML; strict=${strict}; kind=${kind}; codec=${codec}; runtime=${runtime}; route=${route}; content=${content}; initial=${initial}; assigned=${assigned}`, async () => {
  const product: typeof api = runtime === "native" ? native : api;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const trivia = content === "trivia" ? "<!--retained 海🌊--><?audit exact?>" : content === "whitespace" ? " \t&#xA; \n" : "";
  const attribute = content === "inert-attribute" ? ' u:audit="Retained 海🌊"' : "";
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Outside 海🌊</w:t></w:r></w:p>', {
    settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}" xmlns:u="urn:original:settings-flag" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="u"><w:evenAndOddHeaders w:val="${initial ? 1 : 0}"${attribute}>${trivia}</w:evenAndOddHeaders><w:compat/><!--root retain--><?audit root?></w:settings>` }
  }, strict, { kind }));
  for (const [name, bytes] of parts) {
    const original = new TextDecoder().decode(bytes);
    let encoded: Uint8Array = bytes;
    if (codec !== "utf8") {
      const buffer = Buffer.from("\ufeff" + original, "utf16le");
      if (codec === "utf16be") buffer.swap16();
      encoded = new Uint8Array(buffer);
      expect([...encoded.slice(0, 2)]).toEqual(codec === "utf16be" ? [254, 255] : [255, 254]);
    }
    expect(new TextDecoder(codec === "utf16be" ? "utf-16be" : codec === "utf16le" ? "utf-16le" : "utf-8").decode(encoded)).toBe(original);
    parts.set(name, encoded);
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = [
    { operation: "model.document.Document.settings.get", receiver: reference("document"), arguments: {}, resultHandle: "settings" },
    { operation: "model.settings.Settings.odd_and_even_pages_header_footer.set", receiver: reference("settings"), arguments: { value: assigned } },
    { operation: "model.settings.Settings.odd_and_even_pages_header_footer.get", receiver: reference("settings"), arguments: {} }
  ];
  if (route === "model") {
    const document = await product.Document(input, context), settings = document.settings;
    expect(settings.odd_and_even_pages_header_footer).toBe(initial);
    settings.odd_and_even_pages_header_footer = assigned;
    expect(settings.odd_and_even_pages_header_footer).toBe(assigned);
    expect(settings).toBe(document.settings);
    await document.save(sink);
  } else if (route === "sdk") {
    const result = await product.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
    expect(result.results.at(-1)!.data).toBe(assigned);
  } else {
    const fs = new MemoryFileSystem(), destination = encode("Retained destination");
    await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/operations", encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /operations --output /output --force --json");
      if (response.exitCode !== 0) expect(await fs.readFile("/output")).toEqual(destination);
      expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      expect(JSON.parse(response.stdout).data.results.at(-1).data).toBe(assigned);
      expect(await fs.readFile("/input")).toEqual(original);
      memory.writeFileSync("/output", await fs.readFile("/output"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  const decoding = codec === "utf16be" ? "utf-16be" : codec === "utf16le" ? "utf-16le" : "utf-8";
  assertPackageLinks(new Map([...saved].map(([name, bytes]) => [name, encode(new TextDecoder(decoding, { fatal: true }).decode(bytes))])));
  if (codec !== "utf8") expect([...saved.get("word/settings.xml")!.slice(0, 2)]).toEqual(codec === "utf16be" ? [254, 255] : [255, 254]);
  expect([...saved.keys()]).toEqual([...parts.keys()]);
  for (const [name, bytes] of parts) if (name !== "word/settings.xml") expect(saved.get(name), name).toEqual(bytes);
  const xml = new TextDecoder(codec === "utf16be" ? "utf-16be" : codec === "utf16le" ? "utf-16le" : "utf-8").decode(saved.get("word/settings.xml")!);
  expect(xml).toContain("<!--root retain--><?audit root?>");
  if (trivia) expect(xml).toContain(trivia);
  if (attribute) expect(xml).toContain(attribute);
  const reopened = await product.Document(output, context);
  expect(reopened.settings.odd_and_even_pages_header_footer).toBe(assigned);
  if (initial === assigned) expect(output).toEqual(original);
  expect(input).toEqual(original); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
});
