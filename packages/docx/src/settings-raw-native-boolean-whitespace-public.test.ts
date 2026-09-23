import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as source from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime as unknown as typeof compiledTypes;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const raw of [" &#x9;true&#xA; ", " &#x9;false&#xA; ", " &#x9;1&#xA; ", " &#x9;0&#xA; ", " on ", " off ", "\u00a01\u00a0", "unknown"])
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
it(`raw native settings boolean whitespace ${JSON.stringify(raw)}; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
  const api = (route.startsWith("native") ? native : source) as typeof source;
  const context = { signal: textContext.signal, limits: textContext.limits, encoding: { order: "input", compression: "store" } as const };
  const allowed = !route.endsWith("batch") && raw.startsWith(" &#x9;");
  const expectedError = route.endsWith("batch") ? "unsupported-profile" : "unsupported-edit";
  const xml = `<w:settings xmlns:w="${strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w}"><w:updateFields w:val="${raw}"/><w:compat/><!--retained 海🌊--><?audit exact?></w:settings>`;
  const replacementXml = xml.replace(`w:val="${raw}"`, 'w:val="0"');
  const encode = (text: string) => { if (codec === "utf8") return new TextEncoder().encode(text); const buffer = Buffer.from("\ufeff" + text, "utf16le"); if (codec === "utf16be") buffer.swap16(); return new Uint8Array(buffer); };
  const parts = readPackage(await textFixture("<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>", { settings: { kind: "settings", xml } }, strict, { kind }));
  if (codec !== "utf8") for (const [name, bytes] of parts) parts.set(name, encode(new TextDecoder().decode(bytes)));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), replacement = encode(replacementXml);
  const operations = [{ operation: "xml.set", arguments: { part: "/word/settings.xml", file: { kind: "bytes", base64: Buffer.from(replacement).toString("base64") } } }];
  if (route.includes("sdk")) {
    const operation = route.endsWith("batch") ? api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } }) : api.replaceDocumentXmlPart(input, replacement, { part: "/word/settings.xml", output: "-" }, { ...context, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    if (allowed) await expect(operation).resolves.toBeDefined();
    else await expect(operation).rejects.toMatchObject({ code: expectedError });
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement); await fs.writeFile("/output", destination); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec((route.endsWith("batch") ? "docx batch /input --ops-file /ops" : "docx xml set /input --part /word/settings.xml --file /replacement") + " --output /output --force --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(allowed ? 0 : 1);
      if (allowed) memory.writeFileSync("/output", await fs.readFile("/output"));
      else { expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: expectedError }] }); expect(await fs.readFile("/output")).toEqual(destination); }
      expect(await fs.readFile("/input")).toEqual(original);
    } finally { await shell.dispose(); }
  }
  if (allowed) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
    expect([...after.keys()]).toEqual([...parts.keys()]);
    for (const [name, bytes] of parts) expect(after.get(name), name).toEqual(name === "word/settings.xml" ? replacement : bytes);
    expect((await api.inspectDocumentSettings(output, {}, context)).items[0]!.details.updateFields).toBe(false);
  } else expect(memory.statSync("/output").size).toBe(0);
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(parts);
});
