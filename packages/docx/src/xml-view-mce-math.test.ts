import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, executeDocumentBatch, writeArchive, type XmlElementView } from "./index.js";
import { equationFixture, equationContext, equationNamespace, inlineEquation } from "../tests/fixtures/equations.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string, index?: number) => ({resultHandle, ...(index === undefined ? {} : {index})});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "utf16be"] as const) for (const carrier of ["direct", "choice"] as const)
for (const action of ["text", "remove", "insert", "unrelated"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} protects stored math from generic ${action} with unchanged unrelated bytes; ${carrier} ${encoding} ${kind} strict=${strict}`, async () => {
  const m = equationNamespace(strict), math = inlineEquation(strict);
  const body = '<w:p><w:r><w:t>coast</w:t></w:r>' + (carrier === "direct" ? math : `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:m="${m}"><mc:Choice Requires="m">${math}</mc:Choice><mc:Fallback>${inlineEquation(strict, "q")}</mc:Fallback></mc:AlternateContent>`) + '</w:p>';
  const parts = readPackage(await equationFixture({strict, body})), source = new TextDecoder().decode(parts.get("word/document.xml"));
  const encode = (text: string) => encoding === "utf8" ? enc(text) : new Uint8Array(Buffer.from("\ufeff" + text, "utf16le").swap16());
  parts.set("word/document.xml", encode(source));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, equationContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), doc = await Document(input, equationContext);
  const pending: {view: XmlElementView; path: number[]}[] = [{view: doc.element, path: []}];
  let found: typeof pending[number] | undefined;
  while (pending.length) {
    const item = pending.pop()!, namespace = item.view.namespace, local = item.view.localName;
    if (action === "insert" ? local === "p" && namespace !== m : action === "unrelated" ? local === "t" && namespace !== m : namespace === m && local === (action === "text" ? "t" : "oMath")) {found = item; break;}
    for (let index = item.view.children.length - 1; index >= 0; index--) pending.push({view: item.view.children[index]!, path: [...item.path, index]});
  }
  expect(found).toBeDefined();
  const operations: {operation: string; receiver: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string}[] = [{operation: "model.document.Document.element.get", receiver: ref("document"), arguments: {}, resultHandle: "root"}];
  let receiver = ref("root");
  for (const [depth, index] of found!.path.entries()) {operations.push({operation: "model.XmlElementView.children.get", receiver, arguments: {}, resultHandle: `children${depth}`}); receiver = ref(`children${depth}`, index);}
  const node = {kind: "element" as const, name: {namespaceURI: m, localName: "oMath"}, children: [{kind: "element" as const, name: {namespaceURI: m, localName: "r"}, children: [{kind: "element" as const, name: {namespaceURI: m, localName: "t"}, children: [{kind: "text" as const, text: "z"}]}]}]};
  operations.push({operation: `model.XmlElementView.${action === "remove" ? "remove.call" : action === "insert" ? "insert.call" : "text.set"}`, receiver, arguments: action === "remove" ? {} : action === "insert" ? {index: 0, node} : {value: "shore"}});
  const sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  if (route === "model") {
    const change = () => {if (action === "remove") found!.view.remove(); else if (action === "insert") found!.view.insert(0, node); else found!.view.text = "shore";};
    if (action === "unrelated") change(); else expect(change).toThrowError(expect.objectContaining({code: "unsupported-edit"}));
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = executeDocumentBatch(input, {version: 1, operations}, {output: "-"}, {...equationContext, encoding: {order: "input", compression: "store"}, stdout: sink});
    if (action === "unrelated") expect((await result).publication?.changed).toBe(true); else {await expect(result).rejects.toMatchObject({code: "unsupported-edit"}); expect(memory.readFileSync("/output")).toHaveLength(0);}
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({version: 1, operations}))); await fs.writeFile("/output", enc("sentinel"));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: equationContext.limits})})).exec("docx batch /input --ops-file /ops --output /output --force --json");
    expect(result.exitCode, result.stdout + result.stderr).toBe(action === "unrelated" ? 0 : 1);
    if (action === "unrelated") memory.writeFileSync("/output", await fs.readFile("/output")); else {expect(JSON.parse(result.stdout)).toMatchObject({ok: false, data: null, affected: 0, errors: [{code: "unsupported-edit"}]}); expect(await fs.readFile("/output")).toEqual(enc("sentinel"));}
    expect(await fs.readFile("/input")).toEqual(input);
  }
  if (route === "model" || action === "unrelated") expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(new Map([...parts].map(([name, bytes]) => [name, name === "word/document.xml" && action === "unrelated" ? encode(source.replace(">coast<", ">shore<")) : bytes])));
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
