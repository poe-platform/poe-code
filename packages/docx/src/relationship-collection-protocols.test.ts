import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, executeDocumentBatch, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import type { RelationshipView } from "./index.js";

const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const prefix = "model.opc.rel.Relationships";
const ref = (resultHandle: string, key?: string) => ({ resultHandle, ...(key === undefined ? {} : { key }) });
const enc = (text: string) => new TextEncoder().encode(text);
const context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
type Step = { operation: string; receiver?: object; arguments: Record<string, unknown>; resultHandle?: string };
type Owner = "root" | "document";
type Encoding = "utf8" | "utf8bom" | "utf16le" | "utf16be";
type Carrier = "direct" | "choice" | "fallback" | "process";

async function fixture(strict: boolean, kind: "docx" | "dotx", owner: Owner, carrier: Carrier, encoding: Encoding) {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const main = `<p:Relationship Id="main" Type="${r}/officeDocument" Target="reports/main.xml"/>`;
  const a = '<p:Relationship Id="audit" Type="urn:original:audit" Target="/records/a.xml#coast"/>';
  const b = '<p:Relationship Id="outside" Type="urn:original:external" Target="file:///private/inert" TargetMode="External"/>';
  const inactive = '<p:Relationship Id="audit" Type="urn:original:inactive" Target="/absent.xml" mc:MustUnderstand="f"/>';
  const rows = a + b;
  const carried = carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="p">${rows}</mc:Choice><mc:Fallback>${inactive}</mc:Fallback></mc:AlternateContent>`
    : carrier === "fallback" ? `<mc:AlternateContent><mc:Choice Requires="f">${inactive}</mc:Choice><mc:Fallback>${rows}</mc:Fallback></mc:AlternateContent>`
    : carrier === "process" ? `<f:carrier>${rows}</f:carrier>` : rows;
  const envelope = (body: string) => `<?xml version="1.0" encoding="${encoding.startsWith("utf8") ? "UTF-8" : "UTF-16"}"?><!--before--><p:Relationships xmlns:p="${pr}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:carrier">\n${body}\n<f:opaque xml:space="preserve">  retained 海  </f:opaque><?keep owner?>\n</p:Relationships><!--after-->`;
  const selected = owner === "root" ? "_rels/.rels" : "reports/_rels/main.xml.rels";
  const donorRows = '<p:Relationship Id="audit" Type="urn:original:replacement" Target="/records/b.xml#dunes"/><p:Relationship Id="new" Type="urn:original:new" Target="/records/b.xml#dunes"/>';
  const xml = envelope((owner === "root" ? main : "") + carried);
  const encoded = (text: string) => encoding === "utf8" ? enc(text) : encoding === "utf8bom" ? new Uint8Array(Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(text)]))
    : new Uint8Array(Buffer.concat([Buffer.from(encoding === "utf16le" ? [255, 254] : [254, 255]), encoding === "utf16le" ? Buffer.from(text, "utf16le") : Buffer.from(text, "utf16le").swap16()]));
  const parts = new Map(Object.entries({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/reports/main.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml"/></Types>`,
    "_rels/.rels": owner === "root" ? xml : envelope(main + donorRows),
    "reports/main.xml": `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Coast record</w:t></w:r></w:p></w:body></w:document>`,
    "reports/_rels/main.xml.rels": owner === "document" ? xml : envelope(donorRows),
    "records/a.xml": "<audit>Original coast</audit>", "records/b.xml": "<audit>Original dunes</audit>"
  }).map(([name, text]) => [name, name.endsWith(".rels") ? encoded(text) : enc(text)]));
  const memory = Volume.fromJSON({ "/input": "", "/output": "", "/sentinel": "retained" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
    { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const bootstrap: Step[] = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "part" },
    { operation: "model.opc.part.Part.package.get", receiver: ref("part"), arguments: {}, resultHandle: "package" },
    { operation: "model.opc.part.Part.rels.get", receiver: ref("part"), arguments: {}, resultHandle: owner === "document" ? "rels" : "donor" },
    { operation: "model.opc.package.OpcPackage.rels.get", receiver: ref("package"), arguments: {}, resultHandle: owner === "root" ? "rels" : "donor" }
  ];
  return { parts, selected, xml, input, memory, bootstrap, carried, a, b, main, encoded };
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const encoding of ["utf8", "utf8bom", "utf16le", "utf16be"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} reads every collection protocol and returned map handle; ${owner} ${carrier} ${encoding} ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, owner, carrier, encoding);
  const keys = [...(owner === "root" ? ["main"] : []), "audit", "outside"];
  const steps: Step[] = [
    ...["keys.call", "__iter__.call", "values.call", "items.call"].map(member => ({ operation: `${prefix}.${member}`, receiver: ref("rels"), arguments: {} })),
    { operation: prefix + ".__len__.get", receiver: ref("rels"), arguments: {} },
    ...["audit", "missing", "0"].map(rId => ({ operation: prefix + ".__contains__.call", receiver: ref("rels"), arguments: { rId } })),
    { operation: prefix + ".get.call", receiver: ref("rels"), arguments: { rId: "missing" } },
    { operation: prefix + ".get.call", receiver: ref("rels"), arguments: { rId: "missing", defaultValue: null } },
    { operation: prefix + ".__getitem__.call", receiver: ref("rels"), arguments: { rId: "audit" }, resultHandle: "edge" },
    { operation: prefix + ".get.call", receiver: ref("rels"), arguments: { rId: "missing", defaultValue: ref("edge") } },
    { operation: prefix + ".copy.call", receiver: ref("rels"), arguments: {}, resultHandle: "copy" },
    { operation: "model.opc.rel._Relationship.target_ref.get", receiver: ref("copy", "audit"), arguments: {} },
    { operation: prefix + ".related_parts.get", receiver: ref("rels"), arguments: {}, resultHandle: "targets" },
    { operation: "model.opc.part.Part.blob.get", receiver: ref("targets", "audit"), arguments: {} },
    { operation: prefix + ".part_with_reltype.call", receiver: ref("rels"), arguments: { reltype: "urn:original:audit" }, resultHandle: "target" },
    { operation: "model.opc.part.Part.partname.get", receiver: ref("target"), arguments: {} },
    { operation: prefix + ".xml.get", receiver: ref("rels"), arguments: {} },
    ...["rId", "reltype", "is_external", "target_ref", "target_part"].map(member => ({ operation: `model.opc.rel._Relationship.${member}.get`, receiver: ref("edge"), arguments: {} }))
  ];
  if (route === "model") {
    const doc = await Document(f.input, context), rels = owner === "root" ? doc.part.package.rels : doc.part.rels;
    expect([...rels.keys()]).toEqual(keys); expect([...rels]).toEqual(keys); expect(rels.length).toBe(keys.length);
    expect([...rels.values()].map(edge => edge.rId)).toEqual(keys); expect([...rels.items()].map(([key, edge]) => [key, edge.rId])).toEqual(keys.map(key => [key, key]));
    expect([rels.has("audit"), rels.has("missing"), rels.has("0")]).toEqual([true, false, false]);
    expect(rels.get("missing")).toBeNull(); expect(rels.get("missing", null)).toBeNull(); const edge = rels.at("audit");
    expect(rels.get("missing", edge)).toBe(edge); const copy = rels.copy(); expect([...copy.keys()]).toEqual(keys); expect(copy.get("audit")).toBe(edge);
    expect([...rels.related_parts.keys()]).toEqual(keys.filter(key => key !== "outside"));
    expect(rels.related_parts.get("audit")!.blob).toEqual(f.parts.get("records/a.xml")); expect(rels.part_with_reltype("urn:original:audit")).toBe(edge.target_part);
    expect([edge.rId, edge.reltype, edge.is_external, edge.target_ref, String(edge.target_part.partname)]).toEqual(["audit", "urn:original:audit", false, "/records/a.xml#coast", "/records/a.xml"]);
    expect(rels.xml).toBe(f.xml); await doc.save({ async write(bytes) { f.memory.appendFileSync("/output", bytes); } });
    expect(readPackage(new Uint8Array(f.memory.readFileSync("/output") as Buffer))).toEqual(f.parts);
  } else {
    let values: unknown[];
    const batch = { version: 1, operations: [...f.bootstrap, ...steps] };
    if (route === "sdk") { const result = await executeDocumentBatch(f.input, batch, {}, context); expect(result.publication).toBeNull(); expect(result.results.every(step => step.affected === 0 && step.ok)).toBe(true); values = result.results.slice(f.bootstrap.length).map(step => step.data); }
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", f.input); await fs.writeFile("/ops", enc(JSON.stringify(batch))); await fs.writeFile("/sentinel", enc("retained"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try { const result = await shell.exec("docx batch /input --ops-file /ops --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); expect(envelope).toMatchObject({ ok: true, affected: 0, data: { publication: null }, errors: [] }); values = envelope.data.results.slice(f.bootstrap.length).map((step: { data: unknown }) => step.data); expect(await fs.readFile("/input")).toEqual(f.input); expect(await fs.readFile("/sentinel")).toEqual(enc("retained")); }
      finally { await shell.dispose(); }
    }
    const handle = expect.objectContaining({ type: "RelationshipView", owner: "document", revision: 0 });
    expect(values.slice(0, 2)).toEqual([keys, keys]); expect(values[2]).toEqual(keys.map(() => handle)); expect(values[3]).toEqual(keys.map(key => [key, handle]));
    expect(values.slice(4, 10)).toEqual([keys.length, true, false, false, null, null]); expect(values[10]).toEqual(handle); expect(values[11]).toEqual(values[10]);
    expect(values[12]).toEqual(keys.map(key => ({ key, value: handle }))); expect(values[13]).toBe("/records/a.xml#coast");
    expect((values[14] as { key: string }[]).map(item => item.key)).toEqual(keys.filter(key => key !== "outside"));
    expect(values[15]).toEqual({ kind: "bytes", base64: Buffer.from(f.parts.get("records/a.xml")!).toString("base64") }); expect(values[17]).toBe("/records/a.xml"); expect(values[18]).toBe(f.xml);
    expect(values.slice(19, 23)).toEqual(["audit", "urn:original:audit", false, "/records/a.xml#coast"]); expect(values).toHaveLength(24); expect(values[23]).toEqual(values[16]);
  }
  expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input)); expect(f.memory.readFileSync("/sentinel", "utf8")).toBe("retained");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const encoding of ["utf8", "utf8bom", "utf16le", "utf16be"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} deduplicates defaults and transactionally updates pops with dirty context retention; ${owner} ${carrier} ${encoding} ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, owner, carrier, encoding);
  const target = (owner === "root" ? "records/b.xml" : "../records/b.xml") + "#dunes";
  const steps: Step[] = [
    { operation: prefix + ".__getitem__.call", receiver: ref("rels"), arguments: { rId: "audit" }, resultHandle: "held" },
    { operation: prefix + ".copy.call", receiver: ref("rels"), arguments: {}, resultHandle: "snapshot" },
    ...["audit", "new"].map(rId => ({ operation: prefix + ".__getitem__.call", receiver: ref("donor"), arguments: { rId }, resultHandle: rId })),
    { operation: prefix + ".setdefault.call", receiver: ref("rels"), arguments: { rId: "audit", value: ref("new") } },
    { operation: "model.opc.rel._Relationship.target_ref.get", receiver: ref("held"), arguments: {} },
    { operation: prefix + ".setdefault.call", receiver: ref("rels"), arguments: { rId: "new", value: ref("new") }, resultHandle: "inserted" },
    { operation: "model.opc.rel._Relationship.target_ref.get", receiver: ref("inserted"), arguments: {} },
    { operation: prefix + ".update.call", receiver: ref("rels"), arguments: { entries: [["audit", ref("audit")], ["new", ref("new")]] } },
    { operation: "model.opc.rel._Relationship.target_ref.get", receiver: ref("held"), arguments: {} },
    { operation: "model.opc.rel._Relationship.target_part.get", receiver: ref("held"), arguments: {}, resultHandle: "target" },
    { operation: prefix + ".get_or_add.call", receiver: ref("rels"), arguments: { reltype: "urn:original:replacement", targetPart: ref("target") } },
    { operation: prefix + ".get_or_add_ext_rel.call", receiver: ref("rels"), arguments: { reltype: "urn:original:external", targetRef: "file:///private/inert" } },
    { operation: prefix + ".pop.call", receiver: ref("rels"), arguments: { rId: "missing", defaultValue: null } },
    { operation: prefix + ".pop.call", receiver: ref("rels"), arguments: { rId: "missing", defaultValue: ref("held") } },
    { operation: prefix + ".popitem.call", receiver: ref("rels"), arguments: {}, resultHandle: "popped" },
    { operation: prefix + ".pop.call", receiver: ref("rels"), arguments: { rId: "outside" }, resultHandle: "removed" },
    { operation: prefix + ".keys.call", receiver: ref("rels"), arguments: {} },
    { operation: "model.opc.rel._Relationship.target_ref.get", receiver: ref("snapshot", "audit"), arguments: {} }
  ];
  if (route === "model") {
    const doc = await Document(f.input, context), rels = owner === "root" ? doc.part.package.rels : doc.part.rels, donor = owner === "root" ? doc.part.rels : doc.part.package.rels;
    const held = rels.at("audit"), snapshot = rels.copy(); expect(rels.setdefault("audit", donor.at("new"))).toBe(held); expect(held.target_ref).toBe("/records/a.xml#coast");
    const inserted = rels.setdefault("new", donor.at("new")); expect(inserted.target_ref).toBe(target); expect(snapshot.has("new")).toBe(false);
    rels.update([["audit", donor.at("audit")], ["new", donor.at("new")]]); expect(held.target_ref).toBe(target);
    expect(rels.get_or_add("urn:original:replacement", held.target_part)).toBe(held); expect(rels.get_or_add_ext_rel("urn:original:external", "file:///private/inert")).toBe("outside");
    expect(rels.pop("missing", null)).toBeNull(); expect(rels.pop("missing", held)).toBe(held); expect(rels.popitem()).toEqual(["new", inserted]);
    const outside = rels.at("outside"); expect(rels.pop("outside")).toBe(outside); expect(() => inserted.target_ref).toThrowError(expect.objectContaining({ code: "stale-selection" })); expect(() => outside.rId).toThrowError(expect.objectContaining({ code: "stale-selection" }));
    expect([...snapshot.keys()]).toEqual([...(owner === "root" ? ["main"] : []), "audit", "outside"]); expect(snapshot.get("audit")!.target_ref).toBe(target);
    expect([...rels.keys()]).toEqual([...(owner === "root" ? ["main"] : []), "audit"]); await doc.save({ async write(bytes) { f.memory.appendFileSync("/output", bytes); } });
  } else {
    const batch = { version: 1, operations: [...f.bootstrap, ...steps] };
    let values: unknown[];
    if (route === "sdk") { const result = await executeDocumentBatch(f.input, batch, { output: "-" }, { ...context, stdout: { async write(bytes) { f.memory.appendFileSync("/output", bytes); } } }); expect(result.publication).not.toBeNull(); values = result.results.slice(f.bootstrap.length).map(step => step.data); }
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", f.input); await fs.writeFile("/ops", enc(JSON.stringify(batch)));
      const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try { const response = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(0); const result = JSON.parse(response.stdout); expect(result.data.publication).not.toBeNull(); values = result.data.results.slice(f.bootstrap.length).map((step: { data: unknown }) => step.data); f.memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(f.input); }
      finally { await shell.dispose(); }
    }
    expect(values[4]).toEqual(values[0]); expect(values[5]).toBe("/records/a.xml#coast"); expect(values[7]).toBe(target); expect(values[8]).toBeNull(); expect(values[9]).toBe(target); expect(values[11]).toEqual(values[0]); expect(values[12]).toBe("outside"); expect(values[13]).toBeNull(); expect(values[14]).toEqual(values[0]); expect(values[15]).toEqual(["new", values[6]]); expect(values[16]).toMatchObject({ type: "RelationshipView" }); expect(values[17]).toEqual([...(owner === "root" ? ["main"] : []), "audit"]); expect(values[18]).toBe(target);
  }
  const output = new Uint8Array(f.memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of f.parts) if (name !== f.selected) expect(saved.get(name), name).toEqual(bytes);
  const expected = f.xml.replace(f.a, f.a.replace("urn:original:audit", "urn:original:replacement").replace("/records/a.xml#coast", target)).replace(f.b, "");
  expect(saved.get(f.selected)).toEqual(f.encoded(expected)); const reopened = await Document(output, context), rels = owner === "root" ? reopened.part.package.rels : reopened.part.rels;
  expect(rels.at("audit").target_part.blob).toEqual(f.parts.get("records/b.xml")); expect(reopened.paragraphs[0]!.text).toBe("Coast record"); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const) for (const present of [false, true])
