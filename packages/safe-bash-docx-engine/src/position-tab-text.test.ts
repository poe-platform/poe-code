import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, extractDocumentText, replaceDocumentText, openDocumentLocations, formatDocumentRuns, editDocumentParagraphs } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const tab = '<w:ptab w:alignment="right" w:relativeTo="margin" w:leader="dot"/>';
for (const strict of [false, true]) for (const route of ["sdk", "shell"] as const)
  for (const action of ["read", "replace", "range", "format", "paragraph", "insert"] as const)
    it(`${route} ${action} positional tabs without inventing layout; strict=${strict}`, async () => {
      const input = await textFixture(`<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>🌊A</w:t>${tab}<w:t>B</w:t>${tab}<w:t>C</w:t></w:r></w:p>`, {}, strict);
      const document = await Document(input, textContext);
      expect(document.paragraphs[0]!.text).toBe("🌊A\tB\tC");
      expect([...document.paragraphs[0]!.runs[0]!.iter_inner_content()]).toEqual(["🌊A\tB\tC"]);
      const memory = Volume.fromJSON({ "/out": "" });
      const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
      let select: string | undefined;
      if (["range", "format", "insert"].includes(action)) {
        const locations = await openDocumentLocations(input, textContext);
        select = locations.range(locations.at("paragraph", 1).token, 1, action === "insert" ? 1 : 4).token;
        expect(() => locations.range(locations.at("paragraph", 1).token, 0, 7)).toThrow();
      }
      if (route === "sdk") {
        if (action === "read") {
          const result = await extractDocumentText(input, textContext);
          expect(result.text).toBe("🌊A\tB\tC");
          expect(result.segments.filter(s => s.kind === "tab").map(s => s.text)).toEqual(["\t", "\t"]);
          return;
        }
        if (action === "replace" || action === "range") await replaceDocumentText(input, { find: "A\tB", with: "Shore", all: true, ...(select ? { select } : {}), output: "-" }, context);
        else if (action === "format") await formatDocumentRuns(input, { select: select!, italic: true, output: "-" }, context);
        else if (action === "paragraph") await editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, text: "Changed", output: "-" } }, context);
        else await editDocumentParagraphs(input, { operation: "runs.add", options: { select: select!, text: "X", output: "-" } }, context);
      } else {
        const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
        const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
        const command = action === "read" ? "text /input --json" : action === "replace" || action === "range"
          ? `text replace /input --find 'A\tB' --with Shore --all${select ? ` --select '${select}'` : ""}`
          : action === "format" ? `runs set /input --select '${select}' --italic true`
          : action === "paragraph" ? "paragraphs set /input --paragraph 1 --text Changed" : `runs add /input --select '${select}' --text X`;
        try {
          const result = await shell.exec("docx " + command + (action === "read" ? "" : " --output - > /out"));
          expect(result.exitCode, result.stdout + result.stderr).toBe(0);
          expect(await fs.readFile("/input")).toEqual(input);
          if (action === "read") { expect(JSON.parse(result.stdout).data.text).toBe("🌊A\tB\tC"); return; }
          memory.writeFileSync("/out", await fs.readFile("/out"));
        } finally { await shell.dispose(); }
      }
      const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
      for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
      const loaded = await Document(output, textContext), p = loaded.paragraphs[0]!;
      expect(p.text).toBe(action === "replace" || action === "range" ? "🌊Shore\tC" : action === "paragraph" ? "Changed" : action === "insert" ? "🌊XA\tB\tC" : "🌊A\tB\tC");
      expect(p.paragraph_format.keep_with_next).toBe(true);
      const xml = new TextDecoder().decode(after.get("word/document.xml"));
      if (action !== "paragraph") expect(xml).toContain(tab);
      if (action === "format") expect(p.runs.map(r => [r.text, r.italic])).toEqual([["🌊", null], ["A\tB", true], ["\tC", null]]);
    });

for (const strict of [false, true]) for (const action of ["set", "clear"] as const)
  it(`model ${action} run text removes positional tabs and retains formatting; strict=${strict}`, async () => {
    const input = await textFixture(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Before</w:t>${tab}<w:t>After</w:t></w:r></w:p>`, {}, strict);
    const document = await Document(input, textContext), run = document.paragraphs[0]!.runs[0]!;
    if (action === "set") run.text = "Changed"; else run.clear();
    expect(run.text).toBe(action === "set" ? "Changed" : "");
    expect(run.bold).toBe(true);
    const memory = Volume.fromJSON({ "/out": "" });
    await document.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
    const loaded = await Document(new Uint8Array(memory.readFileSync("/out") as Buffer), textContext);
    expect(loaded.paragraphs[0]!.runs[0]!.text).toBe(run.text);
    expect(loaded.paragraphs[0]!.runs[0]!.bold).toBe(true);
  });
