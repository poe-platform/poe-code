import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, extractDocumentText, replaceDocumentText, openDocumentLocations, formatDocumentRuns, executeDocumentBatch } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const future = "urn:original:text-carrier";

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const)
 for (const domain of ["text", "segmented-text"] as const) for (const route of ["sdk", "shell"] as const)
 it(`${route} replaces a partial ${domain} ${carrier} run without duplicating inactive text; strict=${strict}`, async () => {
  const textDomain = domain === "text" || domain === "segmented-text", segmented = domain.startsWith("segmented-");
  const content = segmented ? "<w:t>co</w:t><w:tab/><w:t>ast</w:t>" : "<w:t>coast</w:t>";
  const find = segmented ? "o\tas" : "oas";
  const inactive = textDomain ? '<w:t>Inactive coast</w:t>' : '<w:rPr><w:i/></w:rPr>';
  const active = textDomain ? content : '<w:rPr><w:b/><w:color w:val="224466"/></w:rPr>';
  const wrapped = carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const properties = '<w:rPr><w:b/><w:color w:val="224466"/></w:rPr>';
  const run = textDomain ? properties + wrapped : wrapped + content;
  const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r>${run}</w:r></w:p>`, {}, strict), memory = Volume.fromJSON({ "/out": "" });
  expect((await extractDocumentText(input, textContext)).text).toBe(segmented ? "co\tast" : "coast");
  if (route === "sdk") await replaceDocumentText(input, { find, with: "shore", all: true, bold: false, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx text replace /input --find '${find}' --with shore --all --bold false --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const p = (await Document(output, textContext)).paragraphs[0]!; expect(p.runs.map(r => [r.text, r.bold, r.font.color.rgb?.toString()])).toEqual([["c", true, "224466"], ["shore", false, "224466"], ["t", true, "224466"]]);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml.split(inactive)).toHaveLength(2);
 });

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const) for (const position of ["prefix", "middle", "suffix", "repeated"] as const)
 for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
 it(`${route} preserving replacement splits ${carrier} ${position} native content and retains opaque inert identity once; strict=${strict}`, async () => {
  const content = position === "repeated" ? '<w:t>coast coast</w:t>' : '<w:t>co</w:t><w:tab/><w:t>ast</w:t>', inactive = '<f:opaque f:identity="retain">Stored<f:resource/></f:opaque><w:t>Inactive coast</w:t>';
  const wrapped = carrier === "process" ? `<f:pass>${content}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? content : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? content : inactive}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:rtl/><w:rFonts w:eastAsia="Original CJK"/><w:color w:val="224466"/></w:rPr>${wrapped}</w:r><w:r><w:rPr><w:i/></w:rPr><w:t> untouched</w:t></w:r></w:p>`, {}, strict);
  const find = position === "prefix" ? "co" : position === "suffix" ? "ast" : position === "middle" ? "o\tas" : "oas", options = { find, with: "shore", all: true, bold: false }, batch = { version: 1, operations: [{ id: "replace", operation: "text.replace", arguments: options }] };
  const memory = Volume.fromJSON({ "/out": "" }), context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  if (route === "sdk") await replaceDocumentText(input, { ...options, output: "-" }, context);
  else if (route === "sdk-batch") await executeDocumentBatch(input, batch, { output: "-" }, context);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const path = route === "shell-batch" ? `batch /input --ops-json '${JSON.stringify(batch)}'` : `text replace /input --find '${find}' --with shore --all --bold false`; const result = await shell.exec(`docx ${path} --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const p = (await Document(output, textContext)).paragraphs[0]!, expected = position === "prefix" ? [["shore", false], ["\tast", true]] : position === "suffix" ? [["co\t", true], ["shore", false]] : position === "middle" ? [["c", true], ["shore", false], ["t", true]] : [["c", true], ["shore", false], ["t c", true], ["shore", false], ["t", true]];
  expect(p.runs.slice(0, -1).map(run => [run.text, run.bold])).toEqual(expected); expect(p.runs.at(-1)!.text).toBe(" untouched"); expect(p.runs.at(-1)!.italic).toBe(true); expect(p.paragraph_format.keep_with_next).toBe(true); for (const run of p.runs.slice(0, -1)) { expect(run.font.rtl).toBe(true); expect(run.font.color.rgb?.toString()).toBe("224466"); }
  expect(new TextDecoder().decode(after.get("word/document.xml")).split(inactive)).toHaveLength(2);
 });

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const)
 for (const domain of ["properties", "segmented-properties"] as const) for (const route of ["sdk", "shell"] as const)
 it(`${route} replaces a partial ${domain} ${carrier} run with selected properties following every fragment; strict=${strict}`, async () => {
  const segmented = domain.startsWith("segmented-");
  const content = segmented ? "<w:t>co</w:t><w:tab/><w:t>ast</w:t>" : "<w:t>coast</w:t>";
  const find = segmented ? "o\tas" : "oas";
  const inactive = '<w:rPr><w:i/></w:rPr>';
  const active = '<w:rPr><w:b/><w:color w:val="224466"/></w:rPr>';
  const wrapped = carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const run = wrapped + content;
  const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r>${run}</w:r></w:p>`, {}, strict), memory = Volume.fromJSON({ "/out": "" });
  expect((await extractDocumentText(input, textContext)).text).toBe(segmented ? "co\tast" : "coast");
  if (route === "sdk") await replaceDocumentText(input, { find, with: "shore", all: true, bold: false, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } });
  else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec(`docx text replace /input --find '${find}' --with shore --all --bold false --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const p = (await Document(output, textContext)).paragraphs[0]!; expect(p.runs.map(r => [r.text, r.bold, r.font.color.rgb?.toString()])).toEqual([["c", true, "224466"], ["shore", false, "224466"], ["t", true, "224466"]]);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml.split(inactive)).toHaveLength(2);
 });

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const) for (const resource of ["opaque-properties", "nested-drawing", "carrier-annotation"] as const)
 for (const route of ["sdk", "shell"] as const)
 it(`${route} ${resource === "carrier-annotation" ? "preserves" : "rejects"} partial ${carrier} replacement with ${resource} before publication; strict=${strict}`, async () => {
  const content = resource === "nested-drawing" ? '<w:t>coast<w:drawing/></w:t>' : '<w:t>coast</w:t>';
  const active = content + (resource === "carrier-annotation" ? '<!--retained carrier--><?review keep?>' : ""), inactive = '<w:t>Inactive coast</w:t>';
  const wrapped = carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const props = `<w:rPr><w:b/>${resource === "opaque-properties" ? '<f:opaque f:identity="retain">Stored</f:opaque>' : ""}</w:rPr>`, input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r>${props}${wrapped}</w:r></w:p>`, {}, strict), memory = Volume.fromJSON({ "/out": "" });
  if (resource === "carrier-annotation") {
    const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
    if (route === "sdk") await replaceDocumentText(input, { find: "oas", with: "shore", all: true, bold: false, output: "-" }, context);
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try { const result = await shell.exec("docx text replace /input --find oas --with shore --all --bold false --output - > /out"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
    }
    const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); expect(after.size).toBe(before.size);
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
    const xml = new TextDecoder().decode(after.get("word/document.xml"));
    expect(xml.split("<!--retained carrier-->")).toHaveLength(2); expect(xml.split("<?review keep?>")).toHaveLength(2); expect(xml.split(inactive)).toHaveLength(2);
    const document = await Document(output, textContext), paragraph = document.paragraphs[0]!;
    expect(paragraph.runs.map(r => [r.text, r.bold])).toEqual([["c", true], ["shore", false], ["t", true]]);
    const ownerXml = new TextDecoder().decode(paragraph.runs[0]!.element.serialize()); expect(ownerXml).toContain("<!--retained carrier-->"); expect(ownerXml).toContain("<?review keep?>");
    for (const other of paragraph.runs.slice(1)) { expect(new TextDecoder().decode(other.element.serialize())).not.toContain("<!--retained carrier-->"); expect(new TextDecoder().decode(other.element.serialize())).not.toContain("<?review keep?>"); }
    return;
  }
  if (route === "sdk") await expect(replaceDocumentText(input, { find: "oas", with: "shore", all: true, bold: false, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const result = await shell.exec("docx text replace /input --find oas --with shore --all --bold false --output - > /out"); expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(result.stderr).toContain("unsupported-edit"); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/out")).toHaveLength(0);
 });

for (const strict of [false, true]) for (const carrier of ["choice", "fallback"] as const) for (const route of ["sdk", "shell"] as const)
 it(`${route} partial ${carrier} split retains an ignored AlternateContent extension identity once; strict=${strict}`, async () => {
  const active = '<w:t>coast</w:t>', inactive = '<w:t>Inactive coast</w:t>', extension = '<f:opaque f:identity="retained-extension">Stored<f:resource/></f:opaque>';
  const wrapped = `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}"${carrier === "fallback" ? ' f:branchIdentity="retained-branch"' : ""}>${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback${carrier === "choice" ? ' f:branchIdentity="retained-branch"' : ""}>${carrier === "fallback" ? active : inactive}</mc:Fallback>${extension}</mc:AlternateContent>`;
  const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f"><w:r><w:rPr><w:b/></w:rPr>${wrapped}</w:r></w:p>`, {}, strict), memory = Volume.fromJSON({ "/out": "" });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  if (route === "sdk") await replaceDocumentText(input, { find: "oas", with: "shore", all: true, bold: false, output: "-" }, context);
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec("docx text replace /input --find oas --with shore --all --bold false --output - > /out"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); expect(xml.split('f:branchIdentity="retained-branch"')).toHaveLength(2); expect(xml).toContain(extension); expect(xml.split('f:identity="retained-extension"')).toHaveLength(2); expect((await Document(output, textContext)).paragraphs[0]!.runs.map(run => [run.text, run.bold])).toEqual([["c", true], ["shore", false], ["t", true]]);
 });

for (const strict of [false, true]) for (const carrier of ["choice", "fallback", "process"] as const) for (const route of ["sdk", "shell"] as const)
 it(`${route} unchanged partial ${carrier} replacement does not split or clone opaque properties; strict=${strict}`, async () => {
  const active = '<w:t>coast</w:t>', inactive = '<w:t>Inactive coast</w:t>', wrapped = carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="${future}" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r><w:rPr><w:b/><f:opaque f:identity="retain">Stored</f:opaque></w:rPr>${wrapped}</w:r></w:p>`, {}, strict), memory = Volume.fromJSON({ "/out": "" });
  if (route === "sdk") { const result = await replaceDocumentText(input, { find: "oas", with: "oas", all: true, bold: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } }); expect(result.changed).toBe(false); expect(result.changes).toHaveLength(0); }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec("docx text replace /input --find oas --with oas --all --bold true --output - > /out"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const before = readPackage(input), after = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer)); assertPackageLinks(after); for (const [name, bytes] of before) expect(after.get(name), name).toEqual(bytes);
 });
