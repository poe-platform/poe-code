import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const native = { LEFT: "left", RIGHT: "right", START: "start", END: "end", CENTER: "center", DECIMAL: "decimal", BAR: "bar", NUM: "num", CLEAR: "clear", LIST: "list" } as const;
const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const name of [...Object.keys(native), "default"] as readonly (keyof typeof native | "default")[])
for (const action of ["add", "set"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${action} native ${name} tab with coherent live/reloaded values; strict=${strict}; kind=${kind}`, async () => {
  const {input} = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p w:rsidR="00ABCDEF"><w:pPr><w:tabs><!--retain-tabs--><w:tab w:pos="720" w:val="center"/></w:tabs></w:pPr><w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r><?audit keep?></w:p>');
  const value = api.WD_TAB_ALIGNMENT[name === "default" ? "LEFT" : name], reject = strict && name === "LIST", expectedName = strict && (name === "default" || name === "LEFT") ? "START" : strict && name === "RIGHT" ? "END" : name === "default" ? "LEFT" : name;
  const memory = Volume.fromJSON({"/out": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/out", bytes);}};
  const operations = [
    {operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs"},
    {operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: {resultHandle: "paragraphs", index: 0}, arguments: {}, resultHandle: "format"},
    {operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}, resultHandle: "stops"},
    ...(action === "add" ? [{operation: "model.text.tabstops.TabStops.add_tab_stop.call", receiver: ref("stops"), arguments: {position: {value: 1080, unit: "twip"}, ...(name === "default" ? {} : {alignment: value})}, resultHandle: "stop"}] : [
      {operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: ref("stops"), arguments: {index: 0}, resultHandle: "stop"},
      {operation: "model.text.tabstops.TabStop.alignment.set", receiver: ref("stop"), arguments: {value}}
    ]),
    {operation: "model.text.tabstops.TabStop.alignment.get", receiver: ref("stop"), arguments: {}}
  ];
  if (route === "model") {
    const doc = await api.Document(input, textContext), tabs = doc.paragraphs[0]!.paragraph_format.tab_stops;
    if (reject) {expect(() => action === "add" ? tabs.add_tab_stop(api.Twips(1080), value) : Reflect.set(tabs.at(0), "alignment", value)).toThrow(api.UnsupportedEditError); await doc.save(sink); expect(new Uint8Array(memory.readFileSync("/out") as Buffer)).toEqual(input); return;}
    const stop = action === "add" ? name === "default" ? tabs.add_tab_stop(api.Twips(1080)) : tabs.add_tab_stop(api.Twips(1080), value) : tabs.at(0);
    if (action === "set") stop.alignment = value;
    expect(stop.alignment).toEqual({enum: "WD_TAB_ALIGNMENT", name: expectedName});
    expect([...stop.element.attributes].find(([key]) => key.localName === "val" && key.namespaceURI === stop.element.namespace)?.[1]).toBe(native[expectedName]);
    await doc.save(sink);
  } else if (route === "sdk") {
    if (reject) {await expect(api.applyStyleModelBatch(input, {version: 1, operations}, textContext)).rejects.toMatchObject({code: "unsupported-edit"}); expect(memory.readFileSync("/out")).toHaveLength(0); return;}
    const result = await api.applyStyleModelBatch(input, {version: 1, operations}, textContext); expect(result.results.at(-1)!.value).toEqual({enum: "WD_TAB_ALIGNMENT", name: expectedName}); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})}));
    try {const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations})}' --output /out --json`); expect(await fs.readFile("/input")).toEqual(input); if (reject) {expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout).errors[0].code).toBe("unsupported-edit"); await expect(fs.readFile("/out")).rejects.toBeDefined(); return;} expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toEqual({enum: "WD_TAB_ALIGNMENT", name: expectedName}); memory.writeFileSync("/out", await fs.readFile("/out"));} finally {await shell.dispose();}
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [part, bytes] of before) if (part !== "word/document.xml") expect(after.get(part), part).toEqual(bytes);
  const doc = await api.Document(output, textContext), stops = doc.paragraphs[0]!.paragraph_format.tab_stops;
  expect(stops.at(action === "add" ? 1 : 0).alignment).toEqual({enum: "WD_TAB_ALIGNMENT", name: expectedName}); expect(doc.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊");
  const xml = new api.DocumentXmlEditor(after.get("word/document.xml")!), tabNodes = xml.root.children[0]!.children[0]!.children[0]!.children[0]!.children;
  expect(tabNodes.map(n => Object.fromEntries(n.attributes.filter(a => a.namespace === n.namespace).map(a => [a.localName, a.value])))).toEqual(action === "add" ? [{pos: "720", val: "center"}, {pos: "1080", val: native[expectedName]}] : [{pos: "720", val: native[expectedName]}]);
  expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain("<!--retain-tabs-->"); expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain("<?audit keep?>");
});
