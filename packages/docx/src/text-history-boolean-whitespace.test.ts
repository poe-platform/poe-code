import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (text: string) => new TextEncoder().encode(text);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const token of ["false", "0"]) for (const view of ["final", "original", "all"] as const)
for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
it(`reads simple property history with legal XML boolean whitespace; ${token}; ${view}; ${route}; ${kind}; strict=${strict}`, async () => {
  const lexical = ` &#x9;${token}&#xD;&#xA; `, text = "日本 עברית e\u0323\u0301 🌊 𠀀";
  const flags = (value: string) => ["b", "i", "rtl", "vanish"].map(tag => `<w:${tag} w:val="${value}"/>`).join("");
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind,
    `<w:p><w:pPr><w:bidi/><w:pPrChange w:id="1" w:author="Original" w:date="2026-09-19T12:00:00Z"><w:pPr><w:bidi w:val="${lexical}"/></w:pPr></w:pPrChange></w:pPr><w:r><w:rPr>${flags("true")}<w:rPrChange w:id="2" w:author="Original" w:date="2026-09-19T12:00:00Z"><w:rPr>${flags(lexical)}</w:rPr></w:rPrChange></w:rPr><w:t>${text}</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const original = input.slice(), members = readPackage(input), batch = { version: 1, operations: [{ operation: "text.get", arguments: { view } }] };
  let data: api.TextData;
  if (route === "sdk") data = await api.extractDocumentText(input, textContext, { view });
  else if (route === "sdk-batch") {
    const result = await api.executeDocumentBatch(input, batch, {}, { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write() { throw new Error("Read wrote output"); } } });
    expect(result.publication).toBeNull(); expect(result.results[0]!.affected).toBe(0); data = result.results[0]!.data as api.TextData;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? `docx text get /input --view ${view} --json` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --json`;
      const result = await shell.exec(command); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(true); expect(envelope.affected).toBe(0); data = route === "cli" ? envelope.data : envelope.data.results[0].data;
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/destination")).toEqual(enc("Retained destination"));
    } finally { await shell.dispose(); }
  }
  expect(data.text).toBe(text); expect(data.view).toBe(view); expect(data.warnings).toEqual([]);
  expect(data.revisions).toHaveLength(2); expect(data.revisions.map(r => r.support)).toEqual(["supported", "supported"]);
  expect(data.segments).toHaveLength(1);
  const formatting = (value: boolean) => ({ bold: value, italic: value, rtl: value, hidden: value, paragraph: { bidi: value } });
  expect(data.segments[0]!.formatting).toMatchObject(formatting(view !== "original"));
  if (view === "all") expect(data.segments[0]!.originalFormatting).toMatchObject(formatting(false));
  else expect(data.segments[0]!.originalFormatting).toBeNull();
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(members);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const token of ["false", "0"]) for (const route of ["model", "sdk", "sdk-batch", "cli", "cli-batch"] as const)
for (const dryRun of route === "model" ? [false] : [false, true])
it(`formats admitted simple whitespace boolean history preserving its raw snapshot; ${token}; ${route}; dry=${dryRun}; ${kind}; strict=${strict}`, async () => {
  const lexical = ` &#x9;${token}&#xD;&#xA; `, text = "日本 עברית e\u0323\u0301 🌊 𠀀";
  const history = `<w:rPrChange w:id="2" w:author="Original" w:date="2026-09-19T12:00:00Z"><w:rPr><w:i w:val="${lexical}"/><!--historical--><?history keep?></w:rPr></w:rPrChange>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind,
    `<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:i/><w:rtl/>${history}</w:rPr><w:t>${text}</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const original = input.slice(), members = readPackage(input), memory = Volume.fromJSON({ "/output": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const args = { paragraph: 1, run: 1, italic: false }, batch = { version: 1, operations: [{ operation: "runs.set", arguments: args }] };
  let output: Uint8Array | undefined;
  if (route === "model") {
    const native = await api.Document(input, textContext); native.paragraphs[0]!.runs[0]!.italic = false; await native.save(sink); output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else if (route === "sdk" || route === "sdk-batch") {
    const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
    if (route === "sdk") {
      const result = await api.formatDocumentRuns(input, { ...args, output: "-", dryRun }, context); expect(result.changed).toBe(true); expect(result.changes).toHaveLength(1); expect(result.dryRun).toBe(dryRun);
    } else {
      const result = await api.executeDocumentBatch(input, batch, { output: "-", dryRun }, context); expect(result.results[0]!.affected).toBe(1); expect(result.publication!.changed).toBe(true); expect(result.publication!.dryRun).toBe(dryRun);
    }
    if (!dryRun) output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "cli" ? "docx runs set /input --paragraph 1 --run 1 --italic false" : `docx batch /input --ops-json '${JSON.stringify(batch)}'`;
      const result = await shell.exec(command + " --output /destination --force --json" + (dryRun ? " --dry-run" : "")); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(true); expect(envelope.affected).toBe(1);
      expect(await fs.readFile("/input")).toEqual(original);
      if (dryRun) expect(await fs.readFile("/destination")).toEqual(enc("Retained destination")); else output = await fs.readFile("/destination");
    } finally { await shell.dispose(); }
  }
  if (dryRun) { expect(output).toBeUndefined(); expect(memory.readFileSync("/output").length).toBe(0); }
  else {
    const saved = readPackage(output!); expect(saved.size).toBe(members.size);
    for (const [name, bytes] of members) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
    // The fixture selects the dialect before admission; compare its exact original snapshot spelling.
    const originalXml = new TextDecoder().decode(members.get("word/document.xml")!), xml = new TextDecoder().decode(saved.get("word/document.xml")!);
    const snapshot = originalXml.slice(originalXml.indexOf("<w:rPrChange"), originalXml.indexOf("</w:rPrChange>") + "</w:rPrChange>".length);
    expect(snapshot).not.toBe(""); expect(xml.split(snapshot)).toHaveLength(2); expect(xml).toContain("<!--retain--><?policy keep?>");
    const native = await api.Document(output!, textContext), paragraph = native.paragraphs[0]!; expect(paragraph.text).toBe(text); expect(paragraph.paragraph_format.keep_with_next).toBe(true);
    expect([paragraph.runs[0]!.bold, paragraph.runs[0]!.italic, paragraph.runs[0]!.font.rtl]).toEqual([true, false, true]);
    const historical = await api.extractDocumentText(output!, textContext, { view: "original" }); expect(historical.text).toBe(text); expect(historical.segments[0]!.formatting.italic).toBe(false); expect(historical.warnings).toEqual([]);
  }
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(members);
});
