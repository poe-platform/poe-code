import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf16le", "utf16be"] as const)
for (const depth of [32, 8192]) for (const placement of ["unrelated", "selected"] as const)
for (const operation of ["controls.repeat", "template.apply"] as const)
for (const route of ["sdk", "native-sdk", "sdk-batch", "native-sdk-batch", "cli", "native-cli", "cli-batch", "native-cli-batch"] as const)
it(`repeat/template physical depth ${placement}; strict=${strict}; kind=${kind}; codec=${codec}; depth=${depth}; operation=${operation}; route=${route}`, async () => {
  const api = (route.startsWith("native") ? native : source) as typeof source;
  const limits = { ...textContext.limits, maxArchiveBytes: 2097152, maxEntryBytes: 1048576, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 };
  const documentLimits = { xmlDepth: 16384, retainedBytes: 2147483648, work: 2147483648 }, signal = new AbortController().signal;
  const fresh = () => ({ signal, limits, budget: new api.DocumentBudget(documentLimits, signal), encoding: { order: "input", compression: "store" } as const });
  const retained = '<f:opaque>' + '<f:owner>'.repeat(depth) + '<f:leaf/>' + '</f:owner>'.repeat(depth) + '</f:opaque>';
  const affected = '<w:futureProperty>' + '<w:futureChild>'.repeat(depth) + '<w:leaf/>' + '</w:futureChild>'.repeat(depth) + '</w:futureProperty>';
  const field = '<w:sdt><w:sdtPr><w:id w:val="3"/><w:tag w:val="entry"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t></w:r></w:sdtContent></w:sdt>';
  const region = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><w:tag w:val="records"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="2"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p>${field}${placement === "selected" ? affected : ""}</w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const parts = readPackage(await textFixture("", {}, strict, { kind }), limits);
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${w}" xmlns:f="urn:original:repeat-physical-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:body><w:p><w:pPr>${placement === "unrelated" ? retained : ""}</w:pPr><w:r><w:t>Outside</w:t></w:r></w:p>${region}<!--retained--><?audit exact?></w:body></w:document>`));
  if (codec !== "utf8") for (const [name, bytes] of parts) { const buffer = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le"); if (codec === "utf16be") buffer.swap16(); parts.set(name, new Uint8Array(buffer)); }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, fresh().encoding, fresh());
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), data = [{ values: [{ binding: "entry", value: "New 海🌊" }] }];
  const arguments_ = operation === "controls.repeat" ? { control: 1, data } : { data }, operations = [{ operation, arguments: arguments_ }], allowed = placement === "unrelated";
  if (route.includes("sdk")) {
    const io = { ...fresh(), stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
    const pending = route.endsWith("batch") ? api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, io) : operation === "controls.repeat" ? api.editDocumentControlRepeats(input, { control: 1, data, output: "-" }, io) : api.applyDocumentTemplate(input, { data, output: "-" }, io);
    if (allowed) await expect(pending).resolves.toBeDefined(); else await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained forced destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/data", new TextEncoder().encode(JSON.stringify(data))); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try {
      const command = route.endsWith("batch") ? "docx batch /input --ops-file /ops" : operation === "controls.repeat" ? "docx controls repeat /input --control 1 --data-file /data" : "docx template apply /input --data-file /data";
      const response = await shell.exec(command + " --output /output --force --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(allowed ? 0 : 1);
      if (allowed) memory.writeFileSync("/output", await fs.readFile("/output"));
      else { expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] }); expect(Buffer.compare(Buffer.from(await fs.readFile("/output")), Buffer.from(destination))).toBe(0); }
      expect(Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(original))).toBe(0);
    } finally { await shell.dispose(); }
  }
  if (allowed) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output, limits); expect([...after.keys()]).toEqual([...parts.keys()]);
    for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(Buffer.compare(Buffer.from(after.get(name)!), Buffer.from(bytes)), name).toBe(0);
    const main = new TextDecoder(codec === "utf8" ? "utf-8" : codec === "utf16le" ? "utf-16le" : "utf-16be").decode(after.get("word/document.xml")); expect(main).toContain(retained); expect(main).toContain("<!--retained--><?audit exact?>");
    expect((await api.extractDocumentText(output, fresh())).text).toBe("Outside\nNew 海🌊");
    expect((await api.inspectDocumentControls(output, {}, fresh())).items.find(item => item.tag === "entry")).toMatchObject({ value: "New 海🌊", placeholder: false });
  } else expect(memory.statSync("/output").size).toBe(0);
  expect(Buffer.compare(Buffer.from(input), Buffer.from(original))).toBe(0); expect([...readPackage(input, limits).keys()]).toEqual([...parts.keys()]); for (const [name, bytes] of readPackage(input, limits)) expect(Buffer.compare(Buffer.from(bytes), Buffer.from(parts.get(name)!)), name).toBe(0);
});
