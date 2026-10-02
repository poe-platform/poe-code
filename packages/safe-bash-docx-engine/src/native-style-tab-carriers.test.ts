import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, ParagraphStyle, Twips, WD_TAB_ALIGNMENT, WD_TAB_LEADER, applyStyleModelBatch, createDocxInspectionCommandEngine, writeArchive } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const ref = (resultHandle: string) => ({resultHandle});
const quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice"] as const) for (const action of ["position", "alignment", "leader"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} changes selected style tab ${action} in ${carrier}; ${kind} strict=${strict}`, async () => {
  const declaration = '<w:style w:type="paragraph" w:styleId="Coast"><w:name w:val="Coast"/><w:pPr><w:tabs><!--before--><w:tab w:pos="720" w:val="right" w:leader="dot"/><?keep middle?><w:tab w:pos="1800" w:val="left" w:leader="underscore"/><!--after--></w:tabs></w:pPr></w:style>';
  const fallback = '<mc:Fallback><w:style w:type="table" w:styleId="Coast"><w:name w:val="Inactive"/></w:style></mc:Fallback>';
  const xml = `<w:styles xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${carrier === "direct" ? declaration : `<mc:AlternateContent><mc:Choice Requires="w">${declaration}</mc:Choice>${fallback}</mc:AlternateContent>`}</w:styles>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {styles: {kind: "styles", xml}}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = action === "position" ? {value: 2200, unit: "twip"} : action === "alignment" ? {enum: "WD_TAB_ALIGNMENT", name: "DECIMAL"} : {enum: "WD_TAB_LEADER", name: "DASHES"};
  const batch = {version: 1 as const, operations: [
    {operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles"},
    {operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: {key: "Coast"}, resultHandle: "style"},
    {operation: "model.styles.style.ParagraphStyle.paragraph_format.get", receiver: ref("style"), arguments: {}, resultHandle: "format"},
    {operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}, resultHandle: "stops"},
    {operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: ref("stops"), arguments: {index: 0}, resultHandle: "stop"},
    {operation: `model.text.tabstops.TabStop.${action}.set`, receiver: ref("stop"), arguments: {value}}
  ]};
  if (route === "model") {const doc = await Document(input, textContext), stop = (doc.styles.at("Coast") as ParagraphStyle).paragraph_format.tab_stops.at(0); if (action === "position") stop.position = Twips(2200); else if (action === "alignment") stop.alignment = WD_TAB_ALIGNMENT.DECIMAL; else stop.leader = WD_TAB_LEADER.DASHES; await doc.save(sink);}
  else if (route === "sdk") await (await applyStyleModelBatch(input, batch, textContext)).save(sink);
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})); const result = await shell.exec("docx batch /input --ops-json " + quote(JSON.stringify(batch)) + " --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);}
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), styles = new TextDecoder().decode(saved.get("word/styles.xml"));
  for (const [name, bytes] of parts) if (name !== "word/styles.xml") expect(saved.get(name), name).toEqual(bytes);
  for (const text of ['<!--before-->', '<?keep middle?>', '<!--after-->']) expect(styles).toContain(text);
  if (carrier === "choice") expect(styles).toContain(fallback);
  const stops = [...((await Document(output, textContext)).styles.at("Coast") as ParagraphStyle).paragraph_format.tab_stops];
  expect(stops.map(stop => [stop.position.twips, stop.alignment.name, stop.leader.name])).toEqual(action === "position" ? [[1800, "LEFT", "LINES"], [2200, "RIGHT", "DOTS"]] : [[720, action === "alignment" ? "DECIMAL" : "RIGHT", action === "leader" ? "DASHES" : "DOTS"], [1800, "LEFT", "LINES"]]);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
