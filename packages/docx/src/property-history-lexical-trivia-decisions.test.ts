import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const snapshot of ["empty", "empty-trivia", "boolean-trivia", "empty-cdata", "boolean-cdata", "boolean-field-trivia", "boolean-field-cdata"] as const)
for (const action of ["accept", "reject"] as const) for (const route of ["sdk", "cli"] as const)
for (const dryRun of [false, true])
it(`decides admitted direct property snapshot with faithful inert lexical content; ${snapshot}; ${action}; ${route}; dry=${dryRun}; ${kind}; strict=${strict}`, async () => {
  const trivia = snapshot === "empty" ? "" : snapshot.endsWith("cdata") ? "<![CDATA[ \t\r\n ]]>" : "<!--historical--><?history keep?>";
  const flags = (tags: string[], value: string, inert = "") => tags.map(tag => `<w:${tag} w:val="${value}"${inert ? `>${inert}</w:${tag}>` : "/>"}`).join("");
  const historical = (owner: "p" | "r", id: number) => `<w:${owner}PrChange w:id="${id}" w:author="Original">${trivia}<w:${owner}Pr>${trivia}${snapshot.startsWith("boolean") ? flags(owner === "p" ? ["bidi"] : ["b", "i", "rtl", "vanish"], " &#x9;false&#xD;&#xA; ", snapshot.includes("field") ? trivia : "") : ""}${trivia}</w:${owner}Pr>${trivia}</w:${owner}PrChange>`;
  const text = "日本 עברית \u2067شرق\u2069 e\u0323\u0301 🌊 𠀀";
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind,
    `<w:p><w:pPr>${flags(["bidi"], " &#x9;true&#xA; ")}${historical("p", 1)}</w:pPr><w:r><w:rPr>${flags(["b", "i", "rtl", "vanish"], " &#x9;1&#xD; ")}${historical("r", 2)}</w:rPr><w:t>${text}</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const original = input.slice(), before = readPackage(input), memory = Volume.fromJSON({ "/out": "" });
  const old = await api.extractDocumentText(input, textContext, { view: "original" }), oldValue = snapshot.startsWith("boolean") ? false : null;
  expect(old.revisions.map(revision => revision.support)).toEqual(["supported", "supported"]); expect(old.warnings).toEqual([]);
  expect(old.segments[0]!.formatting).toMatchObject({ bold: oldValue, italic: oldValue, rtl: oldValue, hidden: oldValue, paragraph: { bidi: oldValue } });
  let output: Uint8Array | undefined;
  if (route === "sdk") {
    const result = await api.editDocumentRevisionDecisions(input, { operation: `revisions.${action}`, options: { all: true, output: "-", dryRun } }, {
      ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } }
    });
    expect(result.changed).toBe(true); expect(result.changes).toHaveLength(2); expect(result.dryRun).toBe(dryRun);
    if (dryRun) { expect(result.output).toBeNull(); expect(memory.readFileSync("/out").length).toBe(0); } else output = new Uint8Array(memory.readFileSync("/out") as Buffer);
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
    if (action === "reject" && trivia) expect(xml.split(trivia)).toHaveLength(snapshot.includes("field") ? 10 : 5);
    else if (trivia) expect(xml).not.toContain(trivia);
    if (action === "reject" && snapshot.startsWith("boolean")) expect(xml.split(" &#x9;false&#xD;&#xA; ")).toHaveLength(6);
    const data = await api.extractDocumentText(output, textContext, { view: "all" }), expected = action === "reject" ? oldValue : true;
    expect(data.text).toBe(text); expect(data.revisions).toEqual([]); expect(data.warnings).toEqual([]);
    expect(data.segments[0]!.formatting).toMatchObject({ bold: expected, italic: expected, rtl: expected, hidden: expected, paragraph: { bidi: expected } });
  }
  expect(input).toEqual(original); expect(readPackage(input)).toEqual(before);
});

for (const strict of [false, true]) for (const owner of ["p", "r"] as const)
for (const lexical of ["text", "cdata"] as const) for (const action of ["accept", "reject"] as const)
for (const route of ["sdk", "cli"] as const)
it(`refuses meaningful unsupported property-history text before effects; ${lexical}; ${owner}; ${action}; ${route}; strict=${strict}`, async () => {
  const body = lexical === "cdata" ? "<![CDATA[Meaningful]]>" : "Meaningful";
  const properties = `<w:${owner}Pr><w:${owner === "p" ? "bidi" : "b"}/><w:${owner}PrChange w:id="1"><w:${owner}Pr>${body}</w:${owner}Pr></w:${owner}PrChange></w:${owner}Pr>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, "docx", `<w:p>${owner === "p" ? properties : ""}<w:r>${owner === "r" ? properties : ""}<w:t>Retained 日本 עברית 🌊</w:t></w:r></w:p>`);
  const original = input.slice(), before = readPackage(input), memory = Volume.fromJSON({ "/out": "Retained destination" });
  const inventory = await api.inspectDocumentRevisions(input, {}, textContext); expect(inventory.items[0]!.support).toBe("opaque");
  if (route === "sdk") await expect(api.editDocumentRevisionDecisions(input, { operation: `revisions.${action}`, options: { all: true, output: "-" } }, {
    ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } }
  })).rejects.toMatchObject({ code: "unsupported-edit" });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", enc("Retained destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx revisions ${action} /input --all --output /destination --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1); const envelope = JSON.parse(result.stdout);
      expect(envelope.ok).toBe(false); expect(envelope.data).toBeNull(); expect(envelope.affected).toBe(0); expect(envelope.errors[0].code).toBe("unsupported-edit");
      expect(await fs.readFile("/input")).toEqual(original); expect(await fs.readFile("/destination")).toEqual(enc("Retained destination"));
    } finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/out", "utf8")).toBe("Retained destination"); expect(input).toEqual(original); expect(readPackage(input)).toEqual(before);
});
