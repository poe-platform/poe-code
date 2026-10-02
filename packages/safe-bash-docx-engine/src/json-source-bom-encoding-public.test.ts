import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const native = await compiledPublicRuntime;
const profiles = ["none", "one", "two", "after-whitespace", "comments", "trailing", "utf16le", "utf16be", "invalid-utf8"] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const codec of ["utf8", "utf8-bom", "utf16le", "utf16be"] as const)
for (const operation of ["batch", "template.apply"] as const) for (const profile of profiles)
for (const route of (profile === "utf16le" || profile === "utf16be" || profile === "invalid-utf8"
  ? ["sdk", "native-sdk", "cli-file", "native-cli-file"] as const
  : ["sdk", "native-sdk", "cli-file", "native-cli-file", "cli-inline", "native-cli-inline"] as const))
it(`F47 exact JSON source encoding and single leading BOM; strict=${strict}; kind=${kind}; codec=${codec}; operation=${operation}; profile=${profile}; route=${route}`, async () => {
  const api = (route.startsWith("native") ? native : source) as typeof source;
  const signal = new AbortController().signal;
  const limits = { ...textContext.limits, maxArchiveBytes: 1048576, maxEntryBytes: 524288, maxTotalBytes: 2097152, maxRetainedBytes: 67108864 };
  const fresh = () => ({ signal, limits, budget: new api.DocumentBudget({}, signal), encoding: { order: "input", compression: "store" } as const });
  const parts = readPackage(await textFixture("", {}, strict, { kind }), limits);
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${word}"><w:body><w:p><w:sdt><w:sdtPr><w:id w:val="1"/><w:tag w:val="entry"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>Old</w:t></w:r></w:sdtContent></w:sdt><!--retained--><?audit boundary?></w:p></w:body></w:document>`));
  if (codec !== "utf8") for (const [name, bytes] of parts) {
    const buffer = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), codec === "utf8-bom" ? "utf8" : "utf16le");
    if (codec === "utf16be") buffer.swap16();
    parts.set(name, new Uint8Array(buffer));
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, fresh().encoding, fresh());
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice();
  const model = await api.Document(input, fresh());
  await model.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  const noop = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer), limits);
  expect([...noop.keys()]).toEqual([...parts.keys()]);
  for (const [name, bytes] of parts) expect(Buffer.compare(Buffer.from(noop.get(name)!), Buffer.from(bytes)), name).toBe(0);
  memory.writeFileSync("/output", "");
  const value = "\ufeffliteral 海🌊 \ufeff", data = { values: [{ binding: "entry", value }] };
  const envelope = { version: 1, operations: [{ operation: "controls.set", arguments: { control: 1, text: value } }] };
  const json = JSON.stringify(operation === "batch" ? envelope : data);
  const text = profile === "one" ? "\ufeff" + json : profile === "two" ? "\ufeff\ufeff" + json : profile === "after-whitespace" ? " \ufeff" + json : profile === "comments" ? "/*not JSON*/" + json : profile === "trailing" ? json + "," : json;
  const payload = profile === "invalid-utf8" ? Uint8Array.from([0xc0, 0xaf]) : profile === "utf16le" || profile === "utf16be"
    ? new Uint8Array(Buffer.from("\ufeff" + json, "utf16le")) : new TextEncoder().encode(text);
  if (profile === "utf16be") Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).swap16();
  const allowed = profile === "none" || profile === "one";
  if (route.includes("sdk")) {
    if (allowed) {
      const parsed = api.parseDocxJson(payload, fresh().budget);
      const io = { ...fresh(), stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
      if (operation === "batch") await api.executeDocumentBatch(input, parsed as Parameters<typeof api.executeDocumentBatch>[1], { output: "-" }, io);
      else await api.applyDocumentTemplate(input, { data: parsed as Parameters<typeof api.applyDocumentTemplate>[1]["data"], output: "-" }, io);
    } else {
      let caught: unknown;
      try { api.parseDocxJson(payload, fresh().budget); } catch (error) { caught = error; }
      expect(caught).toMatchObject({ code: "usage", exitCode: 2 });
    }
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained forced destination");
    await fs.writeFile("/input 海.docx", input); await fs.writeFile("/output 海.docx", destination); await fs.writeFile("/payload JSON 海", payload);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits }) }));
    try {
      const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'";
      const flag = operation === "batch" ? "--ops-" : "--data-";
      const command = `docx ${operation === "batch" ? "batch" : "template apply"} '/input 海.docx' ${flag}${route.endsWith("inline") ? "json " + quote(text) : "file '/payload JSON 海'"} --output '/output 海.docx' --force --json`;
      const response = await shell.exec(command), result = JSON.parse(response.stdout);
      expect(response.exitCode, response.stdout + response.stderr).toBe(allowed ? 0 : 2);
      if (allowed) { expect(result).toMatchObject({ ok: true, errors: [] }); memory.writeFileSync("/output", await fs.readFile("/output 海.docx")); }
      else { expect(result).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "usage" }] }); expect(Buffer.compare(Buffer.from(await fs.readFile("/output 海.docx")), Buffer.from(destination))).toBe(0); }
      expect(Buffer.compare(Buffer.from(await fs.readFile("/input 海.docx")), Buffer.from(original))).toBe(0);
      expect(Buffer.compare(Buffer.from(await fs.readFile("/payload JSON 海")), Buffer.from(payload))).toBe(0);
    } finally { await shell.dispose(); }
  }
  if (allowed) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output, limits);
    expect([...after.keys()]).toEqual([...parts.keys()]);
    for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(Buffer.compare(Buffer.from(after.get(name)!), Buffer.from(bytes)), name).toBe(0);
    if (codec !== "utf8") expect([...after.get("word/document.xml")!.subarray(0, codec === "utf8-bom" ? 3 : 2)]).toEqual(codec === "utf8-bom" ? [239, 187, 191] : codec === "utf16le" ? [255, 254] : [254, 255]);
    const main = new TextDecoder(codec === "utf16le" ? "utf-16le" : codec === "utf16be" ? "utf-16be" : "utf-8").decode(after.get("word/document.xml"));
    expect(main).toContain("<!--retained--><?audit boundary?>");
    expect((await api.extractDocumentText(output, fresh())).text).toBe(value);
    expect((await api.inspectDocumentControls(output, {}, fresh())).items[0]).toMatchObject({ kind: "plain-text", value, placeholder: false });
    expect((await api.validateDocument(output, fresh())).valid).toBe(true);
  } else expect(memory.statSync("/output").size).toBe(0);
  expect(Buffer.compare(Buffer.from(input), Buffer.from(original))).toBe(0);
  expect(Buffer.compare(Buffer.from(memory.readFileSync("/input") as Buffer), Buffer.from(original))).toBe(0);
});
