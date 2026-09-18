import { Ajv2020 } from "ajv/dist/2020.js";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, getDocxDiscovery, type DocxSchemaData, formatDocumentRuns, executeDocumentBatch, openDocumentLocations } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const properties = '<w:rPr><w:b/><w:rtl/><w:lang w:val="ar-SA" w:eastAsia="ja-JP"/><w:rFonts w:eastAsia="Original CJK" w:cs="Original Arabic"/><w:color w:val="224466"/><f:opaque f:identity="retain">Stored</f:opaque></w:rPr>';
const replacements = ["Changed", "", "🌊 é日本 العربية עברית", "A\tB\nC\rD", "Original"];
for (const strict of [false, true]) for (const route of ["model", "sdk", "shell", "sdk-batch", "shell-batch"] as const)
 for (const override of [false, true]) for (const text of replacements)
 it(`${route} assigns whole run text and retains owned formatting; override=${override} text=${JSON.stringify(text)} strict=${strict}`, async () => {
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:run-assignment" mc:Ignorable="f"><w:pPr><w:keepNext/></w:pPr><w:r>${properties}<w:t>Original</w:t><w:tab/><w:noBreakHyphen/><w:softHyphen/><w:cr/><w:br/></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> untouched</w:t></w:r></w:p>`, {}, strict), original = input.slice(), memory = Volume.fromJSON({ "/out": "" });
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
  expect(p.runs).toHaveLength(2); expect(run.text).toBe(text.split("\r").join("\n")); expect(p.runs[1]!.text).toBe(" untouched"); expect(p.runs[1]!.italic).toBe(true); expect(p.paragraph_format.keep_with_next).toBe(true);
  expect(run.bold).toBe(!override); expect(run.italic).toBe(override ? true : null); expect(run.font.rtl).toBe(true); expect(run.font.color.rgb?.toString()).toBe("224466");
  const xml = new TextDecoder().decode(after.get("word/document.xml")); for (const retained of ['<f:opaque f:identity="retain">Stored</f:opaque>', '<w:lang w:val="ar-SA" w:eastAsia="ja-JP"/>', '<w:rFonts w:eastAsia="Original CJK" w:cs="Original Arabic"/>']) expect(xml.split(retained)).toHaveLength(2);
 });

for (const strict of [false, true]) for (const owner of ["p", "r"] as const) for (const active of [false, true]) for (const action of ["set", "clear"] as const)
 it(`model ${action} text admits only inert complex ${owner} history; active=${active} strict=${strict}`, async () => {
  const history = `<w:${owner}PrChange w:id="7" w:author="Reviewer"><w:${owner}Pr>${owner === "r" ? '<w:color w:val="884466"/>' : '<w:spacing w:after="120"/>'}</w:${owner}Pr></w:${owner}PrChange>`;
  const props = `<w:${owner}Pr>${active ? history : `<f:opaque>${history}</f:opaque>`}</w:${owner}Pr>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:assignment-history" mc:Ignorable="f">${owner === "p" ? props : ""}<w:r>${owner === "r" ? props : ""}<w:t>coast</w:t></w:r></w:p>`, {}, strict), doc = await Document(input, textContext), run = doc.paragraphs[0]!.runs[0]!;
  const change = () => { if (action === "clear") run.clear(); else run.text = "Changed"; };
  if (active) { expect(change).toThrowError(expect.objectContaining({ code: "unsupported-edit" })); expect(run.text).toBe("coast"); } else change();
  const memory = Volume.fromJSON({ "/out": "" }); await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  for (const [name, bytes] of before) if (active || name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  expect((await Document(output, textContext)).paragraphs[0]!.text).toBe(active ? "coast" : action === "clear" ? "" : "Changed");
  expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(history);
 });