for (const method of ["get", "pop", "setdefault"] as const)
for (const [label, value] of [["false", false], ["zero", 0], ["empty", ""], ["object", {}], ["array", []], ...(method === "setdefault" ? [["null", null], ["omitted", undefined]] : [])] as const)
it(`${route} rejects invalid ${method} default ${label} before lookup or mutation; present=${present} ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, "document", "direct", "utf8"), rId = present ? "audit" : "missing";
  const args = { rId, ...(value === undefined ? {} : { [method === "setdefault" ? "value" : "defaultValue"]: value }) };
  const batch = { version: 1, operations: [...f.bootstrap, { operation: `${prefix}.${method}.call`, receiver: ref("rels"), arguments: args }] };
  if (route === "model") {
    const doc = await Document(f.input, context), rels = doc.part.rels, edge = rels.at("audit"), before = rels.xml;
    expect(() => rels[method](rId, value as RelationshipView)).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(rels.xml).toBe(before); expect(rels.at("audit")).toBe(edge); expect(edge.target_ref).toBe("/records/a.xml#coast");
    await doc.save({ async write(bytes) { f.memory.appendFileSync("/output", bytes); } }); expect(readPackage(new Uint8Array(f.memory.readFileSync("/output") as Buffer))).toEqual(f.parts);
  } else if (route === "sdk") {
    await expect(executeDocumentBatch(f.input, batch, method === "get" ? {} : { output: "-" }, { ...context, stdout: { async write(bytes) { f.memory.writeFileSync("/sentinel", bytes); } } })).rejects.toMatchObject({ code: "usage" });
    expect(f.memory.readFileSync("/sentinel", "utf8")).toBe("retained");
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", f.input); await fs.writeFile("/ops", enc(JSON.stringify(batch))); await fs.writeFile("/sentinel", enc("retained"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const response = await shell.exec("docx batch /input --ops-file /ops" + (method === "get" ? "" : " --output /sentinel --force") + " --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(2); expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "usage" }] }); expect(await fs.readFile("/input")).toEqual(f.input); expect(await fs.readFile("/sentinel")).toEqual(enc("retained")); }
    finally { await shell.dispose(); }
  }
  expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
for (const [label, entries] of [["omitted", undefined], ["null", null], ["false", false], ["zero", 0], ["text", "audit"], ["empty text", ""], ["object", {}], ["null item", [null]], ["false item", [false]], ["empty tuple", [[]]], ["short tuple", [["audit"]]], ["null relationship", [["audit", null]]]] as const)
it(`${route} rejects malformed update entries ${label} with stable input error; ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, "document", "direct", "utf8");
  const batch = { version: 1, operations: [...f.bootstrap, { operation: prefix + ".update.call", receiver: ref("rels"), arguments: entries === undefined ? {} : { entries } }] };
  if (route === "model") {
    const doc = await Document(f.input, context), rels = doc.part.rels, before = rels.xml;
    expect(() => rels.update(entries as unknown as Iterable<readonly [string, RelationshipView]>)).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(rels.xml).toBe(before); expect(rels.at("audit").target_ref).toBe("/records/a.xml#coast");
  } else if (route === "sdk") {
    await expect(executeDocumentBatch(f.input, batch, { output: "-" }, { ...context, stdout: { async write(bytes) { f.memory.writeFileSync("/sentinel", bytes); } } })).rejects.toMatchObject({ code: "usage" });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", f.input); await fs.writeFile("/ops", enc(JSON.stringify(batch))); await fs.writeFile("/sentinel", enc("retained"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const response = await shell.exec("docx batch /input --ops-file /ops --output /sentinel --force --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(2); expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "usage" }] }); expect(await fs.readFile("/input")).toEqual(f.input); expect(await fs.readFile("/sentinel")).toEqual(enc("retained")); }
    finally { await shell.dispose(); }
  }
  expect(f.memory.readFileSync("/sentinel", "utf8")).toBe("retained"); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const encoding of ["utf8", "utf8bom", "utf16le", "utf16be"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} clears optional edges and admits empty updates while retaining carrier shells; ${carrier} ${encoding} ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, "document", carrier, encoding);
  const steps: Step[] = [
    { operation: prefix + ".update.call", receiver: ref("rels"), arguments: { entries: [] } },
    { operation: prefix + ".clear.call", receiver: ref("rels"), arguments: {} },
    { operation: prefix + ".clear.call", receiver: ref("rels"), arguments: {} },
    { operation: prefix + ".__len__.get", receiver: ref("rels"), arguments: {} },
    ...["keys", "values", "items", "copy"].map(member => ({ operation: `${prefix}.${member}.call`, receiver: ref("rels"), arguments: {} })),
    { operation: prefix + ".get.call", receiver: ref("rels"), arguments: { rId: "audit" } },
    { operation: prefix + ".pop.call", receiver: ref("rels"), arguments: { rId: "audit", defaultValue: null } }
  ];
  if (route === "model") {
    const doc = await Document(f.input, context), rels = doc.part.rels, held = rels.at("audit");
    const before = rels.xml; rels.update(new Map()); rels.update(new Set()); expect(rels.xml).toBe(before); expect(rels.get("missing", undefined)).toBeNull();
    rels.clear(); rels.clear(); expect(rels.length).toBe(0); expect([...rels.keys(), ...rels.values(), ...rels.items(), ...rels.copy()]).toEqual([]); expect(rels.get("audit")).toBeNull(); expect(rels.pop("audit", null)).toBeNull();
    expect(() => held.rId).toThrowError(expect.objectContaining({ code: "stale-selection" })); expect(() => rels.popitem()).toThrowError(expect.objectContaining({ code: "missing-selection" })); expect(() => rels.pop("audit", undefined)).toThrowError(expect.objectContaining({ code: "missing-selection" }));
    await doc.save({ async write(bytes) { f.memory.appendFileSync("/output", bytes); } });
  } else {
    const batch = { version: 1, operations: [...f.bootstrap, ...steps] }; let values: unknown[];
    if (route === "sdk") { const result = await executeDocumentBatch(f.input, batch, { output: "-" }, { ...context, stdout: { async write(bytes) { f.memory.appendFileSync("/output", bytes); } } }); values = result.results.slice(f.bootstrap.length).map(step => step.data); expect(result.publication).not.toBeNull(); }
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", f.input); await fs.writeFile("/ops", enc(JSON.stringify(batch)));
      const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try { const response = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(0); const result = JSON.parse(response.stdout); values = result.data.results.slice(f.bootstrap.length).map((step: { data: unknown }) => step.data); expect(result.data.publication).not.toBeNull(); f.memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(f.input); }
      finally { await shell.dispose(); }
    }
    expect(values).toEqual([null, null, null, 0, [], [], [], [], null, null]);
  }
  const saved = readPackage(new Uint8Array(f.memory.readFileSync("/output") as Buffer));
  for (const [name, bytes] of f.parts) expect(saved.get(name), name).toEqual(name === f.selected ? f.encoded(f.xml.replace(f.a, "").replace(f.b, "")) : bytes);
  expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const route of ["model", "sdk", "shell"] as const)
