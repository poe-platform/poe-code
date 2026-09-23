import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext as originalContext, textFixture } from "../tests/fixtures/text.js";

const compiled = await compiledPublicRuntime;
const variants = ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "prototype", "unlistedScalar"] as const;
const text = new TextEncoder(), context = { limits: originalContext.limits, signal: originalContext.signal, encoding: { order: "input", compression: "store" } as const };
const names = variants.map((_, index) => "Opaque" + index);
const field = (index: number) => "custom:" + names[index];
const destination = text.encode("Original retained destination海🌊");
function encode(value: string, codec: "utf8" | "utf16le" | "utf16be"): Uint8Array {
  if (codec === "utf8") return text.encode("\ufeff" + value);
  const bytes = Buffer.from("\ufeff" + value, "utf16le");
  if (codec === "utf16be") bytes.swap16();
  return new Uint8Array(bytes);
}
async function fixture(api: typeof source, strict: boolean, kind: "docx" | "dotx", codec: "utf8" | "utf16le" | "utf16be") {
  const archive = await api.readArchive(await textFixture('<w:p><w:r><w:t>Unselected海🌊</w:t></w:r></w:p>', {}, strict, { kind }), context);
  const office = strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/";
  const namespace = office + (strict ? "customProperties" : "custom-properties"), vt = office + "docPropsVTypes", part = "metadata/original-custom.xml";
  const opaque = variants.map((variant, index) => `<p:property fmtid='{D5CDD505-2E9C-101B-9397-08002B2CF9AE}' pid='${index + 3}' name='${names[index]}'><v:${variant}>7<!--retain ${index}--><?audit opaque?></v:${variant}></p:property>`);
  const payload = `<p:Properties xmlns:p='${namespace}' xmlns:v='${vt}'><p:property fmtid='{D5CDD505-2E9C-101B-9397-08002B2CF9AE}' pid='2' name='Witness'><v:lpwstr>Old</v:lpwstr></p:property>${opaque.join("")}<!--part retain--><?audit exact?></p:Properties>`;
  const parts = new Map(archive.members.map(member => [member.name, member.bytes]));
  const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
  types.insertChildren(types.root, `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>`);
  parts.set("[Content_Types].xml", types.serialize());
  const edges = new api.DocumentXmlEditor(parts.get("_rels/.rels")!);
  edges.insertChildren(edges.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="originalCustom" Type="${office}relationships/custom-properties" Target="${part}"/>`);
  parts.set("_rels/.rels", edges.serialize()); parts.set(part, text.encode(payload));
  for (const [name, bytes] of parts) parts.set(name, encode(new TextDecoder().decode(bytes), codec));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  return { input, parts, part, vt, opaque, memory, sink: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
}
for (const runtime of ["source", "compiled"] as const) for (const strict of [false, true])
for (const kind of ["docx", "dotx"] as const) for (const codec of ["utf8", "utf16le", "utf16be"] as const) {
  const api = runtime === "source" ? source : compiled;
  for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
  it(`unknown native custom variants never acquire inherited object-key types; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
    const { input, part, vt, memory } = await fixture(api, strict, kind, codec);
    const records: unknown[] = [];
    if (route === "sdk") {
      records.push(...(await api.inspectDocumentProperties(input, {}, context)).items);
      for (let index = 0; index < variants.length; index++) records.push(...(await api.inspectDocumentProperties(input, { name: field(index) }, context)).items);
    } else if (route === "sdk-batch") {
      const result = await api.executeDocumentBatch(input, { version: 1, operations: [{ operation: "properties.list", arguments: {} }, ...names.map((_, index) => ({ operation: "properties.get" as const, arguments: { name: field(index) } }))] }, { dryRun: true }, context);
      records.push(...(result.results[0]!.data as { items: unknown[] }).items);
      for (const entry of result.results.slice(1)) records.push((entry.data as { item: unknown }).item);
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
      try {
        if (route === "cli") {
          const list = await shell.exec("docx properties list /input --json"); expect(list.exitCode, list.stdout + list.stderr).toBe(0); records.push(...JSON.parse(list.stdout).data.items);
          for (let index = 0; index < variants.length; index++) { const read = await shell.exec(`docx properties get /input --name ${field(index)} --json`); expect(read.exitCode, read.stdout + read.stderr).toBe(0); records.push(JSON.parse(read.stdout).data.item); }
        } else {
          const batch = { version: 1, operations: [{ operation: "properties.list", arguments: {} }, ...names.map((_, index) => ({ operation: "properties.get", arguments: { name: field(index) } }))] };
          const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch)}' --dry-run --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
          const results = JSON.parse(result.stdout).data.results; records.push(...results[0].data.items); for (const entry of results.slice(1)) records.push(entry.data.item);
        }
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    for (let index = 0; index < variants.length; index++) {
      const matches = (records as source.PropertyResourceRecord[]).filter(item => item.name === field(index)); expect(matches).toHaveLength(2);
      for (const item of matches) expect(item).toMatchObject({ kind: "property", name: field(index), support: "preserve", properties: [], location: { value: { part: "/" + part } }, references: [{ owner: "/", id: "originalCustom", type: (strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/") + "relationships/custom-properties", target: part, external: false }], details: { kind: "property", group: "custom", storedType: { namespace: vt, localName: variants[index] }, id: String(index + 3) } });
    }
    expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(memory.statSync("/output").size).toBe(0);
  });
  for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const) for (const action of ["set", "remove"] as const)
  it(`unknown native custom variants reject typed ${action} atomically; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
    const { input, memory, sink } = await fixture(api, strict, kind, codec);
    for (let index = 0; index < variants.length; index++) {
      const arguments_ = { name: field(index), ...(action === "set" ? { value: 8, type: "integer" as const } : {}) };
      if (route === "sdk") await expect(api.editDocumentProperties(input, { operation: action === "set" ? "properties.set" : "properties.remove", ...arguments_, output: "-" } as source.PropertyEditOptions, { ...context, stdout: sink })).rejects.toMatchObject({ code: "unsupported-edit" });
      else if (route === "sdk-batch") await expect(api.executeDocumentBatch(input, { version: 1, operations: [{ operation: action === "set" ? "properties.set" : "properties.remove", arguments: arguments_ }] }, { output: "-" }, { ...context, stdout: sink })).rejects.toMatchObject({ code: "unsupported-edit", operationIndex: 0 });
      else {
        const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
        try {
          const batch = { version: 1, operations: [{ operation: "properties." + action, arguments: arguments_ }] };
          const command = route === "cli" ? `docx properties ${action} /input --name ${field(index)}${action === "set" ? " --value 8 --type integer" : ""}` : `docx batch /input --ops-json '${JSON.stringify(batch)}'`;
          const result = await shell.exec(command + " --output /destination --force --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(1);
          expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: "unsupported-edit" }] });
          expect(JSON.parse(result.stdout).data).toBe(null);
          if (route === "cli-batch") expect(JSON.parse(result.stdout).errors[0].operationIndex).toBe(0);
          expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/destination")).toEqual(destination);
        } finally { await shell.dispose(); }
      }
      expect(memory.statSync("/output").size).toBe(0); expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
    }
  });
  for (const route of ["model", "sdk", "sdk-batch", "cli", "cli-batch"] as const)
  it(`opaque native custom variants retain raw payloads and complete relationship membership; runtime=${runtime}; strict=${strict}; kind=${kind}; codec=${codec}; route=${route}`, async () => {
    const { input, parts, part, opaque, memory, sink } = await fixture(api, strict, kind, codec);
    if (route === "model") { const document = await api.Document(input, context); await document.save(sink); expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input); }
    else if (route === "sdk") await api.editDocumentProperties(input, { operation: "properties.set", name: "custom:Witness", value: "Fresh海🌊", output: "-" }, { ...context, stdout: sink });
    else if (route === "sdk-batch") await api.executeDocumentBatch(input, { version: 1, operations: [{ operation: "properties.set", arguments: { name: "custom:Witness", value: "Fresh海🌊" } }] }, { output: "-" }, { ...context, stdout: sink });
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
      try { const batch = { version: 1, operations: [{ operation: "properties.set", arguments: { name: "custom:Witness", value: "Fresh海🌊" } }] }; const command = route === "cli" ? "docx properties set /input --name custom:Witness --value 'Fresh海🌊'" : `docx batch /input --ops-json '${JSON.stringify(batch)}'`; const result = await shell.exec(command + " --output /destination --force --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/destination")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
    }
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = new Map((await api.readArchive(output, context)).members.map(member => [member.name, member.bytes]));
    expect([...after.keys()]).toEqual([...parts.keys()]);
    for (const [name, bytes] of parts) if (route === "model" || name !== part) expect(after.get(name), name).toEqual(bytes);
    const payload = new TextDecoder(codec === "utf8" ? "utf-8" : codec === "utf16le" ? "utf-16le" : "utf-16be", { fatal: true }).decode(after.get(part));
    for (const retained of opaque) expect(payload).toContain(retained);
    expect(payload).toContain('<!--part retain--><?audit exact?>');
    expect([...after.get(part)!.subarray(0, codec === "utf8" ? 3 : 2)]).toEqual([...parts.get(part)!.subarray(0, codec === "utf8" ? 3 : 2)]);
    if (route !== "model") expect((await api.inspectDocumentProperties(output, { name: "custom:Witness" }, context)).items[0]!.properties[0]!.value).toBe("Fresh海🌊");
    expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
  });
}
