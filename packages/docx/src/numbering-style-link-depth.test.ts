import { Volume } from "memfs";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { DocumentBudget } from "./budget.js";
import { NumberingGraph } from "./numbering.js";
import { DocumentXmlEditor, UnsupportedEditError } from "./xml-write.js";

for (const strict of [false, true]) for (const depth of [32, 4096]) for (const host of ["worker", "main"] as const)
it(`resolves an admitted numbering style chain without host recursion; strict=${strict}; depth=${depth}; host=${host}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const nums: string[] = [], styles: string[] = [];
  for (let i = 1; i <= depth; i++) {
    nums.push(`<w:abstractNum w:abstractNumId="${i}">${i === depth ? '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>' : `<w:numStyleLink w:val="Chain${i + 1}"/>`}</w:abstractNum><w:num w:numId="${i}"><w:abstractNumId w:val="${i}"/>${i === 1 ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride>' : ""}</w:num>`);
    styles.push(`<w:style w:type="numbering" w:styleId="Chain${i}"><w:name w:val="Chain ${i}"/><w:pPr><w:numPr><w:numId w:val="${i}"/></w:numPr></w:pPr></w:style>`);
  }
  const memory = Volume.fromJSON({ "/numbering": `<w:numbering xmlns:w="${w}">${nums.join("")}</w:numbering>`, "/styles": `<w:styles xmlns:w="${w}">${styles.join("")}</w:styles>` });
  const budget = new DocumentBudget({ xmlDepth: 8192, retainedBytes: 2 ** 31, work: 2 ** 31 });
  const source = new Uint8Array(memory.readFileSync("/numbering") as Buffer), styleSource = new Uint8Array(memory.readFileSync("/styles") as Buffer);
  const numbering = new DocumentXmlEditor(source, {}, undefined, budget), definitions = new DocumentXmlEditor(styleSource, {}, undefined, budget);
  if (host === "worker") {
    const resolved = new NumberingGraph(numbering, definitions.root, budget).resolve(1);
    expect(resolved.definition.attributes.find(a => a.localName === "abstractNumId")!.value).toBe(String(depth));
    expect(resolved.levels.get(0)!.children.find(c => c.localName === "numFmt")!.attributes.find(a => a.localName === "val")!.value).toBe("decimal");
    expect(resolved.starts.get(0)!.attributes.find(a => a.localName === "val")!.value).toBe("7");
  } else {
    const script = `import {Volume} from 'memfs';import {DocumentBudget} from ${JSON.stringify(new URL("./budget.ts", import.meta.url).href)};import {DocumentXmlEditor} from ${JSON.stringify(new URL("./xml-write.ts", import.meta.url).href)};import {NumberingGraph} from ${JSON.stringify(new URL("./numbering.ts", import.meta.url).href)};
let input='';for await(const chunk of process.stdin)input+=chunk;const request=JSON.parse(input),memory=Volume.fromJSON(request),budget=new DocumentBudget({xmlDepth:8192,retainedBytes:2**31,work:2**31}),n=new DocumentXmlEditor(new Uint8Array(memory.readFileSync('/numbering')),{},undefined,budget),s=new DocumentXmlEditor(new Uint8Array(memory.readFileSync('/styles')),{},undefined,budget);try{const result=new NumberingGraph(n,s.root,budget).resolve(1);console.log(JSON.stringify({ok:true,definition:result.definition.attributes.find(a=>a.localName==='abstractNumId').value,format:result.levels.get(0).children.find(c=>c.localName==='numFmt').attributes.find(a=>a.localName==='val').value,start:result.starts.get(0).attributes.find(a=>a.localName==='val').value,unchanged:Buffer.from(n.serialize()).equals(memory.readFileSync('/numbering'))&&Buffer.from(s.serialize()).equals(memory.readFileSync('/styles'))}));}catch(error){console.log(JSON.stringify({ok:false,error:String(error),code:error.code??null}));}`;
    const response = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", bytes => { stdout += String(bytes); });
      child.stderr.on("data", bytes => { stderr += String(bytes); });
      child.on("error", reject);
      child.on("close", code => { if (code !== 0) reject(new Error(stderr)); else resolve(stdout); });
      child.stdin.end(JSON.stringify(memory.toJSON()));
    });
    expect(JSON.parse(response)).toEqual({ ok: true, definition: String(depth), format: "decimal", start: "7", unchanged: true });
  }
  expect(numbering.serialize()).toEqual(source);
  expect(definitions.serialize()).toEqual(styleSource);
  expect(new Uint8Array(memory.readFileSync("/numbering") as Buffer)).toEqual(source);
});

it("numbering style lookup reserves work for repeated dependency resolution", () => {
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const memory = Volume.fromJSON({ "/numbering": `<w:numbering xmlns:w="${w}"/>`, "/styles": `<w:styles xmlns:w="${w}"><w:style w:type="numbering" w:styleId="Chain"><w:name w:val="Chain"/></w:style></w:styles>` });
  const budget = new DocumentBudget();
  const numbering = new DocumentXmlEditor(new Uint8Array(memory.readFileSync("/numbering") as Buffer), {}, undefined, budget);
  const styles = new DocumentXmlEditor(new Uint8Array(memory.readFileSync("/styles") as Buffer), {}, undefined, budget);
  const graph = new NumberingGraph(numbering, styles.root, budget), before = budget.usage.work;
  for (let i = 0; i < 10; i++) expect(graph.style("Chain", "numbering")).toBe(styles.root.children[0]);
  expect(budget.usage.work - before).toBeGreaterThanOrEqual(10);
});

for (const strict of [false, true]) for (const variant of ["boundary", "limit", "cycle"] as const)
it(`numbering dependency ${variant} preserves typed bounds and source; strict=${strict}`, () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", depth = 8;
  const nums: string[] = [], styles: string[] = [];
  for (let i = 1; i <= depth; i++) {
    const last = i === depth;
    nums.push(`<w:abstractNum w:abstractNumId="${i}">${last && variant !== "cycle" ? '<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>' : `<w:numStyleLink w:val="Chain${last ? 1 : i + 1}"/>`}</w:abstractNum><w:num w:numId="${i}"><w:abstractNumId w:val="${i}"/></w:num>`);
    styles.push(`<w:style w:type="numbering" w:styleId="Chain${i}"><w:name w:val="Chain ${i}"/><w:pPr><w:numPr><w:numId w:val="${i}"/></w:numPr></w:pPr></w:style>`);
  }
  const memory = Volume.fromJSON({ "/numbering": `<w:numbering xmlns:w="${w}">${nums.join("")}</w:numbering>`, "/styles": `<w:styles xmlns:w="${w}">${styles.join("")}</w:styles>` });
  const source = new Uint8Array(memory.readFileSync("/numbering") as Buffer), styleSource = new Uint8Array(memory.readFileSync("/styles") as Buffer);
  const budget = new DocumentBudget({ xmlDepth: variant === "limit" ? depth - 1 : depth });
  const numbering = new DocumentXmlEditor(source, {}, undefined, budget), definitions = new DocumentXmlEditor(styleSource, {}, undefined, budget);
  const graph = new NumberingGraph(numbering, definitions.root, budget);
  if (variant === "boundary") expect(graph.resolve(1).levels.size).toBe(1);
  else expect(() => graph.resolve(1)).toThrow(UnsupportedEditError);
  expect(numbering.serialize()).toEqual(source);
  expect(definitions.serialize()).toEqual(styleSource);
});
