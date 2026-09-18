import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { w, textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

type Route = "model" | "sdk" | "shell";
const cases = [
 { name: "rebind", args: { linkedStyle: "Second character", defaultForType: true }, links: ["Second character", "Harbor", null, null], defaults: [true, false] },
 { name: "clear", args: { linkedStyle: null, defaultForType: false }, links: [null, "Base", "Second character", null], defaults: [false, true] },
 { name: "unchanged", args: { linkedStyle: "First character", defaultForType: false }, links: ["First character", "Base", "Second character", "Harbor"], defaults: [false, true] },
 { name: "omitted", args: {}, links: ["First character", "Base", "Second character", "Harbor"], defaults: [false, true] },
 { name: "default-only", args: { defaultForType: true }, links: ["First character", "Base", "Second character", "Harbor"], defaults: [true, false] },
 { name: "link-only", args: { linkedStyle: "Second character" }, links: ["Second character", "Harbor", null, null], defaults: [false, true] }
] as const;
const batch = (args: unknown) => ({ version: 1, operations: [
 { operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" },
 { operation: "model.styles.styles.Styles.__getitem__.call", receiver: { resultHandle: "styles" }, arguments: { key: "Harbor" }, resultHandle: "style" },
 { operation: "styles.links.set", receiver: { resultHandle: "style" }, arguments: args }
] });
async function execute(input: Uint8Array, args: unknown, route: Route, rejection = false) {
 const memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
 if (route === "model") { if (rejection) await expect(api.applyStyleModelBatch(input, batch(args), textContext)).rejects.toMatchObject({ code: "usage" }); else { const model = await api.applyStyleModelBatch(input, batch(args), textContext); await model.save(sink); } }
 else if (route === "sdk") { const result = api.executeDocumentBatch(input, batch(args), { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink }); if (rejection) await expect(result).rejects.toMatchObject({ code: "usage" }); else await result; }
 else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify(batch(args))}' --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(rejection ? 2 : 0); if (rejection) expect(result.stderr).toContain("Formatting set requires an effect field."); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
 }
 if (rejection) { expect(memory.readFileSync("/out")).toHaveLength(0); return input; }
 return new Uint8Array(memory.readFileSync("/out") as Buffer);
}
for (const strict of [false, true]) for (const route of ["model", "sdk", "shell"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const value of cases)
 it(`${route} ${value.name} advanced native style links and defaults; carrier=${carrier}; strict=${strict}`, async () => {
  const wrap = (active: string, identity: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque f:id="${identity}"><w:link w:val="stored-inert"/></f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : `<f:opaque f:id="${identity}"/>`}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : `<f:opaque f:id="${identity}"/>`}</mc:Fallback></mc:AlternateContent>`;
  const style = (id: string, type: string, name: string, link: string, props: string, def = "") => wrap(`<w:style w:type="${type}" w:styleId="${id}"${def}><w:name w:val="${name}"/>${wrap(`<w:link w:val="${link}"/>`, `link-${id}`)}${props}<!--native-${id}--></w:style>`, `style-${id}`);
  const xml = `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:style-links" mc:Ignorable="f" mc:ProcessContent="f:pass">${style("p0", "paragraph", "Harbor", "c0", "<w:rPr><w:b/></w:rPr>")}${style("p1", "paragraph", "Base", "c1", "", ' w:default="1"')}${style("c0", "character", "First character", "p0", "")}${style("c1", "character", "Second character", "p1", "<w:rPr><w:i/></w:rPr>")}<!--retained--><?review keep?></w:styles>`;
  const input = await textFixture('<w:p><w:pPr><w:pStyle w:val="p0"/></w:pPr><w:r><w:t>Original</w:t></w:r></w:p>', { styles: { kind: "styles", xml } }, strict), output = await execute(input, value.args, route, value.name === "omitted"), before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/styles.xml" || value.name === "unchanged" || value.name === "omitted") expect(after.get(name), name).toEqual(bytes);
  const definitions = (await api.inspectDocumentStyles(output, {}, textContext)).styles, info = (name: string) => definitions.find(s => s.name === name)!;
  expect([info("Harbor").linkedStyle, info("Second character").linkedStyle, info("Base").linkedStyle, info("First character").linkedStyle]).toEqual(value.links);
  expect([info("Harbor").defaultForType, info("Base").defaultForType]).toEqual(value.defaults); expect(info("Harbor").direct.bold).toBe(true); expect(info("Second character").direct.italic).toBe(true);
  const saved = new TextDecoder().decode(after.get("word/styles.xml")); for (const marker of ["<!--retained-->", "<?review keep?>", ...["p0", "p1", "c0", "c1"].map(id => `<!--native-${id}-->`)]) expect(saved.split(marker)).toHaveLength(2);
  if (carrier !== "direct") for (const id of ["p0", "p1", "c0", "c1"]) for (const scope of ["style", "link"]) expect(saved.split(`f:id="${scope}-${id}"`)).toHaveLength(2);
 });
