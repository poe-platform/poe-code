import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const text = " A海🌊\tB\nC ";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const review of ["ins", "del", "rPrChange", "pPrChange"] as const)
for (const action of ["accept", "reject"] as const)
for (const scenario of ["inherited-both", "explicit-overrides", "unsupported-base", "unsupported-id", "unsupported-space", "inherited-space-ancestor-overridden"] as const)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
it(`revision decision complete inherited XML boundary; strict=${strict}; kind=${kind}; codec=${codec}; review=${review}; action=${action}; scenario=${scenario}; route=${route}`, async () => {
  const product: typeof api = route.startsWith("native") ? native as unknown as typeof api : api;
  const context = { limits: textContext.limits, signal: textContext.signal, encoding: { order: "input", compression: "store" } as const };
  const rejected = scenario.startsWith("unsupported"), override = scenario === "explicit-overrides" ? ' xml:lang="en" xml:space="default"' : "";
  const inherited = scenario === "unsupported-base" ? ' xml:base="relative/"' : scenario === "unsupported-id" ? ' xml:id="stored-id"' : scenario === "unsupported-space" ? ' xml:space="unknown-policy"' : ' xml:lang="ar" xml:space="preserve"';
  const storedText = review === "del" ? "delText" : "t";
  const formatting = review === "rPrChange" || review === "pPrChange";
  const content = review === "pPrChange" ? `<w:pPr><w:bidi/><w:pPrChange w:id="7"${inherited}><w:pPr${override}><w:bidi w:val="0"/></w:pPr></w:pPrChange></w:pPr><w:r><w:t xml:space="preserve"> A海🌊&#9;B&#10;C </w:t></w:r>` : review === "rPrChange" ? `<w:r><w:rPr><w:b/><w:rPrChange w:id="7"${inherited}><w:rPr${override}><w:i/></w:rPr></w:rPrChange></w:rPr><w:t xml:space="preserve"> A海🌊&#9;B&#10;C </w:t></w:r>` : `<w:${review} w:id="7"${inherited}><w:r><w:${storedText} xml:space="preserve"> A海🌊&#9;B&#10;C </w:${storedText}></w:r><w:r${override}><w:${storedText}>Second</w:${storedText}></w:r></w:${review}>`;
  const ancestor = scenario === "inherited-space-ancestor-overridden" ? ' xml:space="unknown-policy"' : "";
  const parts = readPackage(await textFixture(`<w:p${ancestor}>${content}<w:r><w:t>Outside</w:t></w:r><!--retain--><?audit exact?></w:p>`, {}, strict, { kind }));
  if (codec !== "utf8") for (const [name, bytes] of parts) { const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le"); if (codec === "utf16be") encoded.swap16(); parts.set(name, new Uint8Array(encoded)); }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await product.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes: Uint8Array) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const operation = `revisions.${action}` as const, arguments_ = { revision: 1 }, batch = { version: 1 as const, operations: [{ operation, arguments: arguments_ }] };
  if (route.includes("sdk")) {
    const io = { ...context, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const pending = route.endsWith("batch") ? product.executeDocumentBatch(input, batch, { output: "-" }, io) : product.editDocumentRevisionDecisions(input, { operation, options: { ...arguments_, output: "-" } }, io);
    if (rejected) await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); else await pending;
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained forced destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: product.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec((route.endsWith("batch") ? "docx batch /input --ops-file /ops" : `docx revisions ${action} /input --revision 1`) + " --output /output --force --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(rejected ? 1 : 0);
      if (rejected) { expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(await fs.readFile("/output")).toEqual(destination); }
      else { expect(JSON.parse(response.stdout).ok).toBe(true); memory.writeFileSync("/output", await fs.readFile("/output")); }
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(parts);
  if (rejected) { expect(memory.statSync("/output").size).toBe(0); return; }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect([...after.keys()]).toEqual([...parts.keys()]); for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const root = (await product.parseDocumentXmlAsync(after.get("word/document.xml")!)).root, paragraph = root.children[0]!.children[0]!;
  if (ancestor) expect(paragraph.attributes.find(attribute => attribute.namespace === "http://www.w3.org/XML/1998/namespace" && attribute.localName === "space")?.value).toBe("unknown-policy");
  const attributes = (node: api.XmlElement) => Object.fromEntries(node.attributes.filter(attribute => attribute.namespace === "http://www.w3.org/XML/1998/namespace").map(attribute => [attribute.localName, attribute.value]));
  const restored = formatting ? action === "reject" : review === "ins" ? action === "accept" : action === "reject";
  if (formatting) {
    const properties = review === "pPrChange" ? paragraph.children[0]! : paragraph.children[0]!.children[0]!;
    expect(properties.children.map(node => node.localName)).toEqual([review === "pPrChange" ? "bidi" : action === "accept" ? "b" : "i"]);
    if (review === "pPrChange") expect(properties.children[0]!.attributes.find(attribute => attribute.localName === "val")?.value).toBe(action === "accept" ? undefined : "0");
    expect(attributes(properties)).toEqual(restored ? scenario === "explicit-overrides" ? { lang: "en", space: "default" } : { lang: "ar", space: "preserve" } : {});
  } else if (restored) {
    expect(attributes(paragraph.children[0]!)).toEqual({ lang: "ar", space: "preserve" });
    expect(attributes(paragraph.children[1]!)).toEqual(scenario === "explicit-overrides" ? { lang: "en", space: "default" } : { lang: "ar", space: "preserve" });
  }
  expect((await product.extractDocumentText(output, context)).text).toBe((formatting || restored ? text + (formatting ? "" : "Second") : "") + "Outside");
  const decoded = new TextDecoder(codec === "utf8" ? "utf-8" : codec === "utf16le" ? "utf-16le" : "utf-16be").decode(after.get("word/document.xml")!);
  expect(decoded).toContain("<!--retain--><?audit exact?>");
  expect((await product.inspectDocumentRevisions(output, {}, context)).items).toEqual([]);
});
