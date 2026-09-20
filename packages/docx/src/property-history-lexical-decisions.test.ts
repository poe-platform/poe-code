import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
const vectors = [
  ["absent", undefined, true], ["true", " &#x9;true&#xD;&#xA; ", true],
  ["false", " &#x9;false&#xD;&#xA; ", false], ["one", " &#x9;1&#xD;&#xA; ", true],
  ["zero", " &#x9;0&#xD;&#xA; ", false], ["on", "on", true], ["off", "off", false]
] as const;
const flag = (name: string, value: string | undefined) => `<w:${name}${value === undefined ? "" : ` w:val="${value}"`}/>`;
const text = "日本 עברית \u2067شرق\u2069 e\u0323\u0301 🌊 𠀀";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const [label, lexical, oldValue] of vectors) for (const action of ["accept", "reject"] as const)
for (const route of ["sdk", "cli"] as const) for (const dryRun of [false, true])
it(`decides admitted old and current boolean lexical state exactly; ${label}; ${action}; ${route}; dry=${dryRun}; ${kind}; strict=${strict}`, async () => {
  const currentLexical = oldValue ? " &#x9;false&#xD;&#xA; " : " &#x9;true&#xD;&#xA; ";
  const history = (owner: "p" | "r", id: number, properties: string) => `<w:${owner}PrChange w:id="${id}" w:author="Original"><w:${owner}Pr>${properties}</w:${owner}Pr></w:${owner}PrChange>`;
  const oldRun = ["b", "i", "rtl", "vanish"].map(name => flag(name, lexical)).join("");
  const oldParagraph = flag("bidi", lexical);
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind,
    `<w:p><w:pPr>${flag("bidi", currentLexical)}${history("p", 1, oldParagraph)}</w:pPr><w:r><w:rPr>${["b", "i", "rtl", "vanish"].map(name => flag(name, currentLexical)).join("")}${history("r", 2, oldRun)}</w:rPr><w:t>${text}</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const original = input.slice(), before = readPackage(input), memory = Volume.fromJSON({ "/out": "" });
  const originalXml = new TextDecoder().decode(before.get("word/document.xml")!);
  const historical = await api.extractDocumentText(input, textContext, { view: "original" });
  expect(historical.warnings).toEqual([]);
  expect(historical.segments[0]!.formatting).toMatchObject({ bold: oldValue, italic: oldValue, rtl: oldValue, hidden: oldValue, paragraph: { bidi: oldValue } });
  let output: Uint8Array | undefined;
  if (route === "sdk") {
    const result = await api.editDocumentRevisionDecisions(input, { operation: `revisions.${action}`, options: { all: true, output: "-", dryRun } }, {
      ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } }
    });
    expect(result.changed).toBe(true); expect(result.changes).toHaveLength(2); expect(result.dryRun).toBe(dryRun);
    if (dryRun) { expect(result.output).toBeNull(); expect(memory.readFileSync("/out").length).toBe(0); }
    else output = new Uint8Array(memory.readFileSync("/out") as Buffer);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx revisions ${action} /input --all --output /destination --force --json${dryRun ? " --dry-run" : ""}`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(true); expect(envelope.affected).toBe(2); expect(envelope.data.dryRun).toBe(dryRun);
      expect(await fs.readFile("/input")).toEqual(original);
      if (dryRun) expect(await fs.readFile("/destination")).toEqual(enc("Retained destination")); else output = await fs.readFile("/destination");
    } finally { await shell.dispose(); }
  }
  if (output) {
    const after = readPackage(output); assertPackageLinks(after); expect(after.size).toBe(before.size);
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
    const xml = new TextDecoder().decode(after.get("word/document.xml")!);
    expect(xml).not.toContain("PrChange"); expect(xml).toContain("<!--retain--><?policy keep?>");
    // Rollback restores the old property payload's exact lexical spelling and replaces current fields.
    for (const owner of ["p", "r"]) {
      const start = originalXml.indexOf(`<w:${owner}Pr>`, originalXml.indexOf(`<w:${owner}PrChange`));
      const end = originalXml.indexOf(`</w:${owner}Pr>`, start) + `</w:${owner}Pr>`.length;
      const snapshot = originalXml.slice(start, end);
      expect(snapshot.length).toBeGreaterThan(0);
      if (action === "reject") {
        const payload = snapshot.slice(snapshot.indexOf(">") + 1, snapshot.lastIndexOf("</"));
        const root = api.parseDocumentXml(after.get("word/document.xml")!, {}, new api.DocumentBudget()).root;
        const paragraph = root.children[0]!.children[0]!;
        const container = owner === "p" ? paragraph : paragraph.children.find(child => child.localName === "r")!;
        const restored = container.children.find(child => child.localName === `${owner}Pr`)!;
        expect(restored.namespace).toBe(strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main");
        expect(restored.attributes.filter(attribute => attribute.namespace !== "http://www.w3.org/2000/xmlns/")).toEqual([]);
        // Namespace declarations can be lifted faithfully onto the restored container.
        expect(xml).toContain(payload); expect(restored.children.map(child => child.localName)).toEqual(owner === "p" ? ["bidi"] : ["b", "i", "rtl", "vanish"]);
      }
    }
    const data = await api.extractDocumentText(output, textContext, { view: "all" });
    const expected = action === "reject" ? oldValue : !oldValue;
    expect(data.text).toBe(text); expect(data.revisions).toEqual([]); expect(data.warnings).toEqual([]);
    expect(data.segments[0]!.formatting).toMatchObject({ bold: expected, italic: expected, rtl: expected, hidden: expected, paragraph: { bidi: expected } });
  }
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(before);
});

