import { spawn } from "node:child_process";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const count of [1024, 131072]) for (const route of ["model", "sdk", "cli"] as const)
it(`live comment style XML insertion retains admitted ignored physical fanout; strict=${strict}; kind=${kind}; count=${count}; route=${route}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const opaque = `<f:opaque>${"<f:leaf/>".repeat(count)}</f:opaque>`;
  const styles = `<w:styles xmlns:w="${word}" xmlns:f="urn:original:comment-style-fanout" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>${opaque}<!--retain--><?audit exact?></w:styles>`;
  const archive = await api.readArchive(await textFixture('<w:p><w:r><w:t>Retained海🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${word}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style></w:styles>` } }, strict, { kind }), textContext);
  const limits = { ...textContext.limits, maxArchiveBytes: 4194304, maxEntryBytes: 2097152, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 }, documentLimits = { retainedBytes: 2147483648, work: 2147483648, xmlNodes: 8000000 }, signal = new AbortController().signal;
  const context = { ...textContext, limits, signal, budget: new api.DocumentBudget(documentLimits, signal), timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const };
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members: archive.members.map(member => member.name === "word/styles.xml" ? { ...member, bytes: new TextEncoder().encode(styles) } : member) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const node: api.DocxXmlNode = { kind: "element", name: { namespaceURI: word, localName: "style" }, attributes: [{ name: { namespaceURI: word, localName: "type" }, value: "character" }, { name: { namespaceURI: word, localName: "styleId" }, value: "CommentAux" }], children: [{ kind: "element", name: { namespaceURI: word, localName: "name" }, attributes: [{ name: { namespaceURI: word, localName: "val" }, value: "Comment Aux" }] }] };
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input, limits), operations = [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.element.get", receiver: ref("styles"), arguments: {}, resultHandle: "styleRoot" },
    { operation: "model.XmlElementView.insert.call", receiver: ref("styleRoot"), arguments: { index: 2, node } },
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.add_comment.call", receiver: ref("comments"), arguments: { text: "Fresh海🌊", author: "Archive", initials: "AR" }, resultHandle: "comment" },
    { operation: "model.comments.Comment.text.get", receiver: ref("comment"), arguments: {} }
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const document = await api.Document(input, context), originalNormal = document.styles.at("Normal");
    document.styles.element.insert(2, node);
    expect(originalNormal.equals(document.styles.at("Normal"))).toBe(true);
    expect(document.styles.at("Comment Aux").style_id).toBe("CommentAux");
    const comment = document.comments.add_comment("Fresh海🌊", "Archive", "AR");
    expect(comment.text).toBe("Fresh海🌊"); await document.save(sink);
  } else if (route === "sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context); expect(batch.results.at(-1)!.value).toBe("Fresh海🌊"); await batch.save(sink);
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /destination --force --json");
      expect(Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(input))).toBe(0); if (result.exitCode !== 0) expect(await fs.readFile("/destination")).toEqual(destination);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe("Fresh海🌊"); memory.writeFileSync("/output", await fs.readFile("/destination"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output, limits);
  expect(new TextDecoder().decode(after.get("word/styles.xml")!)).toContain(opaque + "<!--retain--><?audit exact?>");
  for (const [name, bytes] of before) if (!["[Content_Types].xml", "word/styles.xml", "word/_rels/document.xml.rels"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  const program = `import * as api from 'docx';let text='';for await(const chunk of process.stdin)text+=chunk;const request=JSON.parse(text),input=new Uint8Array(Buffer.from(request.input,'base64')),original=input.slice(),signal=new AbortController().signal,document=await api.Document(input,{limits:request.limits,signal,budget:new api.DocumentBudget(request.documentLimits,signal),timestamp:new Date('2026-03-04T05:06:07Z'),encoding:{order:'input',compression:'store'}}),comment=document.comments.get(0);console.log(JSON.stringify({styleId:document.styles.at('Comment Aux').style_id,text:comment.text,author:comment.author,initials:comment.initials,timestamp:comment.timestamp?.toISOString(),paragraphStyle:comment.paragraphs[0].style?.equals(document.styles.at('Comment Text')),referenceStyle:comment.paragraphs[0].runs[0].style?.equals(document.styles.at('Comment Reference')),sourceRetained:Buffer.compare(Buffer.from(input),Buffer.from(original))===0}));`;
  const observed = JSON.parse(await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", program], { stdio: ["pipe", "pipe", "pipe"] }); let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); }); child.stderr.on("data", bytes => { stderr += String(bytes); }); child.on("error", reject); child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr))); child.stdin.end(JSON.stringify({ input: Buffer.from(output).toString("base64"), limits, documentLimits }));
  })) as { styleId: string; text: string; author: string; initials: string; timestamp: string; paragraphStyle: boolean; referenceStyle: boolean; sourceRetained: boolean };
  expect(observed.styleId).toBe("CommentAux");
  expect(observed.text).toBe("Fresh海🌊"); expect(observed.author).toBe("Archive"); expect(observed.initials).toBe("AR"); expect(observed.timestamp).toBe("2026-03-04T05:06:07.000Z");
  expect(observed.paragraphStyle).toBe(true); expect(observed.referenceStyle).toBe(true); expect(observed.sourceRetained).toBe(true);
  expect(Buffer.compare(memory.readFileSync("/input") as Buffer, Buffer.from(input))).toBe(0);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const count of [131072]) for (const route of ["model", "sdk", "cli"] as const)