for (const scenario of ["missing-at", "missing-pop", "missing-type", "external-target", "stale-pop", "stale-popitem", "duplicate-update", "late-mismatched-update", ...(owner === "root" ? ["required-clear"] : ["empty-popitem"])])
it(`${route} retains source and rejects collection ${scenario}; ${owner} ${carrier} ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, owner, carrier, "utf8");
  const code = scenario.startsWith("missing") || scenario === "empty-popitem" ? "missing-selection" : scenario.startsWith("stale") ? "stale-selection" : scenario === "required-clear" ? "invalid-package" : "usage";
  const readOnly = ["missing-at", "missing-type", "external-target"].includes(scenario);
  let steps: Step[];
  if (scenario === "missing-at" || scenario === "missing-pop") steps = [{ operation: prefix + (scenario === "missing-at" ? ".__getitem__.call" : ".pop.call"), receiver: ref("rels"), arguments: { rId: "missing" } }];
  else if (scenario === "missing-type") steps = [{ operation: prefix + ".part_with_reltype.call", receiver: ref("rels"), arguments: { reltype: "urn:absent" } }];
  else if (scenario === "external-target") steps = [{ operation: prefix + ".__getitem__.call", receiver: ref("rels"), arguments: { rId: "outside" }, resultHandle: "edge" }, { operation: "model.opc.rel._Relationship.target_part.get", receiver: ref("edge"), arguments: {} }];
  else if (scenario === "stale-pop" || scenario === "stale-popitem") steps = [{ operation: prefix + (scenario === "stale-pop" ? ".pop.call" : ".popitem.call"), receiver: ref("rels"), arguments: scenario === "stale-pop" ? { rId: "outside" } : {}, resultHandle: "removed" }, { operation: "model.opc.rel._Relationship.target_ref.get", receiver: scenario === "stale-pop" ? ref("removed") : { resultHandle: "removed", index: 1 }, arguments: {} }];
  else if (scenario === "required-clear" || scenario === "empty-popitem") steps = [{ operation: prefix + ".clear.call", receiver: ref("rels"), arguments: {} }, ...(scenario === "empty-popitem" ? [{ operation: prefix + ".popitem.call", receiver: ref("rels"), arguments: {} }] : [])];
  else steps = [{ operation: prefix + ".__getitem__.call", receiver: ref("donor"), arguments: { rId: "audit" }, resultHandle: "edge" }, { operation: prefix + ".update.call", receiver: ref("rels"), arguments: { entries: [["audit", ref("edge")], [scenario === "duplicate-update" ? "audit" : "wrong", ref("edge")]] } }];
  if (route === "model") {
    const doc = await Document(f.input, context), rels = owner === "root" ? doc.part.package.rels : doc.part.rels, donor = owner === "root" ? doc.part.rels : doc.part.package.rels;
    let fail: () => unknown;
    if (scenario === "missing-at") fail = () => rels.at("missing");
    else if (scenario === "missing-pop") fail = () => rels.pop("missing");
    else if (scenario === "missing-type") fail = () => rels.part_with_reltype("urn:absent");
    else if (scenario === "external-target") fail = () => rels.at("outside").target_part;
    else if (scenario === "stale-pop" || scenario === "stale-popitem") { const removed = scenario === "stale-pop" ? rels.pop("outside")! : rels.popitem()[1]; fail = () => removed.target_ref; }
    else if (scenario === "required-clear") fail = () => rels.clear();
    else if (scenario === "empty-popitem") { rels.clear(); fail = () => rels.popitem(); }
    else fail = () => rels.update([["audit", donor.at("audit")], [scenario === "duplicate-update" ? "audit" : "wrong", donor.at("audit")]]);
    const before = rels.xml, keys = [...rels.keys()]; expect(fail).toThrowError(expect.objectContaining({ code })); expect(rels.xml).toBe(before); expect([...rels.keys()]).toEqual(keys);
    if (rels.has("audit")) expect(rels.at("audit").target_ref).toBe("/records/a.xml#coast");
  } else {
    const batch = { version: 1, operations: [...f.bootstrap, ...steps] };
    if (route === "sdk") await expect(executeDocumentBatch(f.input, batch, readOnly ? {} : { output: "-" }, { ...context, stdout: { async write(bytes) { f.memory.writeFileSync("/sentinel", bytes); } } })).rejects.toMatchObject({ code });
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", f.input); await fs.writeFile("/ops", enc(JSON.stringify(batch))); await fs.writeFile("/sentinel", enc("retained"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try { const response = await shell.exec("docx batch /input --ops-file /ops" + (readOnly ? "" : " --output /sentinel --force") + " --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(code === "usage" ? 2 : 1); expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code }] }); expect(await fs.readFile("/input")).toEqual(f.input); expect(await fs.readFile("/sentinel")).toEqual(enc("retained")); }
      finally { await shell.dispose(); }
    }
  }
  expect(f.memory.readFileSync("/sentinel", "utf8")).toBe("retained"); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} rejects a long update tuple before applying its valid relationship; ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, "document", "direct", "utf8");
  const batch = { version: 1, operations: [...f.bootstrap,
    { operation: prefix + ".__getitem__.call", receiver: ref("donor"), arguments: { rId: "audit" }, resultHandle: "edge" },
    { operation: prefix + ".update.call", receiver: ref("rels"), arguments: { entries: [["audit", ref("edge"), "extra"]] } }
  ] };
  if (route === "model") {
    const doc = await Document(f.input, context), rels = doc.part.rels, before = rels.xml;
    expect(() => rels.update([["audit", doc.part.package.rels.at("audit"), "extra"]] as unknown as Iterable<readonly [string, RelationshipView]>)).toThrowError(expect.objectContaining({ code: "usage" }));
    expect(rels.xml).toBe(before); expect(rels.at("audit").target_ref).toBe("/records/a.xml#coast");
  } else if (route === "sdk") await expect(executeDocumentBatch(f.input, batch, { output: "-" }, { ...context, stdout: { async write(bytes) { f.memory.writeFileSync("/sentinel", bytes); } } })).rejects.toMatchObject({ code: "usage" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", f.input); await fs.writeFile("/ops", enc(JSON.stringify(batch))); await fs.writeFile("/sentinel", enc("retained"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const response = await shell.exec("docx batch /input --ops-file /ops --output /sentinel --force --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(2); expect(JSON.parse(response.stdout)).toMatchObject({ ok: false, affected: 0, data: null, errors: [{ code: "usage" }] }); expect(await fs.readFile("/input")).toEqual(f.input); expect(await fs.readFile("/sentinel")).toEqual(enc("retained")); }
    finally { await shell.dispose(); }
  }
  expect(f.memory.readFileSync("/sentinel", "utf8")).toBe("retained"); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
});
