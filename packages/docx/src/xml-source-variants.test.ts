import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const enc = (value: string) => new TextEncoder().encode(value);
const table = "<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>";
const section = '<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12000" w:h="16000"/></w:sectPr>';
const cases = [
  { name: "clear-empty", body: "", action: "clear", expected: [] },
  { name: "clear-paragraph", body: "<w:p/>", action: "clear", expected: [] },
  { name: "clear-table", body: table, action: "clear", expected: [] },
  { name: "clear-section", body: section, action: "clear", expected: ["sectPr"] },
  { name: "clear-paragraph-section", body: "<w:p/>" + section, action: "clear", expected: ["sectPr"] },
  { name: "section-break", body: section, action: "section", expected: ["p", "sectPr"] },
  { name: "ordered-body", body: table + "<w:p/><w:p/>" + section, action: "order", expected: ["Table", "Paragraph", "Paragraph"] },
  { name: "run-plain", body: "<w:p><w:r/></w:p>", action: "text", value: "Estuary", expected: ["t"] },
  { name: "run-trailing-space", body: "<w:p><w:r/></w:p>", action: "text", value: "Estuary ", expected: ["t"] },
  { name: "run-properties-break", body: "<w:p><w:r><w:rPr><w:b/></w:rPr><w:cr/></w:r></w:p>", action: "text", value: "Estuary", expected: ["rPr", "cr", "t"] },
  { name: "run-assembly", body: "<w:p><w:r><w:br/><w:cr/><w:noBreakHyphen/><w:ptab/><w:t>Estuary</w:t><w:tab/></w:r></w:p>", action: "assemble", expected: [] }
];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const route of ["model", "sdk", "shell"] as const)
it.each(cases)(`${route} executes XML $name with retained package ownership; ${kind} strict=${strict}`, async sample => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, sample.body), before = readPackage(input), memory = Volume.fromJSON({ "/output": "" });
  const context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations: Record<string, unknown>[] = [];
  const add = (operation: string, receiver: ReturnType<typeof ref>, args: Record<string, unknown> = {}, resultHandle?: string) => operations.push({ operation, receiver, arguments: args, ...(resultHandle ? { resultHandle } : {}) });
  const mutates = sample.action === "section" || sample.action === "text" || sample.action === "clear" && ["clear-paragraph", "clear-table", "clear-paragraph-section"].includes(sample.name);
  if (sample.action === "clear") {
    add("model.document.Document.element.get", ref("document"), {}, "root"); add("model.XmlElementView.children.get", ref("root"), {}, "children"); add("model.XmlElementView.children.get", ref("children", 0), {}, "blocks");
    if (mutates) add("model.XmlElementView.remove.call", ref("blocks", 0));
  } else if (sample.action === "section") {
    add("model.document.Document.add_section.call", ref("document"), {}, "section"); add("model.section.Section.start_type.get", ref("section"));
  } else if (sample.action === "order") add("model.document.Document.iter_inner_content.call", ref("document"));
  else {
    add("model.document.Document.paragraphs.get", ref("document"), {}, "ps"); add("model.text.paragraph.Paragraph.runs.get", ref("ps", 0), {}, "runs");
    if (sample.action === "text") add("model.text.run.Run.add_text.call", ref("runs", 0), { text: sample.value });
    add("model.text.run.Run.text.get", ref("runs", 0));
  }
  let returned: unknown;
  if (route === "model") {
    const document = await api.Document(input, context);
    if (sample.action === "clear") {
      const body = document.element.children[0]!; for (const node of body.children.filter(n => n.localName !== "sectPr")) node.remove();
    } else if (sample.action === "section") returned = document.add_section().start_type;
    else if (sample.action === "order") returned = [...document.iter_inner_content()].map(node => node.constructor.name);
    else { const run = document.paragraphs[0]!.runs[0]!; if (sample.action === "text") run.add_text(sample.value!); returned = run.text; }
    await document.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, mutates ? { output: "-" } : {}, { ...context, stdout: sink }); returned = result.results.at(-1)!.data;
    if (!mutates) memory.writeFileSync("/output", input);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-file /ops --json${mutates ? " --output /output" : ""}`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); returned = JSON.parse(result.stdout).data.results.at(-1).data;
      memory.writeFileSync("/output", mutates ? await fs.readFile("/output") : input); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), document = await api.Document(output, context), body = document.element.children[0]!;
  for (const [name, bytes] of before) if (name !== "word/document.xml" || !mutates) expect(saved.get(name), name).toEqual(bytes);
  if (sample.action === "clear" || sample.action === "section") expect(body.children.map(n => n.localName)).toEqual(sample.expected);
  if (sample.action === "clear" && sample.expected.length) expect(new TextDecoder().decode(saved.get("word/document.xml"))).toContain(section);
  if (sample.action === "section") {
    expect(document.sections).toHaveLength(2); expect(document.sections[0]!.start_type).toBe(api.WD_SECTION_START.CONTINUOUS); expect(document.sections[1]!.start_type).toBe(api.WD_SECTION_START.NEW_PAGE);
    for (const item of document.sections) { expect(item.page_width!.emu).toBe(12000 * 635); expect(item.page_height!.emu).toBe(16000 * 635); }
    expect(returned).toEqual(route === "model" ? api.WD_SECTION_START.NEW_PAGE : { enum: "WD_SECTION_START", name: "NEW_PAGE" });
  }
  if (sample.action === "order") expect(route === "model" ? returned : (returned as { type: string }[]).map(item => item.type)).toEqual(sample.expected);
  if (sample.action === "assemble") expect(returned).toBe("\n\n\u2011\tEstuary\t");
  if (sample.action === "text") {
    expect(returned).toBe((sample.name === "run-properties-break" ? "\n" : "") + sample.value);
    const run = document.paragraphs[0]!.runs[0]!; expect(run.element.children.map(n => n.localName)).toEqual(sample.expected);
    const walk = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(c => typeof c === "string" ? [] : walk(c))];
    const t = walk(xmlStructure(saved.get("word/document.xml")!)).find(n => n.name.endsWith("}t"))!;
    expect(t.children).toEqual([sample.value]);
    const space = t.attributes["{http://www.w3.org/XML/1998/namespace}space"];
    if (sample.name === "run-trailing-space") expect(space).toBe("preserve");
    else expect([undefined, "default", "preserve"]).toContain(space);
    if (sample.name === "run-properties-break") expect(run.bold).toBe(true);
  }
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["header", "footer"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains ordered native ${owner} blocks; ${kind} strict=${strict}`, async () => {
  const { input: original } = await nativeStoryFixture(owner === "header" ? "hdrftr.HeaderPart" : "hdrftr.FooterPart", strict, kind, table + table + "<w:p/>");
  const parts = readPackage(original), main = new TextDecoder().decode(parts.get("word/document.xml")!);
  parts.set("word/document.xml", enc(main.replace("</w:body>", `<w:sectPr><w:${owner}Reference w:type="default" r:id="native"/></w:sectPr></w:body>`)));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const operations = [
    { operation: "model.document.Document.sections.get", receiver: ref("document"), arguments: {}, resultHandle: "sections" },
    { operation: `model.section.Section.${owner}.get`, receiver: ref("sections", 0), arguments: {}, resultHandle: "story" },
    { operation: `model.section._${owner === "header" ? "Header" : "Footer"}.iter_inner_content.call`, receiver: ref("story"), arguments: {} }
  ];
  let types: string[];
  if (route === "model") {
    const document = await api.Document(input, textContext); types = [...document.sections[0]![owner].iter_inner_content()].map(node => node.constructor.name);
    await document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } }); expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(parts);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, {}, { ...textContext, encoding: { order: "input", compression: "store" } }); types = (result.results.at(-1)!.data as { type: string }[]).map(node => node.type);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); types = JSON.parse(result.stdout).data.results.at(-1).data.map((node: { type: string }) => node.type); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  expect(types).toEqual(["Table", "Table", "Paragraph"]); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
