import * as api from "./index.js";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";
import type { PackageView, XmlPartView } from "./index.js";

const roles = [
  { name: "HeaderPart", prefix: "hdrftr.HeaderPart", method: "new", kind: "header", root: "hdr" },
  { name: "FooterPart", prefix: "hdrftr.FooterPart", method: "new", kind: "footer", root: "ftr" },
  { name: "CommentsPart", prefix: "comments.CommentsPart", method: "default", kind: "comments", root: "comments" },
  { name: "SettingsPart", prefix: "settings.SettingsPart", method: "default", kind: "settings", root: "settings" },
  { name: "StylesPart", prefix: "styles.StylesPart", method: "default", kind: "styles", root: "styles" }
] as const;
const encode = (s: string) => new TextEncoder().encode(s);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of roles) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} creates original ${role.name} in the owner dialect with collision-safe names; ${kind} strict=${strict}`, async () => {
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  const members = readPackage(await textFixture('<w:p><w:r><w:t>Keep coast</w:t></w:r></w:p>', {}, strict));
  if (kind === "dotx") members.set("[Content_Types].xml", encode(new TextDecoder().decode(members.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { compression: "store", order: "input" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), prefix = `model.parts.${role.prefix}`;
  const ref = (resultHandle: string) => ({ resultHandle });
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "owner" },
    { operation: `${prefix}.${role.method}.call`, arguments: { ownerPackage: ref("owner") }, resultHandle: "first" },
    { operation: `${prefix}.${role.method}.call`, arguments: { ownerPackage: ref("owner") }, resultHandle: "second" },
    { operation: `${prefix}.partname.get`, receiver: ref("first"), arguments: {} },
    { operation: `${prefix}.partname.get`, receiver: ref("second"), arguments: {} }
  ];
  let names: string[];
  if (route === "model") {
    const doc = await api.Document(input, textContext);
    const factory = (api as unknown as Record<string, Record<string, (owner: PackageView) => XmlPartView>>)[role.name]!;
    expect(factory[role.method]).toBeTypeOf("function");
    const first = factory[role.method]!(doc.part.package), second = factory[role.method]!(doc.part.package);
    names = [String(first.partname), String(second.partname)];
    expect(first.package).toBe(doc.part.package); expect(second.package).toBe(doc.part.package);
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    names = result.results.slice(-2).map(row => row.value as string);
    await result.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      names = JSON.parse(result.stdout).data.results.slice(-2).map((row: { data: string }) => row.data);
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  expect(names[0]).not.toBe(names[1]);
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of members) if (name !== "[Content_Types].xml") expect(saved.get(name), name).toEqual(bytes);
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  for (const name of names) {
    const tree = xmlStructure(saved.get(name.slice(1))!);
    const root = tree.name === "#document" ? tree.children.find(node => typeof node !== "string" && node.name === `{${word}}${role.root}`) as typeof tree : tree;
    expect(root.name).toBe(`{${word}}${role.root}`);
    if (role.kind === "header" || role.kind === "footer") expect(root.children.some(node => typeof node !== "string" && node.name === `{${word}}p`)).toBe(true);
  }
  expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("Keep coast");
});