for (const strict of [false, true]) for (const owner of ["p", "r"] as const)
for (const snapshot of ["padded-on", "padded-off", "nbsp", "inner-carrier", "unknown", "duplicate", "compound-current"] as const)
for (const action of ["accept", "reject"] as const) for (const route of ["sdk", "cli"] as const)
it(`refuses opaque snapshot or compound current rollback atomically; ${snapshot}; ${owner}; ${action}; ${route}; strict=${strict}`, async () => {
  const name = owner === "p" ? "bidi" : "b";
  const token = snapshot === "padded-on" ? " on " : snapshot === "padded-off" ? " off " : snapshot === "nbsp" ? "&#xA0;false&#xA0;" : " &#x9;true&#xA; ";
  const simple = flag(name, token);
  const old = snapshot === "inner-carrier" ? `<f:pass>${simple}</f:pass>` : snapshot === "unknown" ? "<w:unknown/>" : snapshot === "duplicate" ? simple + simple : simple;
  const history = `<w:${owner}PrChange w:id="1"><w:${owner}Pr>${old}</w:${owner}Pr></w:${owner}PrChange>`;
  const properties = `<w:${owner}Pr>${flag(name, "false")}${snapshot === "compound-current" ? "<w:unknown/>" : ""}${history}</w:${owner}Pr>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, "docx",
    `<w:p xmlns:f="urn:original:opaque-history" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f" mc:ProcessContent="f:pass">${owner === "p" ? properties : ""}<w:r>${owner === "r" ? properties : ""}<w:t>${text}</w:t></w:r></w:p>`);
  const original = input.slice(), before = readPackage(input), memory = Volume.fromJSON({ "/out": "Retained destination" });
  if (route === "sdk") await expect(api.editDocumentRevisionDecisions(input, { operation: `revisions.${action}`, options: { all: true, output: "-" } }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } }
  })).rejects.toMatchObject({ code: "unsupported-edit" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx revisions ${action} /input --all --output /destination --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(false); expect(envelope.data).toBeNull(); expect(envelope.affected).toBe(0); expect(envelope.errors[0].code).toBe("unsupported-edit");
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/destination")).toEqual(enc("Retained destination"));
    } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/out", "utf8")).toBe("Retained destination"); expect(input).toEqual(original); expect(readPackage(input)).toEqual(before);
});
