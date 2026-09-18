import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const part of ["absent", "empty", "defined"] as const) for (const forbidden of [{ allowEmpty: true }, { allowEmpty: false }, { scope: "body" }, { paragraph: 1 }, { all: true }]) for (const route of ["sdk", "shell", "sdk-batch", "shell-batch"] as const)
it(`${route} rejects package-global removal option ${JSON.stringify(forbidden)} before publication; ${part}; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Keep 日本 עברית</w:t></w:r></w:p>', part === "absent" ? {} : { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}">${part === "defined" ? '<w:style w:type="paragraph" w:styleId="selected"><w:name w:val="Selected"/></w:style>' : ""}</w:styles>` } }, strict), memory = Volume.fromJSON({ "/output": "" });
  const args = { name: "Selected", ...forbidden }, batch = { version: 1, operations: [{ operation: "styles.remove", arguments: args }] }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  if (route === "sdk") await expect(api.editDocumentStyles(input, { operation: "styles.remove", ...args, output: "-" } as unknown as api.StyleEditOptions, context)).rejects.toMatchObject({ code: "usage" });
  else if (route === "sdk-batch") await expect(api.executeDocumentBatch(input, batch, { output: "-" }, context)).rejects.toMatchObject({ code: "usage" });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/output", new TextEncoder().encode("Keep destination")); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const [key, value] = Object.entries(forbidden)[0]!, flag = key === "allowEmpty" ? "--allow-empty" : `--${key}`, token = typeof value === "boolean" ? (value ? flag : `${flag}=false`) : `${flag} ${value}`, result = await shell.exec(route === "shell" ? `docx styles remove /input --name Selected ${token} --output /output --force --json` : `docx batch /input --ops-json '${JSON.stringify(batch)}' --output /output --force --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(2); expect(JSON.parse(result.stdout).errors[0].code).toBe("usage"); expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/output"))).toBe("Keep destination"); } finally { await shell.dispose(); } }
  expect(memory.readFileSync("/output")).toHaveLength(0);
});
