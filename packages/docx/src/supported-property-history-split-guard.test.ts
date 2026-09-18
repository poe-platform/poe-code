import { expect, it } from "vitest";
import { Volume } from "memfs";
import * as api from "./index.js";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
 it(`${route} rejects independent splitting of supported run-history identity through ${carrier}; strict=${strict}`, async () => {
  const history = '<w:rPrChange w:id="7" w:author="Original Reviewer"><w:rPr><w:i/></w:rPr></w:rPrChange>', wrap = (active: string) => carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : ""}</mc:Fallback></mc:AlternateContent>`;
  const input = await textFixture(`<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:history-split" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:r><w:rPr>${wrap(history)}</w:rPr><w:t>c🌊st</w:t></w:r></w:p>`, {}, strict), locations = await api.openDocumentLocations(input, textContext), select = locations.range(locations.at("run", 1, { owner: locations.at("paragraph", 1).token }).token, 1, 3).token, volume = Volume.fromJSON({ "/out": "" });
  const args = { select, bold: true }, batch = { version: 1 as const, operations: [{ operation: "runs.set" as const, arguments: args }] }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
  if (route === "sdk") await expect(api.formatDocumentRuns(input, { ...args, output: "-" }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  else if (route === "sdk-batch") await expect(api.executeDocumentBatch(input, batch, { output: "-" }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const result = await shell.exec(route === "shell" ? `docx runs set /input --select '${select}' --bold true --output - > /out` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output - > /out`); expect(result.exitCode).toBe(1); expect(result.stderr).toContain("unsupported-edit"); expect(await fs.readFile("/input")).toEqual(input); volume.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  expect(volume.readFileSync("/out")).toHaveLength(0);
 });