for (const strict of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
 for (const [leaf, nested] of [["t", "drawing"], ["tab", "footnoteReference"], ["br", "fldChar"]] as const)
 it(`${route} refuses assignment through nested ${nested} in ${leaf}; strict=${strict}`, async () => {
  const expected = route === "model" || nested === "drawing" ? "unsupported-edit" : "invalid-package";
  const input = await textFixture(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:${leaf}><w:${nested}/></w:${leaf}></w:r></w:p>`, {}, strict), memory = Volume.fromJSON({ "/out": "" });
  if (route === "model") { const doc = await Document(input, textContext), run = doc.paragraphs[0]!.runs[0]!; expect(() => { run.text = "Changed"; }).toThrowError(expect.objectContaining({ code: expected })); }
  else if (route === "sdk") await expect(formatDocumentRuns(input, { paragraph: 1, run: 1, text: "Changed", output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: expected });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec("docx runs set /input --paragraph 1 --run 1 --text Changed --output - > /out"); expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(result.stderr).toContain(expected); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  expect(memory.readFileSync("/out")).toHaveLength(0);
 });

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const) for (const domain of ["text", "properties"] as const)
 for (const route of ["model", "sdk", "shell", "sdk-batch", "shell-batch"] as const) for (const text of ["Changed", ""])
 it(`${route} assigns active ${domain} ${carrier} run text without removing inert content; text=${JSON.stringify(text)} strict=${strict}`, async () => {
  const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006", inactive = domain === "text" ? '<w:t>Inactive coast</w:t>' : '<w:rPr><w:i/></w:rPr>';
  const active = domain === "text" ? '<w:t>co</w:t><w:tab/><w:t>ast</w:t>' : '<w:rPr><w:b/><w:color w:val="224466"/></w:rPr>';
  const wrapped = carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const run = domain === "text" ? '<w:rPr><w:b/><w:color w:val="224466"/></w:rPr>' + wrapped : wrapped + '<w:t>coast</w:t>';
  const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="urn:original:assignment-carriers" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r>${run}</w:r></w:p>`, {}, strict), memory = Volume.fromJSON({ "/out": "" });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } }, options = { paragraph: 1, run: 1, text }, batch = { version: 1, operations: [{ id: "assign", operation: "runs.set", arguments: options }] };
  if (route === "model") { const doc = await Document(input, textContext); doc.paragraphs[0]!.runs[0]!.text = text; await doc.save(context.stdout); }
  else if (route === "sdk") await formatDocumentRuns(input, { ...options, output: "-" }, context);
  else if (route === "sdk-batch") await executeDocumentBatch(input, batch, { output: "-" }, context);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const path = route === "shell-batch" ? `batch /input --ops-json '${JSON.stringify(batch)}'` : `runs set /input --paragraph 1 --run 1 --text '${text}'`; const result = await shell.exec(`docx ${path} --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const p = (await Document(output, textContext)).paragraphs[0]!; expect(p.runs.map(r => [r.text, r.bold, r.font.color.rgb?.toString()])).toEqual([[text, true, "224466"]]); expect(new TextDecoder().decode(after.get("word/document.xml"))).toContain(inactive);
 });

for (const strict of [false, true]) for (const batch of [false, true])
 it(`CLI run text assignment emits its declared result shape; batch=${batch} strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original</w:t></w:r></w:p>', {}, strict), fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
  const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
   const operations = { version: 1, operations: [{ id: "assign", operation: "runs.set", arguments: { paragraph: 1, run: 1, text: "Changed" } }] };
   const path = batch ? `batch /input --ops-json '${JSON.stringify(operations)}'` : "runs set /input --paragraph 1 --run 1 --text Changed";
   const result = await shell.exec(`docx ${path} --dry-run --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
   const envelope = JSON.parse(result.stdout), item = batch ? envelope.data.results[0] : envelope;
   expect(item.data.changes[0]!.kind).toBe("replace"); expect(item.data.changes[0]!.after.kind).toBe("run"); expect(item.data.changes[0]!.after.value.range).toBe(null);
   const declaration = (getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: batch ? "batch" : "runs.set" } })!.data as DocxSchemaData).operations[0]!.result;
   const batchItems = batch ? declaration.oneOf!.find(branch => branch.properties?.ok?.const === true)!.properties!.data!.properties!.results!.items : undefined;
   if (batchItems === false) throw new Error("Missing batch item contract.");
   const schema = batch ? batchItems!.oneOf!.find(branch => branch.properties?.operation?.const === "runs.set")! : declaration;
   const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema); expect(validate(item), JSON.stringify(validate.errors)).toBe(true);
   expect(await fs.readFile("/input")).toEqual(input);
  } finally { await shell.dispose(); }
 });

for (const strict of [false, true]) for (const owner of ["run", "paragraph"] as const) for (const range of ["partial", "whole", "caret"] as const)
 for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
 it(`${route} refuses whole-run assignment through ${owner} ${range} scalar range; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Original</w:t></w:r></w:p>', {}, strict), locations = await openDocumentLocations(input, textContext);
  const token = locations.at(owner, 1, owner === "run" ? { owner: locations.at("paragraph", 1).token } : {}).token;
  const select = locations.range(token, range === "partial" ? 1 : 0, range === "partial" ? 3 : range === "whole" ? 8 : 0).token;
  const memory = Volume.fromJSON({ "/out": "" }), options = { select, text: "Changed" }, batch = { version: 1, operations: [{ id: "assign", operation: "runs.set", arguments: options }] };
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  if (route === "sdk") await expect(formatDocumentRuns(input, { ...options, output: "-" }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  else if (route === "sdk-batch") await expect(executeDocumentBatch(input, batch, { output: "-" }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const path = route === "shell-batch" ? `batch /input --ops-json '${JSON.stringify(batch)}'` : `runs set /input --select '${select}' --text Changed`; const result = await shell.exec(`docx ${path} --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(result.stderr).toContain("unsupported-edit"); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/out")).toHaveLength(0);
 });
