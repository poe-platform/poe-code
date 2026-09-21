import { spawn } from "node:child_process";
import { expect, it } from "vitest";

for (const strict of [false, true]) for (const carrier of ["native", "process"]) for (const depth of [4096, 7800])
it(`field-boundary parsing respects admitted depth4096; strict=${strict}; carrier=${carrier}${depth === 4096 ? "" : "; deep7800"}`, async () => {
  const script = `import {Volume} from 'memfs';import * as api from 'docx';import {parseFields} from './packages/docx/src/field-parser.ts';
let data='';for await(const bytes of process.stdin)data+=bytes;const request=JSON.parse(data),w=request.strict?'http://purl.oclc.org/ooxml/wordprocessingml/main':'http://schemas.openxmlformats.org/wordprocessingml/2006/main',tag=request.carrier==='native'?'w:customXml':'f:pass',field='<w:fldSimple w:instr="PAGE"><w:r><w:t>Harbor</w:t></w:r></w:fldSimple>',source='<w:body xmlns:w="'+w+'" xmlns:f="urn:original:deep-field-carrier" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">'+('<'+tag+'>').repeat(request.depth)+'<w:p>'+field+'</w:p>'+('</'+tag+'>').repeat(request.depth)+'</w:body>',memory=Volume.fromJSON({'/xml':source}),budget=new api.DocumentBudget({xmlDepth:8192,retainedBytes:2**31,work:2**31});
try{const xml=new api.DocumentXmlEditor(new Uint8Array(memory.readFileSync('/xml')),{},undefined,budget),fields=parseFields(xml.root,[],budget,xml.compatibility.content);console.log(JSON.stringify({ok:true,fields:fields.map(f=>({kind:f.kind,result:f.result,unsafe:f.unsafe,pathLength:f.path.length}))}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),stack:error.stack}));}`;
  const response = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += String(bytes); });
    child.stderr.on("data", bytes => { stderr += String(bytes); });
    child.on("error", reject);
    child.on("close", code => { if (code !== 0) reject(new Error(stderr)); else resolve(stdout); });
    child.stdin.end(JSON.stringify({ strict, carrier, depth }));
  });
  const result = JSON.parse(response) as { ok: boolean; fields: unknown[]; error?: string; stack?: string };
  expect(result, result.stack ?? result.error).toEqual({ ok: true, fields: [{ kind: "PAGE", result: "Harbor", unsafe: true, pathLength: depth + 2 }] });
});
