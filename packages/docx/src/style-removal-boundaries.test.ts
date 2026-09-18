import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const part of ["absent", "empty", "ambiguous"] as const) for (const allowEmpty of [false, true]) for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
it(`${route} enforces named removal cardinality with ${part} styles allowEmpty=${allowEmpty}; strict=${strict}`, async () => {
  const definition = '<w:style w:type="paragraph" w:styleId="first"><w:name w:val="Original Selected"/></w:style>';
  const input = await textFixture('<w:p><w:r><w:t>Retained é 日本 עברית 🌊</w:t></w:r></w:p>', part === "absent" ? {} : { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}">${part === "ambiguous" ? definition + definition.replace('styleId="first"', 'styleId="second"') : ""}</w:styles>` } }, strict), volume = Volume.fromJSON({ "/out": "" });
  const accepted = part !== "ambiguous" && allowEmpty, code = part === "ambiguous" ? "ambiguous-selection" : "missing-selection", arguments_ = { name: "Original Selected", allowEmpty }, batch = { version: 1, operations: [{ operation: "styles.remove", arguments: arguments_ }] }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
  if (route === "sdk" || route === "sdk-batch") {
    const result = route === "sdk" ? api.editDocumentStyles(input, { operation: "styles.remove", ...arguments_, output: "-" }, context) : api.executeDocumentBatch(input, batch, { output: "-" }, context);
    if (accepted) { const data = await result; if ("changed" in data) { expect(data.changed).toBe(false); expect(data.changes).toHaveLength(0); } else { expect(data.results[0]!.affected).toBe(0); expect(data.publication?.changed).toBe(false); } }
    else await expect(result).rejects.toMatchObject({ code });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/dest", new TextEncoder().encode("Existing destination")); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const command = route === "shell" ? `docx styles remove /input --name 'Original Selected' ${allowEmpty ? "--allow-empty " : ""}--output /dest --force --json` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output /dest --force --json`;
      const result = await shell.exec(command), envelope = JSON.parse(result.stdout); expect(result.exitCode, result.stdout + result.stderr).toBe(accepted ? 0 : 1); expect(await fs.readFile("/input")).toEqual(input);
      if (accepted) { expect(envelope.affected).toBe(0); volume.writeFileSync("/out", await fs.readFile("/dest")); }
      else { expect(envelope.errors[0].code).toBe(code); expect(new TextDecoder().decode(await fs.readFile("/dest"))).toBe("Existing destination"); }
    } finally { await shell.dispose(); }
  }
  if (accepted) { const before = readPackage(input), after = readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer)); expect(after.size).toBe(before.size); for (const [name, bytes] of before) expect(after.get(name), name).toEqual(bytes); }
  else expect(volume.readFileSync("/out")).toHaveLength(0);
});

it("discovers named style removal and admits it to the ordered executor", () => {
  const discovery = (...args: string[]) => api.getDocxDiscovery(api.parseDocxArguments(args.map(arg => new TextEncoder().encode(arg))))!;
  expect(discovery("schema", "styles", "remove").data).toMatchObject({ operations: [{ id: "styles.remove", support: "edit", result: { oneOf: [{ properties: { affected: { type: "integer", minimum: 0 }, data: { properties: { changes: { items: { properties: { kind: { const: "style" }, id: { type: "string" } } } } } } } }, {}] } }] });
  expect(discovery("help", "batch").human).toContain("styles.remove");
  expect(discovery("capabilities").data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F14", operationIds: expect.arrayContaining(["styles.remove"]) })]) });
});
