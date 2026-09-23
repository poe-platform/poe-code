import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const noteKind of ["footnote", "endnote"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const boundary of [2]) for (const layout of ["mixed", "separate"] as const) for (const formatted of [false, true])
for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
it(`${route} preserving replacement crosses own zero ${noteKind} marker through ${carrier}; boundary=${boundary}; layout=${layout}; formatted=${formatted}; ${kind}; strict=${strict}`, async () => {
  const wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` :
    `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const marker = `<w:${noteKind}Ref/>`, run = (content: string) => `<w:r><w:rPr><w:rtl/><w:b/></w:rPr>${wrap(content)}</w:r>`;
  const mixed = (boundary === 0 ? marker : "") + "<w:t>c🌊</w:t>" + (boundary === 2 ? marker : "") + "<w:t>st</w:t>" + (boundary === 4 ? marker : "");
  const runs = layout === "mixed" ? run(mixed) : (boundary === 0 ? run(marker) : "") + run("<w:t>c🌊</w:t>") + (boundary === 2 ? run(marker) : "") + run("<w:t>st</w:t>") + (boundary === 4 ? run(marker) : "");
  const before = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', {
    [noteKind + "s"]: { kind: noteKind + "s", xml: `<w:${noteKind}s xmlns:w="${w}"><w:${noteKind} w:id="7"><w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:comment-scalar" mc:Ignorable="f" mc:ProcessContent="f:pass">${runs}<!--paragraph retained--><?policy keep?></w:p></w:${noteKind}></w:${noteKind}s>` }
  }, strict));
  if (kind === "dotx") before.set("[Content_Types].xml", new TextEncoder().encode(
    new TextDecoder().decode(before.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...before].map(([name, bytes]) =>
    ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
  { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), locations = await api.openDocumentLocations(input, textContext);
  expect(locations.text({ scope: noteKind + "s" as "footnotes" | "endnotes" }).text).toBe("c🌊st");
  const paragraph = locations.at("paragraph", 1, { scope: noteKind + "s" as "footnotes" | "endnotes" });
  const select = paragraph.token, op = "text.replace" as const;
  const args = { select, find: "🌊s", with: "日本", all: true, ...(formatted ? { bold: false } : {}) };
  const batch = { version: 1 as const, operations: [{ operation: op, arguments: args }] };
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const },
    stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
  if (route === "sdk") {
    await api.replaceDocumentText(input, { ...args, output: "-" }, context);
  } else if (route === "sdk-batch") await api.executeDocumentBatch(input, batch, { output: "-" }, context);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const flags = `--find '🌊s' --with '日本' --all ${formatted ? "--bold false" : ""}`;
      const r = await shell.exec(route === "shell" ? `docx ${op.split(".").join(" ")} /input --select '${select}' ${flags} --output - > /out` :
        `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`);
      expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input);
      volume.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
  for (const [name, bytes] of before) if (name !== `word/${noteKind}s.xml`) expect(saved.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(saved.get(`word/${noteKind}s.xml`)); expect(xml.split(marker)).toHaveLength(2);
  expect(xml).toContain("<!--paragraph retained-->"); expect(xml).toContain("<?policy keep?>");
  const result = (await api.openDocumentLocations(output, textContext)).text({ scope: noteKind + "s" as "footnotes" | "endnotes" });
  expect(result.text).toBe("c日本t");
  expect(result.segments.filter(segment => segment.text.includes("日本")).every(segment => segment.formatting.bold === !formatted)).toBe(true);
  expect(result.segments.every(segment => segment.formatting.rtl === true)).toBe(true);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
