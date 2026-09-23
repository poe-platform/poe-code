import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const empty = {
  bold: null, italic: null, allCaps: null, complexScriptEnabled: null, csBold: null, csItalic: null,
  doubleStrike: null, emboss: null, imprint: null, math: null, noProof: null, outline: null,
  shadow: null, smallCaps: null, snapToGrid: null, specVanish: null, webHidden: null,
  strike: null, fontHidden: null, rtl: null, font: null, size: null, color: null, themeColor: null,
  underline: null, highlight: null, baseline: null, language: null, outlineLevel: null,
  keepWithNext: null, keepTogether: null, widowControl: null, pageBreakBefore: null,
  spaceBefore: null, spaceAfter: null, leftIndent: null, rightIndent: null, firstLineIndent: null,
  lineSpacing: null, lineSpacingRule: null, alignment: null, tabStops: null, numbering: null,
};

for (const strict of [false, true]) for (const route of ["sdk", "sdk-batch", "cli", "cli-batch"] as const)
  for (const scenario of ["absent", "complete", "cycle"] as const) {
    it(`independently asserts every style-inspection field ${strict}/${route}/${scenario}`, async () => {
      const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const runXml = '<w:rPr xmlns:f="urn:original:raw" f:stored="retain"><w:b/><w:i w:val="false"/><w:rtl/><w:rFonts w:ascii="日本 Serif" w:eastAsia="東亞"/><w:sz w:val="25"/><w:color w:val="A1B2C3" w:themeColor="accent2"/><w:u w:val="double"/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/><w:lang w:val="he-IL"/><!--run--><?audit keep?><f:opaque/></w:rPr>';
      const paragraphXml = `<w:pPr><w:keepNext/><w:keepLines w:val="false"/><w:widowControl/><w:pageBreakBefore w:val="0"/><w:spacing w:before="120" w:after="180" w:line="360" w:lineRule="auto"/><w:ind w:${strict ? "start" : "left"}="720" w:${strict ? "end" : "right"}="-360" w:hanging="240"/><w:jc w:val="right"/><w:outlineLvl w:val="9"/><w:tabs><w:tab w:pos="360"/><w:tab w:pos="720" w:val="right" w:leader="dot"/></w:tabs><!--paragraph--><?audit keep?></w:pPr>`;
      const tableXml = '<w:tblPr><w:tblW w:w="5000" w:type="pct"/><!--table--><?audit keep?></w:tblPr>';
      const latentXml = '<w:latentStyles w:defSemiHidden="1" w:defLockedState="0" w:defQFormat="true" w:defUnhideWhenUsed="false" w:defUIPriority="99" w:count="0"><w:lsdException w:name="heading 1" w:semiHidden="false" w:locked="1" w:qFormat="0" w:unhideWhenUsed="true" w:uiPriority="0"/><w:lsdException w:name="Exact 日本"/><!--latent--><?audit keep?></w:latentStyles>';
      const inner = scenario === "complete" ? latentXml + '<w:style w:type="table" w:styleId="Grid" w:customStyle="1"><w:name w:val="Grid"/><w:uiPriority w:val="0"/><w:semiHidden/><w:locked w:val="false"/><w:qFormat/><w:unhideWhenUsed w:val="0"/>' + paragraphXml + runXml + tableXml + '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr></w:tblStylePr></w:style>' : '<w:style w:styleId="A"><w:name w:val="A"/><w:basedOn w:val="B"/></w:style><w:style w:styleId="B"><w:name w:val="B"/><w:basedOn w:val="A"/></w:style>';
      const input = await textFixture('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Original 日本 עברית é 🌊</w:t></w:r></w:p>', scenario === "absent" ? {} : {styles: {kind: "styles", xml: `<w:styles xmlns:w="${w}">${inner}</w:styles>`}}, strict);
      const before = input.slice(), parts = readPackage(before), volume = Volume.fromJSON({"/input": Buffer.from(input), "/sink": "", "/destination": "Retain destination"});
      const style = (id: string, extra: object) => ({id, name: id, type: "paragraph", builtin: true, base: null, next: id, linkedStyle: null, defaultForType: false, priority: null, hidden: false, locked: false, quickStyle: false, unhideWhenUsed: false, direct: {...empty}, effective: {...empty}, runXml: null, paragraphXml: null, tableXml: null, ...extra});
      const formatting = {...empty, bold: true, italic: false, rtl: true, font: "日本 Serif", size: 12.5, color: "A1B2C3", themeColor: "accent2", underline: "double", highlight: "yellow", baseline: "superscript", language: "he-IL", outlineLevel: 9, keepWithNext: true, keepTogether: false, widowControl: true, pageBreakBefore: false, spaceBefore: 6, spaceAfter: 9, leftIndent: 36, rightIndent: -18, firstLineIndent: -12, lineSpacing: 1.5, lineSpacingRule: "auto", alignment: "right", tabStops: [{position: 18, alignment: "left", leader: "none"}, {position: 36, alignment: "right", leader: "dot"}]};
      const expected = {
        styles: scenario === "absent" ? [] : scenario === "cycle" ? [style("A", {base: "B", effective: null}), style("B", {base: "A", effective: null})] : [style("Grid", {type: "table", builtin: false, next: null, priority: 0, hidden: true, quickStyle: true, direct: formatting, effective: {...formatting, italic: null}, runXml, paragraphXml, tableXml})],
        defaults: {run: {...empty}, paragraph: {...empty}}, latentXml: scenario === "complete" ? latentXml : null,
        latent: scenario === "complete" ? {defaults: {defaultToHidden: true, defaultToLocked: false, defaultToQuickStyle: true, defaultToUnhideWhenUsed: false, defaultPriority: 99, loadCount: 0}, entries: [{name: "Heading 1", hidden: false, locked: true, quickStyle: false, unhideWhenUsed: true, priority: 0}, {name: "Exact 日本", hidden: null, locked: null, quickStyle: null, unhideWhenUsed: null, priority: null}]} : null,
        diagnostics: scenario === "cycle" ? [{code: "style-cycle", part: "/word/styles.xml", location: "/styles[1]/style[1]", message: "Style inheritance contains a cycle."}] : [],
      };
      const batch = {version: 1 as const, operations: [{operation: "styles.list" as const, arguments: {}}]};
      let result: unknown;
      if (route === "sdk") result = await api.inspectDocumentStyles(input, {}, textContext);
      else if (route === "sdk-batch") {
        const report = await api.executeDocumentBatch(input, batch, {}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {volume.appendFileSync("/sink", bytes);}}});
        expect(report.publication).toBeNull(); expect(report.results[0]!.affected).toBe(0); result = report.results[0]!.data;
      } else {
        const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
        const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})}));
        try {
          const read = await shell.exec(route === "cli" ? "docx styles list /input --json" : `docx batch /input --ops-json '${JSON.stringify(batch)}' --json`), envelope = JSON.parse(read.stdout);
          expect(read.exitCode, read.stdout + read.stderr).toBe(0); expect(envelope.ok).toBe(true); expect(envelope.affected).toBe(0); expect(envelope.locations).toEqual([]); result = route === "cli" ? envelope.data : envelope.data.results[0].data;
          expect(await fs.readFile("/input")).toEqual(before); expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retain destination");
        } finally {await shell.dispose();}
      }
      expect(result).toEqual(expected); expect(input).toEqual(before); expect(new Uint8Array(volume.readFileSync("/input") as Buffer)).toEqual(before);
      expect(volume.readFileSync("/sink").length).toBe(0); expect(volume.readFileSync("/destination", "utf8")).toBe("Retain destination");
      for (const [name, bytes] of readPackage(input)) expect(bytes, name).toEqual(parts.get(name));
    });
  }
