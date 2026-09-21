import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["headers", "footers"] as const)
for (const variant of ["default", "first", "even"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const route of ["sdk", "cli"])
it(`whole ${kind} assignment retains active paragraph/property carriers; ${variant}; ${carrier}; strict=${strict}; ${route}`, async () => {
  const name = kind === "headers" ? "header" : "footer", root = kind === "headers" ? "hdr" : "ftr";
  const attrs = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:story-carriers" mc:Ignorable="f" mc:ProcessContent="f:pass"';
  const inert = '<f:inert stamp="retained"/>', wrap = (s: string) => carrier === "direct" ? s : carrier === "process" ? `<f:pass>${s}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? s : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? s : inert}</mc:Fallback></mc:AlternateContent>`;
  const source = `<w:${root} xmlns:w="${w}" ${attrs}><!--story--><?owner keep?>${wrap(`<w:p><!--paragraph--><?p keep?>${wrap('<w:pPr><w:keepNext/></w:pPr>')}<w:r><w:t>Old é 海</w:t></w:r></w:p>`)}</w:${root}>`;
  const input = await textFixture(`<w:p><w:pPr><w:sectPr><w:${name}Reference w:type="${variant}" r:id="story"/></w:sectPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p><w:sectPr/>`, { story: { kind: name, xml: source } }, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), stdout = { async write(b: Uint8Array) { volume.appendFileSync("/out", b); } };
  expect((await api.inspectDocumentStories(input, { operation: `${kind}.list`, options: {} }, textContext)).items.filter(i => i.variant === variant).map(i => [i.text, i.linked])).toEqual([["Old é 海", false], ["Old é 海", true]]);
  if (route === "sdk") expect((await api.editDocumentStories(input, { operation: `${kind}.set`, options: { section: 1, variant, shared: true, text: "New é 海", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout })).affectedSections).toEqual([1, 2]);
  else { const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: [kind, "set", "/input", "--section", "1", "--variant", variant, "--shared", "--text", "New é 海", "--output", "-"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(p) { return new Uint8Array(volume.readFileSync(p) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(b) { volume.appendFileSync("/err", b); } } }); expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0); }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [p, bytes] of before) if (p !== "word/story.xml") expect(after.get(p), p).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get("word/story.xml"));
  expect(xml).toContain('<!--story--><?owner keep?>'); expect(xml).toContain('<!--paragraph--><?p keep?>'); expect(xml).toContain('<w:keepNext/>');
  expect(xml.split(inert).length).toBe(source.split(inert).length);
  expect((await api.inspectDocumentStories(output, { operation: `${kind}.list`, options: {} }, textContext)).items.filter(i => i.variant === variant).map(i => [i.text, i.linked])).toEqual([["New é 海", false], ["New é 海", true]]);
  const doc = await api.Document(output, textContext), member = variant === "default" ? name : `${variant}_page_${name}` as "first_page_header";
  expect(doc.sections[0]![member].paragraphs[0]!.paragraph_format.keep_with_next).toBe(true);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