it(`live comment style complete workflow refuses insufficient original cumulative node capacity; strict=${strict}; kind=${kind}; count=${count}; route=${route}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const opaque = `<f:opaque>${"<f:leaf/>".repeat(count)}</f:opaque>`;
  const styles = `<w:styles xmlns:w="${word}" xmlns:f="urn:original:comment-style-fanout" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>${opaque}<!--retain--><?audit exact?></w:styles>`;
  const archive = await api.readArchive(await textFixture('<w:p><w:r><w:t>Retained海🌊</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${word}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style></w:styles>` } }, strict, { kind }), textContext);
  const limits = { ...textContext.limits, maxArchiveBytes: 4194304, maxEntryBytes: 2097152, maxTotalBytes: 4194304, maxRetainedBytes: 2147483648 }, documentLimits = { retainedBytes: 2147483648, work: 2147483648 }, signal = new AbortController().signal;
  const context = { ...textContext, limits, signal, budget: new api.DocumentBudget(documentLimits, signal), timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const };
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await api.writeArchive({ ...archive, members: archive.members.map(member => member.name === "word/styles.xml" ? { ...member, bytes: new TextEncoder().encode(styles) } : member) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const node: api.DocxXmlNode = { kind: "element", name: { namespaceURI: word, localName: "style" }, attributes: [{ name: { namespaceURI: word, localName: "type" }, value: "character" }, { name: { namespaceURI: word, localName: "styleId" }, value: "CommentAux" }], children: [{ kind: "element", name: { namespaceURI: word, localName: "name" }, attributes: [{ name: { namespaceURI: word, localName: "val" }, value: "Comment Aux" }] }] };
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input, limits), operations = [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.element.get", receiver: ref("styles"), arguments: {}, resultHandle: "styleRoot" },
    { operation: "model.XmlElementView.insert.call", receiver: ref("styleRoot"), arguments: { index: 2, node } },
    { operation: "model.document.Document.comments.get", receiver: ref("document"), arguments: {}, resultHandle: "comments" },
    { operation: "model.comments.Comments.add_comment.call", receiver: ref("comments"), arguments: { text: "Fresh海🌊", author: "Archive", initials: "AR" }, resultHandle: "comment" },
    { operation: "model.comments.Comment.text.get", receiver: ref("comment"), arguments: {} }
  ];
  if (route === "model") {
    const document = await api.Document(input, context), originalNormal = document.styles.at("Normal");
    document.styles.element.insert(2, node);
    expect(originalNormal.equals(document.styles.at("Normal"))).toBe(true);
    expect(document.styles.at("Comment Aux").style_id).toBe("CommentAux");
    expect(() => document.comments.add_comment("Fresh海🌊", "Archive", "AR")).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  } else if (route === "sdk") {
    await expect(api.applyStyleModelBatch(input, { version: 1, operations }, context)).rejects.toMatchObject({ code: "limit-exceeded" });
  } else {
    const fs = new MemoryFileSystem(), destination = new TextEncoder().encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/destination", destination); await fs.writeFile("/operations", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
    try {
      const result = await shell.exec("docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /destination --force --json");
      expect(Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(input))).toBe(0); if (result.exitCode !== 0) expect(await fs.readFile("/destination")).toEqual(destination);
      expect(result.exitCode, result.stdout + result.stderr).toBe(4); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "limit-exceeded" }] }); expect(await fs.readFile("/destination")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
  expect(memory.statSync("/output").size).toBe(0);
  expect(Buffer.compare(memory.readFileSync("/input") as Buffer, Buffer.from(input))).toBe(0);
  const unchanged = readPackage(input, limits); expect([...unchanged.keys()]).toEqual([...before.keys()]); for (const [name, bytes] of before) expect(Buffer.compare(Buffer.from(unchanged.get(name)!), Buffer.from(bytes)), name).toBe(0);
});
