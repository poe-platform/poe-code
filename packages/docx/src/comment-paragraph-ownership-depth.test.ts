import { expect, it } from "vitest";
import { Volume } from "memfs";
import { spawn } from "node:child_process";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const depth of [4096, 8192])
    it(`whole comment paragraph text honors admitted ownership depth ${depth}; ${kind}; strict=${strict}`, async () => {
      const base = await nativeStoryFixture("parts.comments.CommentsPart", strict, kind, "<w:p/>");
      const parts = readPackage(base.input), w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const body = '<f:pass>'.repeat(depth) + '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:annotationRef/><w:t>Retain 日本 עברית é 🌊</w:t></w:r></w:p>' + '</f:pass>'.repeat(depth);
      parts.set("word/native.xml", new TextEncoder().encode(`<w:comments xmlns:w="${w}" xmlns:f="urn:original:ownership-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:comment w:id="2" w:author="Original">${body}</w:comment><w:comment w:id="3" w:author="Other"><w:p><w:r><w:t>Outside 日本</w:t></w:r></w:p></w:comment><!--retain--><?policy keep?></w:comments>`));
      const memory = Volume.fromJSON({ "/input": "", "/out": "" });
      const context = { ...textContext, limits: { ...textContext.limits, maxArchiveBytes: 1048576, maxEntryBytes: 524288, maxTotalBytes: 1048576, maxRetainedBytes: 1073741824 }, budget: new api.DocumentBudget({ xmlDepth: 16384, retainedBytes: 1073741824, work: 1073741824 }) };
      await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
      const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
      const code = `import {Volume} from 'memfs';import * as api from 'docx';let data='';for await(const chunk of process.stdin)data+=chunk;const request=JSON.parse(data),memory=Volume.fromJSON({'/out':''}),context={signal:new AbortController().signal,limits:request.limits,budget:new api.DocumentBudget({xmlDepth:16384,retainedBytes:1073741824,work:1073741824})};try{const doc=await api.Document(new Uint8Array(Buffer.from(request.input,'base64')),context);doc.comments.get(2).paragraphs[0].text='Changed 日本 עברית é 🌊';await doc.save({async write(bytes){memory.appendFileSync('/out',bytes);}});console.log(JSON.stringify({ok:true,output:Buffer.from(memory.readFileSync('/out')).toString('base64')}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),stack:error.stack}));process.exitCode=1;}`;
      const result = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "", stderr = "";
        child.stdout.on("data", bytes => { stdout += String(bytes); });
        child.stderr.on("data", bytes => { stderr += String(bytes); });
        child.on("error", reject);
        child.on("close", exitCode => resolve({ exitCode, stdout, stderr }));
        child.stdin.end(JSON.stringify({ input: Buffer.from(input).toString("base64"), limits: context.limits }));
      });
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const output = new Uint8Array(Buffer.from((JSON.parse(result.stdout) as { output: string }).output, "base64"));
      const doc = await api.Document(output, context), paragraph = doc.comments.get(2)!.paragraphs[0]!;
      expect(paragraph.text).toBe("Changed 日本 עברית é 🌊");
      expect(paragraph.paragraph_format.alignment).toEqual(api.WD_PARAGRAPH_ALIGNMENT.RIGHT);
      const marker = paragraph.runs.find(run => new TextDecoder().decode(run.element.serialize()).includes("annotationRef"));
      expect(marker).toBeDefined();
      expect(marker!.italic).toBe(true);
      expect(paragraph.runs.filter(run => run.text !== "").every(run => run.italic === null)).toBe(true);
      expect(doc.comments.get(3)!.text).toBe("Outside 日本");
      const saved = readPackage(output);
      expect([...saved.keys()]).toEqual([...parts.keys()]);
      for (const [name, bytes] of parts) if (name !== "word/native.xml") expect(saved.get(name)).toEqual(bytes);
      const xml = new TextDecoder().decode(saved.get("word/native.xml"));
      expect(xml.split("<f:pass>").length - 1).toBe(depth);
      expect(xml).toContain("<!--retain--><?policy keep?>");
      expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
    }, 5000);
