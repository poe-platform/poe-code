import { spawn } from "node:child_process";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const namespace = "http://schemas.microsoft.com/office/word/2018/wordml/cex";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli", "native-sdk", "native-cli"] as const) for (const depth of [32, 4096]) for (const capacity of ["sufficient", "insufficient"] as const)
it(`${route} inventories inert modern comment metadata at admitted depth ${depth}; capacity=${capacity}; ${kind}; strict=${strict}`, async () => {
  const seed = await textFixture('<w:p><w:r><w:t>Retained coast</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="43" w:author="Original"><w:p><w:r><w:t>Stored comment</w:t></w:r></w:p></w:comment></w:comments>` },
    metadata: { kind: "commentsExtensible", xml: `<m:commentsExtensible xmlns:m="${namespace}"/>` }
  }, strict, { kind });
  const files = readPackage(seed), limits = { ...textContext.limits, maxArchiveBytes: 1048576, maxEntryBytes: 1048576, maxTotalBytes: 1048576, maxRetainedBytes: 536870912 };
  files.set("word/metadata.xml", new TextEncoder().encode(`<m:commentsExtensible xmlns:m="${namespace}"><m:commentExtensible m:durableId="00000027"><m:extLst>${'<m:future>'.repeat(depth)}<m:leaf m:stored="海"/>${'</m:future>'.repeat(depth)}</m:extLst></m:commentExtensible></m:commentsExtensible>`));
  const relationships = new api.DocumentXmlEditor(files.get("word/_rels/document.xml.rels")!);
  relationships.setAttribute(relationships.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === "metadata"))!, "Type", "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible");
  files.set("word/_rels/document.xml.rels", relationships.serialize());
  const memory = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...files].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-03-04T05:06:08Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, { ...textContext, limits });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), context = { ...textContext, limits, budget: new api.DocumentBudget({ xmlDepth: 8192, ...(capacity === "insufficient" ? { retainedBytes: depth === 4096 ? 67108864 : 1 } : {}) }, textContext.signal) };
  let data: api.CommentReadData;
  if (route === "native-sdk" || route === "native-cli") {
    const script = `import * as api from 'docx';let json='';for await(const chunk of process.stdin)json+=chunk;const request=JSON.parse(json),input=new Uint8Array(Buffer.from(request.input,'base64')),signal=new AbortController().signal,budget=new api.DocumentBudget({xmlDepth:8192,...(request.capacity==='insufficient'?{retainedBytes:request.depth===4096?67108864:1}:{})},signal);try{let data;if(request.route==='native-sdk')data=await api.inspectDocumentComments(input,{operation:'comments.list',options:{}},{limits:request.limits,signal,budget});else{const {Shell,MemoryFileSystem}=await import('@poe-platform/safe-bash');const {docxCommands}=await import('@poe-platform/safe-bash/commands/docx');const fs=new MemoryFileSystem();await fs.writeFile('/input',input);const shell=new Shell({fs,limits:{maxOutputBytes:67108864}}).use(docxCommands({engine:api.createDocxInspectionCommandEngine({limits:request.limits,documentLimits:{xmlDepth:8192}})}));try{const result=await shell.exec('docx comments list /input --json'+(request.capacity==='insufficient'?' --limit retainedBytes='+(request.depth===4096?67108864:1):''));if(result.exitCode!==0){console.log(JSON.stringify({ok:false,code:JSON.parse(result.stdout).errors[0].code}));process.exitCode=0;data=null;}else {const actual=JSON.parse(result.stdout).data;if(actual.items.length!==1||actual.items[0].details.commentId!==43||actual.items[0].details.modern!==true||actual.items[0].text!=='Stored comment')throw new Error('Canonical resource mismatch');data=await api.inspectDocumentComments(input,{operation:'comments.list',options:{}},{limits:request.limits,signal,budget:new api.DocumentBudget({xmlDepth:8192},signal)});}if(Buffer.compare(Buffer.from(input),Buffer.from(await fs.readFile('/input'))))throw new Error('Input changed');}finally{await shell.dispose();}}if(data)console.log(JSON.stringify({ok:true,data,retainedBytes:budget.usage.retainedBytes}));}catch(error){console.log(JSON.stringify({ok:false,code:error.code??error.name,error:String(error),stack:error.stack}));}`;
    const response = JSON.parse(await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] }); let stdout = "", stderr = "";
      child.stdout.on("data", bytes => { stdout += String(bytes); }); child.stderr.on("data", bytes => { stderr += String(bytes); }); child.on("error", reject); child.on("close", status => status === 0 ? resolve(stdout) : reject(new Error(stderr))); child.stdin.end(JSON.stringify({ input: Buffer.from(input).toString("base64"), limits, route, depth, capacity }));
    })) as { ok: boolean; code?: string; data: api.CommentReadData; retainedBytes: number };
    if (capacity === "insufficient") { expect(response).toMatchObject({ ok: false, code: "limit-exceeded" }); expect(readPackage(input)).toEqual(files); return; }
    expect(response).toMatchObject({ ok: true }); data = response.data;
    if (route === "native-sdk") expect(response.retainedBytes).toBeGreaterThanOrEqual(data.extensions.reduce((sum, extension) => sum + extension.entries.reduce((total, entry) => total + entry.path.length * 8, 0), 0));
  } else if (route === "sdk") {
    const result = api.inspectDocumentComments(input, { operation: "comments.list", options: {} }, context);
    if (capacity === "insufficient") { await expect(result).rejects.toMatchObject({ code: "limit-exceeded" }); expect(readPackage(input)).toEqual(files); return; }
    data = await result;
  }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs, limits: { maxOutputBytes: 67108864 } }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits: { xmlDepth: 8192 } }) }));
    try { const result = await shell.exec("docx comments list /input --json" + (capacity === "insufficient" ? ` --limit retainedBytes=${depth === 4096 ? 67108864 : 1}` : "")); if (capacity === "insufficient") { expect(result.exitCode, result.stdout + result.stderr).toBe(4); expect(JSON.parse(result.stdout).errors[0].code).toBe("limit-exceeded"); expect(await fs.readFile("/input")).toEqual(input); return; } expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data).toMatchObject({ items: [{ kind: "comments", text: "Stored comment", details: { commentId: 43, modern: true } }] });
      data = await api.inspectDocumentComments(input, { operation: "comments.list", options: {} }, { ...textContext, limits, budget: new api.DocumentBudget({ xmlDepth: 8192 }, textContext.signal) }); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  expect(data.items.map(item => [item.comment_id, item.text])).toEqual([[43, "Stored comment"]]); expect(data.modern).toBe("preserve");
  const extension = data.extensions.find(item => item.part === "/word/metadata.xml")!;
  expect(extension.kind).toBe("commentsExtensible"); expect(extension.entries).toHaveLength(depth + 4);
  expect(extension.entries.at(-1)).toMatchObject({ name: "leaf", namespace, path: Array(depth + 3).fill(0), attributes: [{ name: "stored", namespace, value: "海" }] });
  if (route === "sdk") expect(context.budget.usage.retainedBytes).toBeGreaterThanOrEqual(extension.entries.reduce((sum, entry) => sum + entry.path.length * 8, 0));
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(readPackage(input)).toEqual(files);
});
