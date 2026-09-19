import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const boundary of [0, 2, 4]) for (const layout of ["mixed", "separate"] as const) for (const formatted of [false, true])
for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
it(`${route} preserving replacement crosses own zero comment marker through ${carrier}; boundary=${boundary}; layout=${layout}; formatted=${formatted}; ${kind}; strict=${strict}`, async () => {
  const wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` :
    `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const marker = "<w:annotationRef/>", run = (content: string) => `<w:r><w:rPr><w:rtl/><w:b/></w:rPr>${wrap(content)}</w:r>`;
  const mixed = (boundary === 0 ? marker : "") + "<w:t>c🌊</w:t>" + (boundary === 2 ? marker : "") + "<w:t>st</w:t>" + (boundary === 4 ? marker : "");
  const runs = layout === "mixed" ? run(mixed) : (boundary === 0 ? run(marker) : "") + run("<w:t>c🌊</w:t>") + (boundary === 2 ? run(marker) : "") + run("<w:t>st</w:t>") + (boundary === 4 ? run(marker) : "");
  const before = readPackage(await textFixture('<w:p><w:r><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7" w:author="Original"><w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:comment-scalar" mc:Ignorable="f" mc:ProcessContent="f:pass">${runs}<!--paragraph retained--><?policy keep?></w:p></w:comment></w:comments>` }
  }, strict));
  if (kind === "dotx") before.set("[Content_Types].xml", new TextEncoder().encode(
    new TextDecoder().decode(before.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...before].map(([name, bytes]) =>
    ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
  { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), locations = await api.openDocumentLocations(input, textContext);
  expect(locations.text({ scope: "comments" }).text).toBe("c🌊st");
  expect((await api.Document(input, textContext)).comments.get(7)!.text).toBe("c🌊st");
  const paragraph = locations.at("paragraph", 1, { scope: "comments" });
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
  for (const [name, bytes] of before) if (name !== "word/comments.xml") expect(saved.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(saved.get("word/comments.xml")); expect(xml.split(marker)).toHaveLength(2);
  expect(xml).toContain("<!--paragraph retained-->"); expect(xml).toContain("<?policy keep?>");
  const result = (await api.openDocumentLocations(output, textContext)).text({ scope: "comments" });
  expect(result.text).toBe("c日本t");
  expect(result.segments.filter(segment => segment.text.includes("日本")).every(segment => segment.formatting.bold === !formatted)).toBe(true);
  expect(result.segments.every(segment => segment.formatting.rtl === true)).toBe(true);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const owner of ["body", "comments"] as const)
for (const marker of owner === "body" ? ["<w:annotationRef/>"] : ["<w:annotationRef>opaque</w:annotationRef>", "<w:annotationRef><w:t>opaque</w:t></w:annotationRef>"])
for (const route of ["sdk", "sdk-batch", "shell", "shell-batch"] as const)
it(`${route} preserves foreign or malformed replacement boundary; owner=${owner}; marker=${marker}; strict=${strict}`, async () => {
  const content = `<w:p><w:r><w:t>c🌊</w:t>${marker}<w:t>st</w:t></w:r></w:p>`;
  const input = await textFixture(owner === "body" ? content : "<w:p/>", owner === "comments" ? {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7">${content}</w:comment></w:comments>` }
  } : {}, strict), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "Original destination" });
  const select = (await api.openDocumentLocations(input, textContext)).at("paragraph", 1, { scope: owner }).token;
  const args = { select, find: "🌊s", with: "日本", all: true }, batch = { version: 1 as const, operations: [{ operation: "text.replace" as const, arguments: args }] };
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
  if (route === "sdk") await expect(api.replaceDocumentText(input, { ...args, output: "-" }, context)).rejects.toMatchObject({ code: "missing-selection" });
  else if (route === "sdk-batch") await expect(api.executeDocumentBatch(input, batch, { output: "-" }, context)).rejects.toMatchObject({ code: "missing-selection", operationIndex: 0 });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(route === "shell" ? `docx text replace /input --select '${select}' --find '🌊s' --with '日本' --all --output /out --force --json` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output /out --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: "missing-selection" }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
    } finally { await shell.dispose(); }
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); expect(volume.readFileSync("/out", "utf8")).toBe("Original destination");
});
