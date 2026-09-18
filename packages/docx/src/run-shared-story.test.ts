import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["header", "footer"] as const) for (const variant of ["default", "first", "even"] as const)
 for (const binding of ["inherited", "explicit", "unshared"] as const) for (const action of ["format", "range", "text"] as const)
 for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
 it(`${route} requires shared intent for ${binding} ${variant} ${kind} ${action}; strict=${strict}`, async () => {
  const edge = `<w:${kind}Reference w:type="${variant}" r:id="story"/>`;
  const body = (binding === "unshared" ? "" : `<w:p><w:pPr><w:sectPr>${edge}</w:sectPr></w:pPr></w:p>`) + `<w:sectPr>${binding === "inherited" ? "" : edge}</w:sectPr>`;
  const input = await textFixture(body, { story: { kind, xml: `<w:${kind === "header" ? "hdr" : "ftr"} xmlns:w="${w}"><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Original</w:t></w:r></w:p></w:${kind === "header" ? "hdr" : "ftr"}>` } }, strict);
  const locations = await api.openDocumentLocations(input, textContext), paragraph = locations.list("paragraph", { scope: kind === "header" ? "headers" : "footers" })[0]!;
  const run = locations.at("run", 1, { owner: paragraph.token }), select = action === "range" ? locations.range(run.token, 1, 3).token : run.token;
  expect(locations.references(select)).toHaveLength(binding === "unshared" ? 1 : 2);
  const options = { select, ...(action === "text" ? { text: "Changed" } : { bold: true }) }, batch = { version: 1, operations: [{ id: "edit", operation: "runs.set", arguments: options }] };
  const memory = Volume.fromJSON({ "/out": "" }), context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } } };
  if (route === "sdk" || route === "sdk-batch") {
   const result = route === "sdk" ? api.formatDocumentRuns(input, { ...options, output: "-" }, context) : api.executeDocumentBatch(input, batch, { output: "-" }, context);
   if (binding === "unshared") await result; else await expect(result).rejects.toMatchObject({ code: "ambiguous-selection" });
  } else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try { const path = route === "shell-batch" ? `batch /input --ops-json '${JSON.stringify(batch)}'` : `runs set /input --select '${select}' ${action === "text" ? "--text Changed" : "--bold true"}`;
    const result = await shell.exec(`docx ${path} --output - > /out`); expect(result.exitCode, result.stdout + result.stderr).toBe(binding === "unshared" ? 0 : 1); if (binding !== "unshared") expect(result.stderr).toContain("ambiguous-selection");
    expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out"));
   } finally { await shell.dispose(); }
  }
  if (binding !== "unshared") expect(memory.readFileSync("/out")).toHaveLength(0);
  else { const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
   for (const [name, bytes] of before) if (name !== "word/story.xml") expect(after.get(name), name).toEqual(bytes);
   const doc = await api.Document(output, textContext), section = doc.sections[0]!, story = variant === "default" ? section[kind] : variant === "first" ? kind === "header" ? section.first_page_header : section.first_page_footer : kind === "header" ? section.even_page_header : section.even_page_footer;
   expect(story.paragraphs[0]!.text).toBe(action === "text" ? "Changed" : "Original"); expect(story.paragraphs[0]!.runs.every(run => run.italic === true)).toBe(true);
  }
 });

for (const strict of [false, true]) for (const kind of ["header", "footer"] as const) for (const binding of ["inherited", "explicit"] as const) for (const action of ["format", "text"] as const)
 it(`model intentionally edits the shared ${binding} ${kind} owner; action=${action} strict=${strict}`, async () => {
  const edge = `<w:${kind}Reference w:type="default" r:id="story"/>`, body = `<w:p><w:pPr><w:sectPr>${edge}</w:sectPr></w:pPr></w:p><w:sectPr>${binding === "explicit" ? edge : ""}</w:sectPr>`;
  const input = await textFixture(body, { story: { kind, xml: `<w:${kind === "header" ? "hdr" : "ftr"} xmlns:w="${w}"><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Original</w:t></w:r></w:p></w:${kind === "header" ? "hdr" : "ftr"}>` } }, strict), doc = await api.Document(input, textContext);
  const run = doc.sections[1]![kind].paragraphs[0]!.runs[0]!; if (action === "text") run.text = "Changed"; else run.bold = true;
  for (const section of doc.sections) { expect(section[kind].paragraphs[0]!.text).toBe(action === "text" ? "Changed" : "Original"); expect(section[kind].paragraphs[0]!.runs[0]!.italic).toBe(true); if (action === "format") expect(section[kind].paragraphs[0]!.runs[0]!.bold).toBe(true); }
  const memory = Volume.fromJSON({ "/out": "" }); await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } }); const before = readPackage(input), after = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer)); assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/story.xml") expect(after.get(name), name).toEqual(bytes);
 });
