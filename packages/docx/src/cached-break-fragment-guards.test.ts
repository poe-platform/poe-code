import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const fragment of ["preceding_paragraph_fragment", "following_paragraph_fragment"] as const)
for (const scenario of ["stale", "wrong-receiver"] as const)
for (const route of scenario === "stale" ? ["model", "sdk", "cli"] : ["sdk", "cli"])
it(`${route} rejects ${scenario} ${fragment}; ${kind}; strict=${strict}`, async () => {
  const archive = await api.readArchive(await textFixture('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>Before</w:t><w:lastRenderedPageBreak/><w:t>After</w:t></w:r></w:p>', {}, strict), textContext);
  const members = archive.members.map(member => ({ ...member, bytes: kind === "dotx" && member.name === "[Content_Types].xml" ? new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")) : member.bytes }));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.rendered_page_breaks.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "breaks" },
    ...(scenario === "stale" ? [{ operation: "model.text.paragraph.Paragraph.clear.call", receiver: ref("paragraphs", 0), arguments: {} }] : []),
    { operation: `model.text.pagebreak.RenderedPageBreak.${fragment}.get`, receiver: ref(scenario === "stale" ? "breaks" : "paragraphs", 0), arguments: {} }
  ];
  const code = scenario === "stale" ? "stale-selection" : "usage";
  if (route === "model") {
    const doc = await api.Document(input, textContext), p = doc.paragraphs[0]!, marker = p.rendered_page_breaks[0]!;
    p.clear(); const before = doc.element.serialize();
    expect(() => Reflect.get(marker, fragment)).toThrow(api.StaleHandleError);
    expect(doc.element.serialize()).toEqual(before);
    expect(p.text).toBe(""); expect(p.paragraph_format.keep_with_next).toBe(true);
  } else if (route === "sdk") {
    await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --json${scenario === "stale" ? " --output /out --force" : ""}`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(scenario === "stale" ? 1 : 2);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(false); expect(envelope.data).toBeNull(); expect(envelope.affected).toBe(0); expect(envelope.locations).toEqual([]); expect(envelope.errors[0].code).toBe(code);
      expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
    } finally { await shell.dispose(); }
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); expect(volume.readFileSync("/out").length).toBe(0);
});
