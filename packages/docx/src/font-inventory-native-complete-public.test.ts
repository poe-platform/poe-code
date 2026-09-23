import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Ajv2020 } from "ajv/dist/2020.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const api = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { textContext as fixtureContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const textContext = { limits: fixtureContext.limits, signal: fixtureContext.signal };
const encode = (value: string) => new TextEncoder().encode(value);
const validator = new Ajv2020({ strict: false, validateFormats: false });
const fontSchema = api.getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "fonts.list" } })!.data as compiledTypes.DocxSchemaData;
const validateFontResult = validator.compile(fontSchema.operations[0]!.result);
const batchSchema = api.getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "batch" } })!.data as compiledTypes.DocxSchemaData;
const batchVariants = (batchSchema.operations[0]!.result.oneOf![0]!.properties!.data!.properties!.results!.items as compiledTypes.DocxJsonSchema).oneOf!;
const validateFontBatchResult = validator.compile(batchVariants.find(variant => variant.properties!.operation!.const === "fonts.list")!);
async function fixture(strict: boolean, kind: "docx" | "dotx", parameter: string, body = '<w:p><w:r><w:t>Retained coast 海 🌊</w:t></w:r></w:p>') {
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const relationship = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const input = await textFixture(body, { fontTable: { kind: "fontTable", xml: `<w:fonts xmlns:w="${w}" xmlns:r="${r}"><w:font w:name="Original coast"><w:embedRegular r:id="font" w:fontKey="{38E185E1-4A31-4AB8-A420-FA578658AA11}" w:subsetted="1"/></w:font><!--retain--><?audit exact?></w:fonts>` } }, strict, { kind });
  const archive = await api.readArchive(input, textContext), parts = readPackage(input);
  const tableRels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="font" Type="${relationship}/font" Target="../assets/coast.bin"/></Relationships>`;
  const files = new Map(parts);
  files.set("word/_rels/fontTable.xml.rels", encode(tableRels));
  files.set("assets/coast.bin", new Uint8Array([0, 1, 2, 255, 42, 17]));
  files.set("assets/orphan.bin", new Uint8Array([99, 21, 0, 254]));
  const types = new api.DocumentXmlEditor(files.get("[Content_Types].xml")!);
  types.insertChildren(types.root, ["coast", "orphan"].map(name => `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/assets/${name}.bin" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont${parameter}"/>`).join(""));
  files.set("[Content_Types].xml", types.serialize());
  expect(new TextDecoder().decode(files.get("word/fontTable.xml"))).toContain(namespace);
  const memory = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ ...archive, members: [...files].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-03-04T05:06:08Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(memory.readFileSync("/input") as Buffer);
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const parameter of ["", ";original=retained"]) for (const selection of ["package", "paragraph"] as const)
for (const route of ["sdk", "cli", "batch"] as const)
  it(`native ${route} inventories inert declared fonts and retains bytes; ${selection}; MIME=${parameter}; ${kind}; strict=${strict}`, async () => {
    const input = await fixture(strict, kind, parameter), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    const options = selection === "paragraph" ? { paragraph: 1 } : {};
    let items: compiledTypes.FontInventoryData["items"];
    if (route === "sdk") items = (await api.inspectDocumentFonts(input, options, textContext)).items;
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const operations = { version: 1, operations: [{ operation: "fonts.list", arguments: options }] };
        await fs.writeFile("/operations", encode(JSON.stringify(operations)));
        const command = route === "cli" ? `docx fonts list /input ${selection === "paragraph" ? "--paragraph 1" : ""} --json` : "docx batch /input --ops-file /operations --json";
        const result = await shell.exec(command); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const envelope = JSON.parse(result.stdout); expect(envelope.affected).toBe(0);
        const validate = route === "cli" ? validateFontResult : validateFontBatchResult;
        expect(validate(route === "cli" ? envelope : envelope.data.results[0]), JSON.stringify(validate.errors)).toBe(true);
        items = route === "cli" ? envelope.data.items : envelope.data.results[0].data.items;
        if (route === "batch") expect(envelope.data.publication).toBeNull();
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    expect(items.map(item => item.name)).toEqual(selection === "package" ? ["/assets/coast.bin", "/assets/orphan.bin", "/word/fontTable.xml"] : ["/assets/coast.bin", "/word/fontTable.xml"]);
    const before = readPackage(input);
    for (const item of items) {
      expect(item).toMatchObject({ kind: "fonts", properties: [], support: item.name === "/word/fontTable.xml" ? "read" : "preserve", location: { kind: "part", value: { path: [], range: null, generation: 0 } }, details: { kind: "fonts" } });
      for (const part of item.details.parts) {
        const bytes = before.get(part.name.slice(1))!;
        expect(part.bytes).toBe(bytes.length);
        expect(part.sha256).toBe([...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, "0")).join(""));
      }
    }
    expect(items.find(item => item.name === "/assets/coast.bin")!.references).toContainEqual({ owner: "/word/fontTable.xml", id: "font", type: `${strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r}/font`, target: "../assets/coast.bin", external: false });
    expect(items.find(item => item.name === "/word/fontTable.xml")!.details.parts.map(part => part.name)).toEqual(["/assets/coast.bin", "/word/fontTable.xml"]);
    const inspected = await api.inspectDocument(input, textContext);
    expect(inspected.fontResources.fontTables[0]!.fonts[0]!.embedded[0]).toMatchObject({ target: "/assets/coast.bin", status: "resolved" });
    expect(inspected.fontResources).toMatchObject({ availability: null, licensing: null, embeddedFontMutation: "unsupported" });
    await api.replaceDocumentText(input, { find: "Retained", with: "Changed", first: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
    await expect(api.inspectDocumentFonts(output, { select: items[0]!.location.token }, textContext)).rejects.toMatchObject({ code: "stale-selection" });
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const selection of ["section", "section-run", "part-token"] as const)
for (const route of ["sdk", "cli", "batch"] as const)
  it(`native ${route} font inventory resolves ${selection} without mutating storage; ${kind}; strict=${strict}`, async () => {
    const input = await fixture(strict, kind, ""), locations = await api.openDocumentLocations(input, textContext);
    const options = selection === "section" ? { section: 1 } : selection === "section-run" ? { section: 1, paragraph: 1, run: 1 } : { select: locations.list("part").find(part => part.value.part === "/word/fontTable.xml")!.token };
    const expected = ["/assets/coast.bin", "/word/fontTable.xml"];
    if (route === "sdk") expect((await api.inspectDocumentFonts(input, options, textContext)).items.map(item => item.name)).toEqual(expected);
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations: [{ operation: "fonts.list", arguments: options }] })));
        const flags = selection === "section" ? "--section 1" : selection === "section-run" ? "--section 1 --paragraph 1 --run 1" : "--select " + options.select;
        const result = await shell.exec(route === "cli" ? "docx fonts list /input " + flags + " --json" : "docx batch /input --ops-file /ops --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const envelope = JSON.parse(result.stdout);
        expect((route === "cli" ? envelope.data.items : envelope.data.results[0].data.items).map((item: compiledTypes.FontInventoryRecord) => item.name)).toEqual(expected);
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  it(`native font inventory refuses a missing section even with a valid descendant; ${kind}; strict=${strict}`, async () => {
    const input = await fixture(strict, kind, "");
    await expect(api.inspectDocumentFonts(input, { section: 999, paragraph: 1, run: 1 }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  it(`native font inventory owns bytes before asynchronous admission; ${kind}; strict=${strict}`, async () => {
    const original = await fixture(strict, kind, ""), caller = new Uint8Array(original);
    const pending = api.inspectDocumentFonts(caller, {}, textContext);
    caller.fill(0);
    expect((await pending).items.map(item => item.name)).toEqual(["/assets/coast.bin", "/assets/orphan.bin", "/word/fontTable.xml"]);
    expect(caller.every(byte => byte === 0)).toBe(true);
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  it(`native font inventory empty reads and exact match limits are bounded; ${kind}; strict=${strict}`, async () => {
    const empty = await textFixture('<w:p><w:r><w:t>Ordinary coast</w:t></w:r></w:p>', {}, strict, { kind });
    expect(await api.inspectDocumentFonts(empty, { limit: [{ name: "matches", value: 0 }] }, textContext)).toEqual({ items: [] });
    const input = await fixture(strict, kind, "");
    expect((await api.inspectDocumentFonts(input, { limit: [{ name: "matches", value: 3 }] }, textContext)).items).toHaveLength(3);
    await expect(api.inspectDocumentFonts(input, { limit: [{ name: "matches", value: 2 }] }, textContext)).rejects.toMatchObject({ code: "limit-exceeded" });
    await expect(api.inspectDocumentFonts(input, { run: 1 }, textContext)).rejects.toMatchObject({ code: "usage" });
    await expect(api.inspectDocumentFonts(input, { output: "-" } as never, textContext)).rejects.toMatchObject({ code: "usage" });
    await expect(api.inspectDocumentFonts(input, { limit: [{ name: "serializedOutput", value: 1 }] }, textContext)).rejects.toMatchObject({ code: "limit-exceeded" });
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  it(`native font inventory reports stored font-table graph references; ${kind}; strict=${strict}`, async () => {
    const input = await fixture(strict, kind, ""), items = (await api.inspectDocumentFonts(input, {}, textContext)).items;
    const relationship = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
    expect(items.find(item => item.name === "/word/fontTable.xml")!.references).toContainEqual({ owner: "/word/fontTable.xml", id: "font", type: relationship + "/font", target: "../assets/coast.bin", external: false });
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli", "batch"] as const)
for (const selection of ["body", "all-stories", "headers", "all", "header-paragraph", "footnote", "endnote"] as const)
  it(`native ${route} font inventory rejects global ${selection} scope/cardinality before acquisition; ${kind}; strict=${strict}`, async () => {
    const options = selection === "all" ? { all: true } : selection === "header-paragraph" ? { scope: "headers" as const, paragraph: 1 } : selection === "footnote" || selection === "endnote" ? { scope: selection === "footnote" ? "footnotes" as const : "endnotes" as const, note: 1 } : { scope: selection };
    if (route === "sdk") await expect(api.inspectDocumentFonts(new Uint8Array(), options, textContext)).rejects.toMatchObject({ code: "usage" });
    else {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations: [{ operation: "fonts.list", arguments: options }] })));
        const flags = selection === "all" ? "--all" : selection === "header-paragraph" ? "--scope headers --paragraph 1" : selection === "footnote" || selection === "endnote" ? `--scope ${selection === "footnote" ? "footnotes" : "endnotes"} --note 1` : "--scope " + selection;
        const result = await shell.exec(route === "cli" ? "docx fonts list /missing " + flags + " --json" : "docx batch /missing --ops-file /ops --json");
        expect(result.exitCode).toBe(2); expect(JSON.parse(result.stdout).errors[0].code).toBe("usage");
      } finally { await shell.dispose(); }
    }
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli", "batch"] as const)
  it(`native ${route} font revision ordinal never resolves a bookmark annotation; ${kind}; strict=${strict}`, async () => {
    const input = await fixture(strict, kind, "", '<w:p><w:bookmarkStart w:id="4" w:name="retained"/><w:r><w:t>Coast</w:t></w:r><w:bookmarkEnd w:id="4"/></w:p>');
    if (route === "sdk") await expect(api.inspectDocumentFonts(input, { revision: 1 }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations: [{ operation: "fonts.list", arguments: { revision: 1 } }] })));
        const result = await shell.exec(route === "cli" ? "docx fonts list /input --revision 1 --json" : "docx batch /input --ops-file /ops --json");
        expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout).errors[0].code).toBe("missing-selection");
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli", "batch"] as const) for (const revision of [1, 2])
  it(`native ${route} font revision ${revision} counts only review owners after a bookmark; ${kind}; strict=${strict}`, async () => {
    const input = await fixture(strict, kind, "", '<w:p><w:bookmarkStart w:id="4" w:name="retained"/><w:r><w:t>Before</w:t></w:r><w:bookmarkEnd w:id="4"/><w:ins w:id="8" w:author="" w:date="2026-03-04T05:06:07Z"><w:r><w:t>Inserted</w:t></w:r></w:ins></w:p>');
    const expected = ["/assets/coast.bin", "/word/fontTable.xml"];
    if (route === "sdk") {
      if (revision === 2) await expect(api.inspectDocumentFonts(input, { revision }, textContext)).rejects.toMatchObject({ code: "missing-selection" });
      else expect((await api.inspectDocumentFonts(input, { revision }, textContext)).items.map(item => item.name)).toEqual(expected);
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations: [{ operation: "fonts.list", arguments: { revision } }] })));
        const result = await shell.exec(route === "cli" ? `docx fonts list /input --revision ${revision} --json` : "docx batch /input --ops-file /ops --json");
        const envelope = JSON.parse(result.stdout);
        if (revision === 2) { expect(result.exitCode).toBe(1); expect(envelope.errors[0].code).toBe("missing-selection"); }
        else { expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect((route === "cli" ? envelope.data.items : envelope.data.results[0].data.items).map((item: compiledTypes.FontInventoryRecord) => item.name)).toEqual(expected); }
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli", "batch"] as const)
  it(`native ${route} font closure resolves a percent-encoded Unicode main owner; ${kind}; strict=${strict}`, async () => {
    const original = await fixture(strict, kind, ""), archive = await api.readArchive(original, textContext);
    const files = readPackage(original), encoded = "%E6%B5%B7.xml";
    files.set("word/" + encoded, files.get("word/document.xml")!); files.delete("word/document.xml");
    files.set("word/_rels/" + encoded + ".rels", files.get("word/_rels/document.xml.rels")!); files.delete("word/_rels/document.xml.rels");
    for (const name of ["[Content_Types].xml", "_rels/.rels"]) files.set(name, encode(new TextDecoder().decode(files.get(name)).replaceAll("document.xml", encoded)));
    const memory = Volume.fromJSON({ "/input": "" });
    await api.writeArchive({ ...archive, members: [...files].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-03-04T05:06:08Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
    const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
    const expected = ["/assets/coast.bin", "/word/fontTable.xml"];
    if (route === "sdk") expect((await api.inspectDocumentFonts(input, { paragraph: 1 }, textContext)).items.map(item => item.name)).toEqual(expected);
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations: [{ operation: "fonts.list", arguments: { paragraph: 1 } }] })));
        const result = await shell.exec(route === "cli" ? "docx fonts list /input --paragraph 1 --json" : "docx batch /input --ops-file /ops --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const envelope = JSON.parse(result.stdout);
        expect((route === "cli" ? envelope.data.items : envelope.data.results[0].data.items).map((item: compiledTypes.FontInventoryRecord) => item.name)).toEqual(expected);
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
  });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli", "batch"] as const) for (const ordering of ["parts", "references"] as const)
  it(`native ${route} font ${ordering} use Unicode scalar order across BMP and supplementary names; ${kind}; strict=${strict}`, async () => {
    const original = await fixture(strict, kind, ""), archive = await api.readArchive(original, textContext), files = readPackage(original);
    const relationship = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
    const types = new api.DocumentXmlEditor(files.get("[Content_Types].xml")!), edges = new api.DocumentXmlEditor(files.get("word/_rels/fontTable.xml.rels")!);
    const declarations: string[] = [], relationships: string[] = [];
    for (const name of ["豈", "🌊"]) {
      files.set("assets/" + name + ".bin", new Uint8Array([31, 42]));
      declarations.push(`<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/assets/${name}.bin" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>`);
      relationships.push(`<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="${name}" Type="${relationship}/font" Target="../assets/${encodeURIComponent(name)}.bin"/>`);
    }
    types.insertChildren(types.root, declarations.join("")); edges.insertChildren(edges.root, relationships.join(""));
    files.set("[Content_Types].xml", types.serialize()); files.set("word/_rels/fontTable.xml.rels", edges.serialize());
    const memory = Volume.fromJSON({ "/input": "" });
    await api.writeArchive({ ...archive, members: [...files].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-03-04T05:06:08Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
    const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
    let items: compiledTypes.FontInventoryData["items"];
    if (route === "sdk") items = (await api.inspectDocumentFonts(input, {}, textContext)).items;
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations: [{ operation: "fonts.list", arguments: {} }] })));
        const result = await shell.exec(route === "cli" ? "docx fonts list /input --json" : "docx batch /input --ops-file /ops --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout);
        items = route === "cli" ? envelope.data.items : envelope.data.results[0].data.items;
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    const table = items.find(item => item.name === "/word/fontTable.xml")!;
    if (ordering === "parts") {
      expect(items.map(item => item.name)).toEqual(["/assets/coast.bin", "/assets/orphan.bin", "/assets/豈.bin", "/assets/🌊.bin", "/word/fontTable.xml"]);
      expect(table.details.parts.map(part => part.name)).toEqual(["/assets/coast.bin", "/assets/豈.bin", "/assets/🌊.bin", "/word/fontTable.xml"]);
    } else expect(table.references.filter(edge => edge.owner === "/word/fontTable.xml").map(edge => edge.id)).toEqual(["font", "豈", "🌊"]);
  });
