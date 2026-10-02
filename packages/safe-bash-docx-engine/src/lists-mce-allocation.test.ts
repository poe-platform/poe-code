import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, createDocxInspectionCommandEngine, editDocumentLists } from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const abstract = (id: string) => `<w:abstractNum w:abstractNumId="${id}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum>`;
const num = (id: string, definition = "0") => `<w:num w:numId="${id}"><w:abstractNumId w:val="${definition}"/></w:num>`;
const alternate = (choice: string, fallback: string, requires = "w") => `<mc:AlternateContent><mc:Choice Requires="${requires}">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
const fixtures = ["direct", "selected collision", "fallback collision", "process collision", "ignored collision", "selected order", "mixed alternative", "selected cleanup", "numeric spelling", "direct signed spelling", "opaque malformed", "opaque phase noise"] as const;
function numbering(fixture: typeof fixtures[number]) {
  if (fixture === "opaque phase noise") return abstract("0") + `<f:opaque>${abstract("2")}${num("7", "2")}<w:numIdMacAtCleanup w:val="90"/></f:opaque>`;
  if (fixture === "direct signed spelling") return abstract("-0") + num("+01", "-0");
  if (fixture === "mixed alternative") return alternate(abstract("0") + num("1"), abstract("2") + num("2", "2"));
  const content = fixture === "direct" ? num("1")
    : fixture === "selected collision" ? alternate(num("1"), num("2"))
    : fixture === "fallback collision" ? alternate(num("2"), num("1"), "f")
    : fixture === "process collision" ? `<f:pass>${num("1")}</f:pass>`
    : fixture === "ignored collision" ? `<f:opaque>${num("1")}${num("2")}</f:opaque>`
    : fixture === "selected order" ? alternate(num("7"), num("8"))
    : fixture === "selected cleanup" ? num("7") + alternate('<w:numIdMacAtCleanup w:val="90"/>', '<w:numIdMacAtCleanup w:val="91"/>')
    : fixture === "numeric spelling" ? alternate(num("+01"), num("002"))
    : alternate(num("7"), num("broken"));
  return abstract("0") + content;
}
type Node = ReturnType<typeof xmlStructure>;
const children = (node: Node): Node[] => node.children.filter((child): child is Node => typeof child !== "string");

for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const) it.each(fixtures)(
  `${strict ? "Strict" : "Transitional"} ${route} publishes a separate list around %s`, async fixture => {
    const body = '<w:p><w:r><w:t>Ordinary</w:t></w:r></w:p>';
    const markup = numbering(fixture);
    const source = `<?xml version="1.0"?><!--original--><w:numbering xmlns:w="${w}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass">${markup}</w:numbering><!--retained-->`;
    const input = await textFixture(body, { numbering: { kind: "numbering", xml: source } }, strict);
    const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/out": "", "/err": "" });
    const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    if (route === "sdk") {
      const result = await editDocumentLists(input, { operation: "lists.add", options: { paragraph: 1, kind: "decimal", text: "New", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
      expect(result.changed).toBe(true);
      expect(result.changes).toHaveLength(1);
    } else {
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["lists", "add", "/input.docx", "--paragraph", "1", "--kind", "decimal", "--text", "New", "--output", "-"].map(word => new TextEncoder().encode(word)),
        cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
        stdin: { async *[Symbol.asyncIterator]() {} }, stdout,
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    }
    const saved = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(saved);
    assertPackageLinks(after);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) if (!["word/document.xml", "word/numbering.xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
    expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
    const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
    const root = children(xmlStructure(after.get("word/numbering.xml")!)).find(node => node.name === `{${namespace}}numbering`)!;
    const originalRoot = children(xmlStructure(before.get("word/numbering.xml")!)).find(node => node.name === `{${namespace}}numbering`)!;
    const direct = children(root), originalChildren = children(originalRoot);
    // New nodes may be interleaved, but every original subtree remains exact.
    let offset = 0;
    for (const original of originalChildren) {
      const found = direct.findIndex((candidate, i) => i >= offset && JSON.stringify(candidate) === JSON.stringify(original));
      expect(found).toBeGreaterThanOrEqual(offset); offset = found + 1;
    }
    const text = new TextDecoder().decode(after.get("word/numbering.xml")!);
    expect(text.startsWith('<?xml version="1.0"?><!--original-->')).toBe(true);
    expect(text.endsWith('<!--retained-->')).toBe(true);
    // The original wrappers themselves must remain byte-exact, independent of parsing.
    for (const tag of ["mc:AlternateContent", "f:pass", "f:opaque"]) {
      const start = source.indexOf("<" + tag + ">"), end = source.indexOf("</" + tag + ">");
      if (start >= 0) expect(text).toContain(source.slice(start, end + tag.length + 3));
    }
    // This fixture oracle chooses the named branch directly, without production MCE code.
    for (const branch of ["Choice", "Fallback"] as const) {
      const flatten = (nodes: Node[]): Node[] => nodes.flatMap(node => node.name === `{${mc}}AlternateContent`
        ? flatten(children(children(node).find(child => child.name === `{${mc}}${branch}`)!))
        : node.name === "{urn:original:future}pass" ? flatten(children(node)) : node.name === "{urn:original:future}opaque" ? [] : [node]);
      const logical = flatten(direct), order = logical.map(node => node.name.slice(node.name.indexOf("}") + 1));
      const rank = order.map(name => name === "abstractNum" ? 0 : name === "num" ? 1 : name === "numIdMacAtCleanup" ? 2 : -1);
      expect(rank).toEqual([...rank].sort((a, b) => a - b));
      for (const kind of ["abstractNum", "num"]) {
        const ids = logical.filter(node => node.name === `{${namespace}}${kind}`).map(node => Number(node.attributes[`{${namespace}}${kind === "num" ? "numId" : "abstractNumId"}`])).filter(Number.isFinite);
        expect(new Set(ids).size, branch + " " + kind).toBe(ids.length);
      }
    }
    const added = direct.filter(node => node.name === `{${namespace}}num` && !originalChildren.some(original => JSON.stringify(node) === JSON.stringify(original)));
    expect(added).toHaveLength(1);
    const id = Number(added[0]!.attributes[`{${namespace}}numId`]);
    const expectedId = ["selected collision", "fallback collision", "ignored collision", "mixed alternative", "numeric spelling"].includes(fixture) ? 3 : ["direct", "process collision", "direct signed spelling"].includes(fixture) ? 2 : 1;
    expect(id).toBe(expectedId);
    const doc = await Document(saved, textContext);
    expect(doc.paragraphs.map(p => p.text)).toEqual(["Ordinary", "New"]);
    const bodyRoot = children(children(xmlStructure(after.get("word/document.xml")!))[0]!)[0]!;
    const paragraph = children(bodyRoot)[1]!, pPr = children(paragraph)[0]!, numPr = children(pPr)[0]!;
    expect(children(numPr).find(node => node.name === `{${namespace}}numId`)?.attributes[`{${namespace}}val`]).toBe(String(id));
  }
);

for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const) it(
  `refuses an inseparable mixed numbering/cleanup boundary; strict=${strict}; ${route}`, async () => {
    const mixed = abstract("0") + num("7") + '<w:numIdMacAtCleanup w:val="90"/>';
    const input = await textFixture('<w:p/>', { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}" xmlns:mc="${mc}">${alternate(mixed, mixed)}</w:numbering>` } }, strict);
    const volume = Volume.fromJSON({ "/in.docx": Buffer.from(input), "/out": "", "/err": "" });
    const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    if (route === "sdk") await expect(editDocumentLists(input, { operation: "lists.add", options: { paragraph: 1, kind: "decimal", text: "New", output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout })).rejects.toMatchObject({ code: "unsupported-edit" });
    else {
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["lists", "add", "/in.docx", "--paragraph", "1", "--kind", "decimal", "--text", "New", "--output", "-"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout,
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode).not.toBe(0);
      expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-edit");
    }
    expect(volume.readFileSync("/out")).toHaveLength(0);
    expect(volume.readFileSync("/in.docx")).toEqual(Buffer.from(input));
  }
);
