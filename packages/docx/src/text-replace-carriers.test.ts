import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, extractDocumentText, replaceDocumentText } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const future = "urn:original:text-carrier";

for (const strict of [false, true]) for (const route of ["sdk", "shell"] as const)
  for (const carrier of ["choice", "fallback", "process"] as const)
    for (const level of ["run", "text"] as const)
      it(`replaces logical Unicode across ${level} ${carrier} through ${route}; strict=${strict}`, async () => {
        const wrap = (active: string) => carrier === "process"
          ? `<f:pass>${active}</f:pass><f:opaque><w:r><w:t>inactive</w:t></w:r></f:opaque>`
          : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : "<w:r><w:t>inactive</w:t></w:r>"}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : "<w:r><w:t>inactive</w:t></w:r>"}</mc:Fallback></mc:AlternateContent>`;
        const properties = '<w:rPr><w:b/><w:rtl/><w:lang w:val="ar-SA" w:eastAsia="ja-JP"/><w:color w:val="224466"/></w:rPr>';
        const selected = level === "run"
          ? `<w:r>${properties}<w:t>🌊 é</w:t></w:r>${wrap('<w:r><w:rPr><w:i/></w:rPr><w:t>日本 العربية</w:t></w:r>')}<w:r><w:t> tail</w:t></w:r>`
          : `<w:r>${properties}<w:t>🌊 é</w:t>${wrap('<w:t>日本 العربية</w:t>')}<w:t> tail</w:t></w:r>`;
        const untouched = '<w:p><w:r><w:t>Unselected</w:t></w:r></w:p>';
        const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f" mc:ProcessContent="f:pass">${selected}</w:p>${untouched}`, {}, strict);
        expect((await extractDocumentText(input, textContext)).text).toBe("🌊 é日本 العربية tail\nUnselected");
        const original = input.slice();
        const memory = Volume.fromJSON({ "/out": "" });
        if (route === "sdk") {
          const result = await replaceDocumentText(input, { find: "é日本", with: "עברית", all: true, output: "-" }, {
            ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } }
          });
          expect(result.changes).toHaveLength(1);
        } else {
          const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
          const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
          const result = await shell.exec("docx text replace /input --find 'é日本' --with 'עברית' --all --output - > /out");
          expect(result.exitCode, result.stderr).toBe(0);
          expect(result.stdout).toBe("");
          expect(await fs.readFile("/input")).toEqual(input);
          memory.writeFileSync("/out", await fs.readFile("/out"));
        }
        expect(input).toEqual(original);
        const output = new Uint8Array(memory.readFileSync("/out") as Buffer);
        const before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
        for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
        const xml = new TextDecoder().decode(after.get("word/document.xml"));
        expect(xml).toContain(untouched);
        expect(xml).toContain(properties);
        expect(xml).toContain("<w:r><w:t>inactive</w:t></w:r>");
        expect((await extractDocumentText(output, textContext)).text).toBe("🌊 עברית العربية tail\nUnselected");
        expect((await Document(output, textContext)).paragraphs.map(p => p.text)).toEqual(["🌊 עברית العربية tail", "Unselected"]);
      });

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const)
  for (const owner of ["p", "r"] as const) for (const active of [false, true])
    it(`admits only inert ${owner} property history in ${carrier}; active=${active} strict=${strict}`, async () => {
      const change = `<w:${owner}PrChange w:id="7" w:author="Reviewer"><w:${owner}Pr/></w:${owner}PrChange>`;
      const wrap = (selected: string, inactive: string) => carrier === "process"
        ? `<f:pass>${selected}</f:pass><f:opaque>${inactive}</f:opaque>`
        : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? selected : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? selected : inactive}</mc:Fallback></mc:AlternateContent>`;
      const history = active ? wrap(`<w:${owner}Pr>${change}</w:${owner}Pr>`, `<w:${owner}Pr/>`)
        : `<w:${owner}Pr>${wrap("", change)}</w:${owner}Pr>`;
      const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f" mc:ProcessContent="f:pass">${owner === "p" ? history : ""}<w:r>${owner === "r" ? history : ""}<w:t>coast</w:t></w:r></w:p>`, {}, strict);
      const memory = Volume.fromJSON({ "/out": "" });
      const result = replaceDocumentText(input, { find: "coast", with: "shore", all: true, output: "-" }, {
        ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } }
      });
      if (active) {
        await expect(result).rejects.toMatchObject({ code: "unsupported-edit" });
        expect(memory.readFileSync("/out")).toHaveLength(0);
      } else {
        expect((await result).changes).toHaveLength(1);
        const output = new Uint8Array(memory.readFileSync("/out") as Buffer);
        expect((await extractDocumentText(output, textContext)).text).toBe("shore");
        const parts = readPackage(output);
        expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain(history);
      }
    });
