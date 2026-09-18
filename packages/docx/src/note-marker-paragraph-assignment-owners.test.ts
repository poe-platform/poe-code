import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["footnote", "endnote"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const layout of ["mixed", "marker-only", "separate"] as const) for (const clear of [false, true]) for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
 it(`${route} paragraph assignment retains ${kind}Ref through ${carrier}; layout=${layout}; clear=${clear}; strict=${strict}`, async () => {
  const inert = '<f:shadow f:id="retained-native-note"><w:t>INERT</w:t></f:shadow>';
  const wrap = (active: string) => carrier === "direct" ? active + inert : carrier === "process" ? `<f:pass>${active}${inert}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inert}</mc:Fallback></mc:AlternateContent>`;
  const marker = `<w:${kind}Ref/>`, run = (content: string) => `<w:r xml:lang="ar-SA"><w:rPr><w:rtl/></w:rPr>${wrap(content)}</w:r>`, runs = layout === "mixed" ? run(marker + '<w:t>c🌊st</w:t>') : layout === "marker-only" ? run(marker) : run(marker) + run('<w:t>c🌊st</w:t>'), story = { kind: kind + "s", xml: `<w:${kind}s xmlns:w="${w}"><w:${kind} w:id="7"><w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:note-scalar" mc:Ignorable="f" mc:ProcessContent="f:pass">${runs}</w:p></w:${kind}></w:${kind}s>` }, input = await textFixture(`<w:p><w:r><w:${kind}Reference w:id="7"/></w:r></w:p>`, { [kind + "s"]: story }, strict);
  const locations = await api.openDocumentLocations(input, textContext), p = locations.at("paragraph", 1, { scope: kind + "s" as "footnotes" | "endnotes" }), select = p.token, memory = Volume.fromJSON({ "/out": "" });
  const op = "paragraphs.set" as const, args = { select, text: clear ? null : "NEW" }, batch = { version: 1 as const, operations: [{ operation: op, arguments: args }] }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  if (route === "sdk") await api.editDocumentParagraphs(input, { operation: op, options: { ...args, output: "-" } }, context);
  else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, context);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(route === "shell" ? `docx paragraphs set /input --select '${select}' --text ${clear ? "''" : "NEW"} --output - > /out` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output), dirty = `word/${kind}s.xml`; assertPackageLinks(after); for (const [name, bytes] of before) if (name !== dirty) expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get(dirty)); expect(xml.split(marker)).toHaveLength(2); const text = (await api.openDocumentLocations(output, textContext)).text({ scope: kind + "s" as "footnotes" | "endnotes" }); expect(text.text).toBe(clear ? "" : "NEW");
  const descendants = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(descendants)], root = api.parseDocumentXml(after.get(dirty)!, {}).root, nodes = descendants(root), owningRuns = nodes.filter(node => node.localName === "r" && descendants(node).some(child => child.localName === kind + "Ref"));
  expect(xml.split(inert)).toHaveLength((layout === "separate" ? 2 : 1) + 1);
  expect(owningRuns).toHaveLength(1); expect(owningRuns[0]!.attributes.find(a => a.localName === "lang")?.value).toBe("ar-SA"); expect(descendants(owningRuns[0]!).filter(node => node.localName === "rtl")).toHaveLength(1);
  expect(text.segments.filter(s => s.kind === "text").every(s => s.formatting.rtl === null)).toBe(true);
 });
