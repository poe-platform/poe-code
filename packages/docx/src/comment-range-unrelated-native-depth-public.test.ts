import { Volume } from "memfs";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const placement of ["unrelated-native", "selected-inert-properties"] as const)
for (const depth of [32, 4096, 8192]) for (const route of ["model", "sdk", "cli", "native-model", "native-sdk", "native-cli"] as const)
it(`comment range creation retains unrelated admitted native depth; strict=${strict}; kind=${kind}; depth=${depth}; route=${route}${placement === "unrelated-native" ? "" : "; placement=selected-inert-properties"}`, async () => {
  const limits = { ...textContext.limits, maxArchiveBytes: 524288, maxEntryBytes: 262144, maxTotalBytes: 524288, maxRetainedBytes: 1073741824 };
  const xmlDepth = depth === 8192 ? 16384 : 8192;
  const budget = new api.DocumentBudget({ xmlDepth, retainedBytes: 1073741824, work: 1073741824 }, textContext.signal);
  const context = { ...textContext, limits, budget, timestamp: new Date("2026-03-04T05:06:07Z"), encoding: { order: "input", compression: "store" } as const };
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Anchor海🌊</w:t></w:r></w:p>', {}, strict, { kind }));
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const unrelated = '<w:customXml>'.repeat(depth) + '<w:p><w:r><w:t>Unselected日本🌊</w:t></w:r></w:p>' + '</w:customXml>'.repeat(depth);
  const inert = '<o:future>'.repeat(depth) + '<o:leaf o:stored="Retained日本🌊"/>' + '</o:future>'.repeat(depth);
  const properties = placement === "selected-inert-properties" ? `<w:rPr xmlns:o="urn:original:inert-properties" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="o"><w:i/>${inert}</w:rPr>` : "";
  const retainedSubtree = placement === "unrelated-native" ? unrelated : properties;
  parts.set("word/document.xml", new TextEncoder().encode(`<w:document xmlns:w="${word}"><w:body><w:p><w:r>${properties}<w:t>Anchor海🌊</w:t></w:r></w:p><!--outside-->${placement === "unrelated-native" ? unrelated : ""}<?audit exact?></w:body></w:document>`));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.document.Document.add_comment.call", receiver: ref("document"), arguments: { runs: ref("runs", 0), text: "Added note", author: "" }, resultHandle: "comment" },
    { operation: "model.comments.Comment.comment_id.get", receiver: ref("comment"), arguments: {} }
  ];
  if (route.startsWith("native-")) {
    const script = `import {Volume} from 'memfs';import * as api from 'docx';let json='';for await(const bytes of process.stdin)json+=bytes;const request=JSON.parse(json),input=new Uint8Array(Buffer.from(request.input,'base64')),signal=new AbortController().signal,context={signal,limits:request.limits,budget:new api.DocumentBudget({xmlDepth:request.xmlDepth,retainedBytes:1073741824,work:1073741824},signal),timestamp:new Date('2026-03-04T05:06:07Z'),encoding:{order:'input',compression:'store'}},memory=Volume.fromJSON({'/output':''}),sink={async write(bytes){memory.appendFileSync('/output',bytes);}};try{if(request.route==='native-model'){const doc=await api.Document(input,context);if(doc.add_comment(doc.paragraphs[0].runs[0],'Added note','').comment_id!==0)throw new Error('Unexpected ID');await doc.save(sink);}else if(request.route==='native-sdk'){const result=await api.executeDocumentBatch(input,{version:1,operations:request.operations},{output:'-',timestamp:'2026-03-04T05:06:07Z'},{...context,stdout:sink});if(result.results.at(-1).data!==0)throw new Error('Unexpected SDK ID');}else{const {Shell,MemoryFileSystem}=await import('virtual-bash');const {docxCommands}=await import('virtual-bash/commands/docx');const fs=new MemoryFileSystem();await fs.writeFile('/input',input);await fs.writeFile('/destination',new TextEncoder().encode('Retained destination'));const shell=new Shell({fs}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:request.limits,documentLimits:{xmlDepth:request.xmlDepth,retainedBytes:1073741824,work:1073741824}})}));try{const result=await shell.exec('docx batch /input --ops-json '+JSON.stringify(JSON.stringify({version:1,operations:request.operations}))+' --timestamp 2026-03-04T05:06:07Z --output /destination --force --json');if(result.exitCode!==0){const envelope=JSON.parse(result.stdout);if(envelope.affected!==0||result.exitCode!==1)throw new Error('Wrong refusal state');if(new TextDecoder().decode(await fs.readFile('/destination'))!=='Retained destination'||Buffer.compare(Buffer.from(input),Buffer.from(await fs.readFile('/input'))))throw new Error('Refusal changed source or destination');const error=new Error(result.stdout+result.stderr);error.code=envelope.errors[0].code;throw error;}if(JSON.parse(result.stdout).data.results.at(-1).data!==0)throw new Error('Unexpected CLI ID');if(Buffer.compare(Buffer.from(input),Buffer.from(await fs.readFile('/input'))))throw new Error('Source changed');memory.writeFileSync('/output',await fs.readFile('/destination'));}finally{await shell.dispose();}}console.log(JSON.stringify({ok:true,output:Buffer.from(memory.readFileSync('/output')).toString('base64')}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),stack:error.stack,code:error.code??null,outputBytes:memory.statSync('/output').size,sourceRetained:Buffer.compare(Buffer.from(input),Buffer.from(request.input,'base64'))===0}));}`;
    const response = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", bytes => { stdout += String(bytes); }); child.stderr.on("data", bytes => { stderr += String(bytes); });
      child.on("error", reject); child.on("close", status => status === 0 ? resolve(stdout) : reject(new Error(stderr)));
      child.stdin.end(JSON.stringify({ input: Buffer.from(input).toString("base64"), limits, xmlDepth, operations, route }));
    });
    const observed = JSON.parse(response) as { ok: boolean; output?: string; error?: string; stack?: string; code?: string; outputBytes?: number; sourceRetained?: boolean };
    if (placement === "selected-inert-properties") {
      expect(observed, observed.stack ?? observed.error).toMatchObject({ ok: false, code: "unsupported-edit", outputBytes: 0, sourceRetained: true });
      memory.writeFileSync("/output", input);
    } else {
      expect(observed.ok, observed.stack ?? observed.error).toBe(true);
      memory.writeFileSync("/output", Buffer.from(observed.output!, "base64"));
    }
  } else if (route === "model") {
    const doc = await api.Document(input, context);
    if (placement === "selected-inert-properties") {
      const before = doc.part.package.parts.map(part => [String(part.partname), part.blob]);
      try { doc.add_comment(doc.paragraphs[0]!.runs[0]!, "Added note", ""); throw new Error("Expected refusal"); }
      catch (error) { expect(error).toMatchObject({ code: "unsupported-edit" }); }
      expect(doc.part.package.parts.map(part => [String(part.partname), part.blob])).toEqual(before);
      expect(memory.statSync("/output").size).toBe(0); await doc.save(sink);
    } else {
      const comment = doc.add_comment(doc.paragraphs[0]!.runs[0]!, "Added note", "");
      expect(comment.comment_id).toBe(0); await doc.save(sink);
    }
  } else if (route === "sdk") {
    const pending = api.executeDocumentBatch(input, { version: 1, operations }, { output: "-", timestamp: "2026-03-04T05:06:07Z" }, { ...context, stdout: sink });
    if (placement === "selected-inert-properties") {
      await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.statSync("/output").size).toBe(0);
      memory.writeFileSync("/output", input);
    } else expect((await pending).results.at(-1)!.data).toBe(0);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits: { xmlDepth, retainedBytes: 1073741824, work: 1073741824 } }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --timestamp 2026-03-04T05:06:07Z --output /destination --force --json`);
      if (placement === "selected-inert-properties") {
        expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: "unsupported-edit", operationIndex: 2 }] });
        expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retained destination"); memory.writeFileSync("/output", input);
      } else {
        expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(0);
        memory.writeFileSync("/output", await fs.readFile("/destination"));
      }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output), xml = new TextDecoder().decode(after.get("word/document.xml"));
  if (placement === "selected-inert-properties") {
    expect(output).toEqual(input); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input)); return;
  }
  expect(xml).toContain(retainedSubtree); expect(xml).toContain("<!--outside-->"); expect(xml).toContain("<?audit exact?>");
  for (const [name, bytes] of parts) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
  const reopened = await api.Document(output, { ...context, budget: new api.DocumentBudget({ xmlDepth, retainedBytes: 1073741824, work: 1073741824 }, context.signal) });
  expect(reopened.comments.get(0)!.text).toBe("Added note"); expect(reopened.comments.get(0)!.author).toBe("");
  expect(reopened.comments.get(0)!.timestamp?.toISOString()).toBe("2026-03-04T05:06:07.000Z");
  expect(reopened.paragraphs[0]!.text).toBe("Anchor海🌊"); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
