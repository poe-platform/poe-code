import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, formatDocumentRuns, executeDocumentBatch } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const properties = '<w:rPr><w:b/><w:rtl/><w:lang w:val="ar-SA" w:eastAsia="ja-JP"/><w:rFonts w:eastAsia="Original CJK" w:cs="Original Arabic"/><w:color w:val="224466"/><f:opaque f:identity="retain">Stored</f:opaque></w:rPr>';
const replacements = ["Changed", "", "🌊 é日本 العربية עברית", "A\tB\nC\rD", "Original"];
for (const strict of [false, true]) for (const route of ["model", "sdk", "shell", "sdk-batch", "shell-batch"] as const)
 for (const override of [false, true]) for (const text of replacements)
 it(`${route} assigns whole run text while retaining opaque scalar slots and local context; override=${override} text=${JSON.stringify(text)} strict=${strict}`, async () => {
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:run-assignment" mc:Ignorable="f"><w:pPr><w:keepNext/></w:pPr><w:r xml:lang="ar-SA">${properties}<w:t>Original</w:t><w:tab/><w:noBreakHyphen/><w:softHyphen/><w:cr/><w:br/><f:shadow f:identity="keep-slot"><w:t>INERT</w:t></f:shadow><!--retained-run--><?original keep?></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> untouched</w:t></w:r></w:p>`, {}, strict), original = input.slice(), memory = Volume.fromJSON({ "/out": "" });
  const flags = override ? { bold: false, italic: true } : {}, options = { paragraph: 1, run: 1, text, ...flags }, batch = { version: 1, operations: [{ id: "assign", operation: "runs.set", arguments: options }] };
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  if (route === "model") {
   const doc = await Document(input, textContext), run = doc.paragraphs[0]!.runs[0]!; run.text = text; if (override) { run.bold = false; run.italic = true; } await doc.save(context.stdout);
  } else if (route === "sdk") { const result = await formatDocumentRuns(input, { ...options, output: "-" }, context); expect(result.changes).toHaveLength(1); expect(result.changes[0]!.kind).toBe("replace"); }
  else if (route === "sdk-batch") await executeDocumentBatch(input, batch, { output: "-" }, context);
  else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const path = route === "shell-batch" ? `batch /input --ops-json '${JSON.stringify(batch)}'` : `runs set /input --paragraph 1 --run 1 --text '${text}'${override ? " --bold false --italic true" : ""}`; const result = await shell.exec(`docx ${path} --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(result.stdout).toBe(""); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  expect(input).toEqual(original); const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await Document(output, textContext), p = doc.paragraphs[0]!, run = p.runs[0]!;
  expect(p.runs).toHaveLength(2); expect([...run.element.attributes].find(([name]) => name.namespaceURI === "http://www.w3.org/XML/1998/namespace" && name.localName === "lang")?.[1]).toBe("ar-SA"); expect(run.text).toBe(text.split("\r").join("\n")); expect(p.runs[1]!.text).toBe(" untouched"); expect(p.runs[1]!.italic).toBe(true); expect(p.paragraph_format.keep_with_next).toBe(true);
  expect(run.bold).toBe(!override); expect(run.italic).toBe(override ? true : null); expect(run.font.rtl).toBe(true); expect(run.font.color.rgb?.toString()).toBe("224466");
  const xml = new TextDecoder().decode(after.get("word/document.xml")); for (const retained of ['<f:shadow f:identity="keep-slot"><w:t>INERT</w:t></f:shadow>', '<!--retained-run-->', '<?original keep?>', '<f:opaque f:identity="retain">Stored</f:opaque>', '<w:lang w:val="ar-SA" w:eastAsia="ja-JP"/>', '<w:rFonts w:eastAsia="Original CJK" w:cs="Original Arabic"/>']) expect(xml.split(retained)).toHaveLength(2);
 });
