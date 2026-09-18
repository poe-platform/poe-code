import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} reports every stored run font slot and hidden state without style-name aliases; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:rPr><w:vanish w:val="0"/><w:rFonts w:ascii="Coast A" w:hAnsi="Coast B" w:eastAsia="Coast C" w:cs="Coast D" w:asciiTheme="majorAscii" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="majorEastAsia" w:cstheme="minorBidi"/><w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/><w:color w:val="123456" w:themeColor="accent1" w:themeTint="80"/><w:vertAlign w:val="baseline"/></w:rPr><w:t>Stored typeface</w:t></w:r></w:p>');
  let data: api.TextResourceInspectionData;
  if (route === "sdk") data = await api.inspectDocumentRun(input, { paragraph: 1, run: 1 }, textContext);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx runs get /input --paragraph 1 --run 1 --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); data = JSON.parse(result.stdout).data; expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  }
  const properties = data.item.properties;
  expect(properties).toContainEqual({ name: "hidden", type: "boolean", value: false, writable: true, cached: false });
  expect(properties.some(p => p.name === "fontHidden")).toBe(false);
  for (const [name, value] of Object.entries({ ascii: "Coast A", highAnsi: "Coast B", eastAsia: "Coast C", complexScript: "Coast D", asciiTheme: "majorAscii", highAnsiTheme: "minorHAnsi", eastAsiaTheme: "majorEastAsia", complexScriptTheme: "minorBidi", language: "en-US" }))
    expect(properties, name).toContainEqual({ name, type: "string", value, writable: true, cached: false });
  for (const [name, value] of Object.entries({ eastAsiaLanguage: "ja-JP", bidiLanguage: "ar-SA", themeTint: "80", themeShade: null }))
    expect(properties, name).toContainEqual({ name, type: "string", value, writable: false, cached: false });
  for (const name of ["superscript", "subscript"]) expect(properties).toContainEqual({ name, type: "boolean", value: false, writable: true, cached: false });
});
