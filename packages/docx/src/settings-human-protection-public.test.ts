import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const sample of [
  { xml: '<w:documentProtection w:enforcement="1" w:edit="readOnly" w:hash="secret-hash"/>', line: "documentProtection: enforced true; edit readOnly" },
  { xml: '<w:writeProtection w:recommended="0" w:password="secret-password"/>', line: "writeProtection: enforced true; edit unspecified" },
  { xml: '<w:documentProtection w:enforcement="invalid"/>', line: "documentProtection: enforced unknown; edit unspecified" }
]) it(`human protection state uses readable labels; strict=${strict}; kind=${kind}; line=${sample.line}`, async () => {
  const input = await textFixture("<w:p/>", { settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}">${sample.xml}</w:settings>` } }, strict, { kind });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input) }), fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
  const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try { const result = await shell.exec("docx settings list /input"); expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toContain(sample.line); expect(result.stdout).not.toContain("protection["); expect(result.stdout).not.toContain("secret-"); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
