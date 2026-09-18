import * as api from "./index.js";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";
import type { Comments, Settings, Styles, XmlPartView } from "./index.js";
const enc = (value: string) => new TextEncoder().encode(value);
const roles = ["styles", "settings", "comments"] as const;
for (const strict of [false, true]) for (const role of roles) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} binds loaded ${role} typed views to their actual part and keeps unrelated members; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict), before = readPackage(input);
  const memory = Volume.fromJSON({ "/output": "" });
  const ctx = { ...textContext, timestamp: new Date("2026-01-02T03:04:06Z"), author: "Original coast" };
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const name = `${role[0]!.toUpperCase()}${role.slice(1)}Part`, prefix = `model.parts.${role}.${name}`, partname = "/native/owned.xml";
  const blob = enc(`<w:${role} xmlns:w="${word}"><!--Keep--></w:${role}>`), type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${role}+xml;original=coast`;
  const ref = (resultHandle: string) => ({ resultHandle });
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "owner" },
    { operation: `${prefix}.load.call`, arguments: { ownerPackage: ref("owner"), partname, contentType: type, blob: { kind: "bytes", base64: Buffer.from(blob).toString("base64") } }, resultHandle: "native" },
    { operation: `${prefix}.${role}.get`, receiver: ref("native"), arguments: {}, resultHandle: "view" },
    role === "styles" ? { operation: "model.styles.styles.Styles.add_style.call", receiver: ref("view"), arguments: { name: "Harbor", styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } } }
      : role === "settings" ? { operation: "model.settings.Settings.odd_and_even_pages_header_footer.set", receiver: ref("view"), arguments: { value: true } }
        : { operation: "model.comments.Comments.add_comment.call", receiver: ref("view"), arguments: { text: "Harbor note", author: "Original coast", initials: "OC" } },
    { operation: `${prefix}.blob.get`, receiver: ref("native"), arguments: {} }
  ];
  if (route === "model") {
    const doc = await api.Document(input, ctx), factory = (api as unknown as Record<string, typeof XmlPartView>)[name]!;
    const part = await factory.load(partname, type, blob, doc.part.package) as XmlPartView & { styles: Styles; settings: Settings; comments: Comments };
    expect(part[role], "typed native view").toBeDefined();
    if (role === "styles") { const style = part.styles.add_style("Harbor", api.WD_STYLE_TYPE.PARAGRAPH); expect(style.part).toBe(part); expect(part.styles.at("Harbor").name).toBe("Harbor"); }
    if (role === "settings") { part.settings.odd_and_even_pages_header_footer = true; expect(part.settings.part).toBe(part); expect(part.settings.odd_and_even_pages_header_footer).toBe(true); }
    if (role === "comments") { const comment = part.comments.add_comment("Harbor note", "Original coast", "OC"); expect(comment.part).toBe(part); expect(comment.text).toBe("Harbor note"); }
    expect(new TextDecoder().decode(part.blob)).toContain("<!--Keep-->");
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, ctx);
    expect(result.results.at(-1)!.value).toHaveProperty("kind", "bytes");
    await result.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --timestamp 2026-01-02T03:04:06Z --author 'Original coast' --output - > /output"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of before) if (name !== "[Content_Types].xml" && name !== "word/_rels/document.xml.rels") expect(saved.get(name), name).toEqual(bytes);
  const tree = xmlStructure(saved.get(partname.slice(1))!);
  const nodes = (node: typeof tree): typeof tree[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
  const all = nodes(tree);
  expect(new TextDecoder().decode(saved.get(partname.slice(1))!)).toContain("<!--Keep-->");
  if (role === "styles") expect(all.some(node => node.name === `{${word}}name` && node.attributes[`{${word}}val`] === "Harbor")).toBe(true);
  if (role === "settings") expect(all.filter(node => node.name === `{${word}}evenAndOddHeaders`)).toHaveLength(1);
  if (role === "comments") { const comment = all.find(node => node.name === `{${word}}comment`)!; expect(comment.attributes[`{${word}}author`]).toBe("Original coast"); expect(comment.attributes[`{${word}}date`]).toBe("2026-01-02T03:04:06.000Z"); expect(all.find(node => node.name === `{${word}}t`)!.children).toEqual(["Harbor note"]); }
  expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("Original coast");
});

for (const role of ["settings", "comments", "styles"] as const)
it(`returns the public ${role} loader type`, async () => {
  const input = await textFixture("<w:p/>");
  const doc = await api.Document(input, textContext);
  const blob = enc(`<w:${role} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`);
  const name = "/native/typed.xml", type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${role}+xml`;
  if (role === "settings") {
    const part: api.SettingsPart = await api.SettingsPart.load(name, type, blob, doc.part.package);
    expect(part.settings.odd_and_even_pages_header_footer).toBe(false);
  } else if (role === "comments") {
    const part: api.CommentsPart = await api.CommentsPart.load(name, type, blob, doc.part.package);
    expect(part.comments.length).toBe(0);
  } else {
    const part: api.StylesPart = await api.StylesPart.load(name, type, blob, doc.part.package);
    expect(part.styles.length).toBe(0);
  }
});
