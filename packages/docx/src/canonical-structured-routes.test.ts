import { Volume } from "memfs";
import { expect, it, onTestFinished } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, Inches, createDocxInspectionCommandEngine, editDocumentFields, editDocumentTables, inspectDocumentFields, replaceDocumentText, writeArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

type Node = ReturnType<typeof xmlStructure>;
const nodes = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
const encode = (text: string) => new TextEncoder().encode(text);
async function fixture(strict: boolean, kind: "docx" | "dotx", encoded: boolean, variant = "simple") {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const main = encoded ? "records/r%C3%A9sum%C3%A9.xml" : "records/résumé.xml";
  const header = encoded ? "records/t%C3%AAte.xml" : "records/tête.xml";
  const relName = "records/_rels/" + main.slice(8) + ".rels";
  const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
  const simple = '<w:fldSimple w:instr=" PAGE ">' + run("7") + '</w:fldSimple>';
  const inactive = '<w:fldSimple w:instr=" INCLUDETEXT file:///never-acquire ">' + run("Inactive") + '</w:fldSimple>';
  const field = variant === "complex" ? '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PA</w:instrText></w:r><w:r><w:instrText xml:space="preserve">GE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + run("7") + '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    : variant === "choice" ? '<mc:AlternateContent><mc:Choice Requires="w">' + simple + '</mc:Choice><mc:Fallback>' + inactive + '</mc:Fallback></mc:AlternateContent>'
    : variant === "fallback" ? '<mc:AlternateContent><mc:Choice Requires="f">' + inactive + '</mc:Choice><mc:Fallback>' + simple + '</mc:Fallback></mc:AlternateContent>'
    : variant === "process" ? '<f:wrapper>' + simple + '</f:wrapper>' : variant === "inert" ? inactive : simple;
  const table = '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="2880"/></w:tblPr><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="1440"/></w:tblGrid><w:tr>' + ["A", "B"].map(text => '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="1440"/></w:tcPr><w:p>' + run(text) + '</w:p></w:tc>').join("") + '</w:tr></w:tbl>';
  const markers = ['<!--original audit-->', '<?audit unchanged?>', '<f:record f:value="preserve"/>'];
  const content = '<w:p>' + run("Original") + field + '</w:p>' + markers.join("") + table;
  const ns = `xmlns:w="${w}" xmlns:r="${r}" xmlns:f="urn:original:record" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:wrapper"`;
  const rel = (body: string) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + body + '</Relationships>';
  const edge = (id: string, role: string, target: string) => `<Relationship Id="${id}" Type="${r}/${role}" Target="${target}"/>`;
  const members = new Map(Object.entries({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + `<Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml"/><Override PartName="/${header}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`,
    "_rels/.rels": rel(edge("main", "officeDocument", main)),
    [main]: `<w:document ${ns}><w:body>${content}<w:sectPr><w:headerReference w:type="default" r:id="head"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:left="1440" w:right="1440" w:top="1440" w:bottom="1440"/></w:sectPr></w:body></w:document>`,
    [header]: `<w:hdr ${ns}>${content}</w:hdr>`,
    [relName]: rel(edge("head", "header", header.slice(8))),
    "audit/unrelated.xml": '<audit><!--exact bytes--><entry>Stored</entry></audit>'
  }).map(([name, value]) => [name, encode(value)]));
  const memory = Volume.fromJSON({ "/zip": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/zip", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(memory.readFileSync("/zip") as Buffer), members, main, header, markers, field, table, inactive, w };
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const encoded of [false, true]) for (const scope of ["body", "headers"] as const) for (const operation of ["table-add", "table-set", "field-list", "field-add", "field-set"] as const) for (const route of (operation.startsWith("table") ? ["model", "sdk", "shell"] as const : ["sdk", "shell"] as const)) it(`${route} ${operation} resolves ${scope} identities; ${kind} strict=${strict} encoded=${encoded}`, async () => {
  const source = await fixture(strict, kind, encoded);
  const { input, members, main, header, markers, field, table, w } = source;
  const target = scope === "body" ? main : header;
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  let read: Awaited<ReturnType<typeof inspectDocumentFields>> | undefined;
  if (route === "model") {
    const document = await Document(input, textContext);
    const owner = scope === "body" ? document : document.sections[0]!.header;
    if (operation === "table-add") {
      if (scope === "body") document.add_table(1, 2);
      else document.sections[0]!.header.add_table(1, 2, Inches(2));
    } else owner.tables[0]!.cell(0, 0).text = "Revised";
    await document.save(context.stdout);
  } else if (route === "sdk") {
    const common = { scope, output: "-" };
    if (operation === "field-list") read = await inspectDocumentFields(input, { scope }, textContext);
    else {
      const result = operation === "table-add" ? await editDocumentTables(input, { operation: "tables.add", options: { ...common, paragraph: 1, rows: 1, cols: 2 } }, context)
        : operation === "table-set" ? await editDocumentTables(input, { operation: "tables.set", options: { ...common, table: 1, cell: "A1", text: "Revised" } }, context)
        : operation === "field-add" ? await editDocumentFields(input, { operation: "fields.add", options: { ...common, paragraph: 1, kind: "PAGE", result: "9" } }, context)
        : await editDocumentFields(input, { operation: "fields.set", options: { ...common, field: 1, kind: "NUMPAGES", result: "  Revised  ", update: true } }, context);
      expect(result.changed).toBe(true); expect(result.changes).toHaveLength(1);
      expect(result.changes[0]!.after.value.part).toBe("/" + decodeURI(target));
    }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const path = operation === "table-add" ? "tables add --paragraph 1 --rows 1 --cols 2" : operation === "table-set" ? "tables set --table 1 --cell A1 --text Revised"
      : operation === "field-list" ? "fields list" : operation === "field-add" ? "fields add --paragraph 1 --kind PAGE --result 9" : "fields set --field 1 --kind NUMPAGES --result '  Revised  ' --update true";
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    onTestFinished(() => shell.dispose());
    const result = await shell.exec(`docx ${path} /input --scope ${scope} ${operation === "field-list" ? "--json" : "--output - > /output"}`);
    expect(result.exitCode, result.stderr).toBe(0);
    if (operation === "field-list") {
      const envelope = JSON.parse(result.stdout);
      expect(envelope).toMatchObject({ operation: "fields.list", ok: true, affected: 0, errors: [] });
      read = envelope.data;
    } else { expect(result.stdout).toBe(""); memory.writeFileSync("/output", await fs.readFile("/output")); }
    expect(await fs.readFile("/input")).toEqual(input);
  }
  if (operation === "field-list") {
    expect(read!.items).toHaveLength(1);
    expect(read!.items[0]).toMatchObject({ kind: "PAGE", instruction: " PAGE ", result: "7", form: "simple", update: false, location: { value: { part: "/" + decodeURI(target) } } });
    expect(memory.readFileSync("/output")).toHaveLength(0);
  } else {
    const bytes = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(bytes);
    expect([...after.keys()]).toEqual([...members.keys()]);
    for (const [name, original] of members) if (name !== target) expect(after.get(name), name).toEqual(original);
    const xml = new TextDecoder().decode(after.get(target));
    let offset = -1;
    for (const marker of markers) { const next = xml.indexOf(marker); expect(next).toBeGreaterThan(offset); offset = next; }
    if (operation !== "table-set") expect(xml).toContain(table);
    if (operation !== "field-set") expect(xml).toContain(field);
    const tree = nodes(xmlStructure(after.get(target)!));
    const tables = tree.filter(node => node.name === `{${w}}tbl`);
    expect(tables).toHaveLength(operation === "table-add" ? 2 : 1);
    const fields = tree.filter(node => node.name === `{${w}}fldSimple`);
    expect(fields).toHaveLength(operation === "field-add" ? 2 : 1);
    expect(fields.map(node => node.attributes[`{${w}}instr`]!.trim())).toEqual(operation === "field-add" ? ["PAGE", "PAGE"] : [operation === "field-set" ? "NUMPAGES" : "PAGE"]);
    if (operation === "field-set") {
      expect(fields[0]!.attributes[`{${w}}dirty`]).toBe("true");
      const text = nodes(fields[0]!).find(node => node.name === `{${w}}t`)!;
      expect(text.children).toEqual(["  Revised  "]);
      expect(text.attributes["{http://www.w3.org/XML/1998/namespace}space"]).toBe("preserve");
    }
    if (operation === "field-add") expect(nodes(fields[1]!).find(node => node.name === `{${w}}t`)!.children).toEqual(["9"]);
    const reopened = await Document(bytes, textContext);
    expect(String(reopened.part.partname)).toBe("/records/résumé.xml");
    const owner = scope === "body" ? reopened : reopened.sections[0]!.header;
    expect(owner.tables).toHaveLength(operation === "table-add" ? 2 : 1);
    const originalIndex = operation === "table-add" && route !== "model" ? 1 : 0;
    expect(owner.tables[originalIndex]!.cell(0, 0).text).toBe(operation === "table-set" ? "Revised" : "A");
    expect(owner.tables[originalIndex]!.cell(0, 1).text).toBe("B");
    if (operation === "table-add") expect(owner.tables[1 - originalIndex]!.rows[0]!.cells.map(cell => cell.text)).toEqual(["", ""]);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const scope of ["body", "headers"] as const) for (const route of ["sdk", "shell"] as const) for (const variant of ["complex", "choice", "fallback", "process", "inert"] as const) it(`${route} reads and ${variant === "inert" ? "rejects affected edits and preserves" : "edits"} encoded ${variant} fields in ${scope}; ${kind} strict=${strict}`, async () => {
  const { input, members, main, header, field, table, markers, w } = await fixture(strict, kind, true, variant);
  const refusal = variant === "inert";
  const target = scope === "body" ? main : header;
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
  const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  onTestFinished(() => shell.dispose());
  const read = route === "sdk" ? await inspectDocumentFields(input, { scope }, textContext) : JSON.parse((await shell.exec(`docx fields list /input --scope ${scope} --json`)).stdout).data;
  expect(read.items).toHaveLength(1);
  expect(read.items[0]).toMatchObject({ kind: variant === "inert" ? "INCLUDETEXT" : "PAGE", result: variant === "inert" ? "Inactive" : "7", form: variant === "complex" ? "complex" : "simple", location: { value: { part: "/" + decodeURI(target) } } });
  if (route === "sdk") {
    const edit = editDocumentFields(input, { operation: "fields.set", options: { scope, field: 1, result: "Revised", kind: "NUMPAGES", update: true, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    if (refusal) await expect(edit).rejects.toMatchObject({ code: "unsupported-edit" });
    else expect((await edit).changes).toHaveLength(1);
  } else {
    const result = await shell.exec(`docx fields set /input --scope ${scope} --field 1 --result Revised --kind NUMPAGES --update true --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(refusal ? 1 : 0);
    if (refusal) expect(result.stderr).toContain("unsupported-edit");
    expect(result.stdout).toBe("");
    memory.writeFileSync("/output", await fs.readFile("/output"));
  }
  if (refusal) {
    expect(memory.readFileSync("/output")).toHaveLength(0);
    if (route === "sdk") await replaceDocumentText(input, { scope, paragraph: 1, find: "Original", with: "Retained", first: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    else {
      const result = await shell.exec(`docx text replace /input --scope ${scope} --paragraph 1 --find Original --with Retained --first --output - > /preserved`);
      expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
      memory.writeFileSync("/output", await fs.readFile("/preserved"));
    }
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), parts = readPackage(output);
    expect([...parts.keys()]).toEqual([...members.keys()]);
    for (const [name, bytes] of members) if (name !== target) expect(parts.get(name), name).toEqual(bytes);
    const xml = new TextDecoder().decode(parts.get(target));
    expect(xml).toContain(field); expect(xml).toContain(table); expect(xml).toContain(">Retained<");
    for (const marker of markers) expect(xml).toContain(marker);
    expect(String((await Document(output, textContext)).part.partname)).toBe("/records/résumé.xml");
  } else {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), parts = readPackage(output);
    expect([...parts.keys()]).toEqual([...members.keys()]);
    for (const [name, bytes] of members) if (name !== target) expect(parts.get(name), name).toEqual(bytes);
    const xml = new TextDecoder().decode(parts.get(target));
    expect(xml).toContain(table); for (const marker of markers) expect(xml).toContain(marker);
    if (variant === "choice" || variant === "fallback") {
      expect(xml).toContain('<w:fldSimple w:instr=" INCLUDETEXT file:///never-acquire "><w:r><w:t>Inactive</w:t></w:r></w:fldSimple>');
      expect(xml).toContain('<mc:Choice Requires="' + (variant === "choice" ? "w" : "f") + '">');
      expect(xml).toContain('<mc:Fallback>');
    }
    if (variant === "process") expect(xml).toContain('<f:wrapper>');
    const tree = nodes(xmlStructure(parts.get(target)!));
    if (variant === "complex") {
      expect(tree.filter(n => n.name === `{${w}}instrText`).map(n => n.children.join("")).join("").trim()).toBe("NUMPAGES");
      expect(tree.filter(n => n.name === `{${w}}fldChar`).map(n => n.attributes[`{${w}}fldCharType`])).toEqual(["begin", "separate", "end"]);
    } else expect(tree.some(n => n.name === `{${w}}fldSimple` && n.attributes[`{${w}}instr`]!.trim() === "NUMPAGES")).toBe(true);
    expect(tree.some(n => n.name === `{${w}}t` && n.children.join("") === "Revised")).toBe(true);
    await fs.writeFile("/saved", output);
    const reopened = route === "sdk" ? await inspectDocumentFields(output, { scope }, textContext) : JSON.parse((await shell.exec(`docx fields list /saved --scope ${scope} --json`)).stdout).data;
    expect(reopened.items).toHaveLength(1); expect(reopened.items[0]).toMatchObject({ kind: "NUMPAGES", result: "Revised", update: true });
    expect(String((await Document(output, textContext)).part.partname)).toBe("/records/résumé.xml");
  }
  expect(await fs.readFile("/input")).toEqual(input);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const scope of ["body", "headers"] as const) for (const route of ["sdk", "shell"] as const) for (const category of ["toc", "caption", "static"] as const) it(`${route} creates and retains encoded ${category} in ${scope}; ${kind} strict=${strict}`, async () => {
  const { input, members, main, header, field, table, markers, w } = await fixture(strict, kind, true);
  const target = scope === "body" ? main : header;
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  if (route === "sdk") {
    const common = { scope, paragraph: 1, output: "-" };
    const result = category === "toc" ? await editDocumentFields(input, { operation: "toc.add", options: { ...common, title: "Contents", result: "Cached", levels: { start: 1, end: 3 } } }, context)
      : await editDocumentFields(input, { operation: "captions.add", options: { ...common, label: "Plate", text: "Coast", ...(category === "static" ? { static: true } : { result: "Cached" }) } }, context);
    expect(result.changes).toHaveLength(1);
    if (category !== "static") {
      const added = new Uint8Array(memory.readFileSync("/output") as Buffer); memory.writeFileSync("/output", "");
      const options = { scope, field: 2, text: " Revised ", update: false, output: "-" };
      const edited = category === "toc" ? await editDocumentFields(added, { operation: "toc.set", options: { ...options, levels: { start: 2, end: 4 } } }, context)
        : await editDocumentFields(added, { operation: "captions.set", options }, context);
      expect(edited.changes).toHaveLength(1);
    }
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    onTestFinished(() => shell.dispose());
    const add = category === "toc" ? "toc add --title Contents --result Cached --levels 1-3" : "captions add --label Plate --text Coast " + (category === "static" ? "--static true" : "--result Cached");
    const result = await shell.exec(`docx ${add} /input --scope ${scope} --paragraph 1 --output - > /added`);
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
    if (category !== "static") {
      const path = category === "toc" ? "toc set --levels 2-4" : "captions set";
      const edited = await shell.exec(`docx ${path} /added --scope ${scope} --field 2 --text ' Revised ' --update false --output - > /output`);
      expect(edited.exitCode, edited.stderr).toBe(0); expect(edited.stdout).toBe("");
    }
    memory.writeFileSync("/output", await fs.readFile(category === "static" ? "/added" : "/output"));
    expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), parts = readPackage(output);
  expect([...parts.keys()]).toEqual([...members.keys()]);
  for (const [name, bytes] of members) if (name !== target) expect(parts.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(parts.get(target));
  expect(xml).toContain(field); expect(xml).toContain(table); for (const marker of markers) expect(xml).toContain(marker);
  const tree = nodes(xmlStructure(parts.get(target)!)), fields = tree.filter(n => n.name === `{${w}}fldSimple`);
  expect(fields).toHaveLength(category === "static" ? 1 : 2);
  if (category === "static") expect(tree.filter(n => n.name === `{${w}}t`).map(n => n.children.join("")).join("")).toContain("Plate Coast");
  else {
    expect(fields[1]!.attributes[`{${w}}instr`]!.trim()).toBe(category === "toc" ? 'TOC \\o "2-4"' : 'SEQ "Plate"');
    expect(fields[1]!.attributes[`{${w}}dirty`]).toBe("false");
    const text = nodes(fields[1]!).find(n => n.name === `{${w}}t`)!;
    expect(text.children).toEqual([" Revised "]); expect(text.attributes["{http://www.w3.org/XML/1998/namespace}space"]).toBe("preserve");
  }
  expect(String((await Document(output, textContext)).part.partname)).toBe("/records/résumé.xml");
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
