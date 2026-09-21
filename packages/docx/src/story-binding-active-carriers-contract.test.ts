import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["headers", "footers"] as const)
for (const variant of ["default", "first", "even"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const action of ["unlink", "relink", "remove"] as const)
for (const route of ["sdk", "cli"])
it(`local ${kind} ${action} edits the active binding and pins later inheritance; ${variant}; ${carrier}; strict=${strict}; ${route}`, async () => {
  const name = kind === "headers" ? "header" : "footer", root = kind === "headers" ? "hdr" : "ftr";
  const attrs = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:story-bindings" mc:Ignorable="f" mc:ProcessContent="f:pass"';
  const inert = '<f:inert stamp="retained"/>', wrap = (s: string) => carrier === "direct" ? s : carrier === "process" ? `<f:pass>${s}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? s : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? s : inert}</mc:Fallback></mc:AlternateContent>`;
  const reference = (id: string) => `<w:${name}Reference w:type="${variant}" r:id="${id}"/>`;
  const boundary = (binding: string) => `<w:p><w:pPr><w:sectPr ${attrs}><!--section--><?owner keep?>${binding}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr><w:r><w:t>Body</w:t></w:r></w:p>`;
  const input = await textFixture(boundary(reference("one")) + boundary(wrap(reference("two"))) + '<w:sectPr/>', { one: { kind: name, xml: `<w:${root} xmlns:w="${w}"><w:p><w:r><w:t>First é 海</w:t></w:r></w:p></w:${root}>` }, two: { kind: name, xml: `<w:${root} xmlns:w="${w}"><w:p><w:r><w:t>Local é 海</w:t></w:r></w:p></w:${root}>` } }, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), stdout = { async write(b: Uint8Array) { volume.appendFileSync("/out", b); } };
  expect((await api.inspectDocumentStories(input, { operation: `${kind}.list`, options: {} }, textContext)).items.filter(i => i.variant === variant).map(i => i.text)).toEqual(["First é 海", "Local é 海", "Local é 海"]);
  if (route === "sdk") expect((await api.editDocumentStories(input, { operation: action === "remove" ? `${kind}.remove` : `${kind}.set`, options: { section: 2, variant, ...(action === "remove" ? {} : { linkToPrevious: action === "relink" }), output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout })).affectedSections).toEqual([2]);
  else { const result = await api.createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: [kind, action === "remove" ? "remove" : "set", "/input", "--section", "2", "--variant", variant, ...(action === "remove" ? [] : ["--link-to-previous", String(action === "relink")]), "--output", "-"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(p) { return new Uint8Array(volume.readFileSync(p) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(b) { volume.appendFileSync("/err", b); } } }); expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0); }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  for (const [p, bytes] of before) if (!['word/document.xml', 'word/_rels/document.xml.rels', '[Content_Types].xml'].includes(p)) expect(after.get(p), p).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get('word/document.xml')); expect(xml.split(inert).length).toBe(new TextDecoder().decode(before.get('word/document.xml')).split(inert).length); expect(xml).toContain('<!--section--><?owner keep?>');
  const items = (await api.inspectDocumentStories(output, { operation: `${kind}.list`, options: {} }, textContext)).items.filter(i => i.variant === variant);
  expect(items.map(i => [i.text, i.linked])).toEqual([["First é 海", false], [action === "unlink" ? "Local é 海" : "First é 海", action !== "unlink"], ["Local é 海", false]]);
  expect(items[2]!.part).toBe('/word/two.xml'); if (action === "unlink") expect(items[1]!.part).not.toBe('/word/two.xml');
  expect((await api.Document(output, textContext)).sections).toHaveLength(3); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
