import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { createDocxInspectionCommandEngine, getDocxOperationSchema, docxValueSchema } from "./index.js";

import { textContext } from "../tests/fixtures/text.js";

const operations = [
 ...["BaseStyle", "ParagraphStyle", "CharacterStyle", "_TableStyle", "_NumberingStyle"].map(type => `model.styles.style.${type}.priority.set`),
 "model.styles.latent._LatentStyle.priority.set",
 "model.styles.latent.LatentStyles.default_priority.set",
 "model.styles.latent.LatentStyles.load_count.set"
];
for (const operation of operations) for (const surface of ["cli", "sdk", "batch"] as const)
it(`discovers exact signed32/null native setter range for ${operation} on ${surface}`, () => {
 const schema = getDocxOperationSchema(operation, surface), value = schema.properties!.value!;
 expect(JSON.stringify(value)).not.toContain("No transport value is declared");
 expect(JSON.stringify(value)).toContain('"minimum":-2147483648');
 expect(JSON.stringify(value)).toContain('"maximum":2147483647');
 expect(JSON.stringify(value)).toContain('"type":"integer"');
 expect(JSON.stringify(value)).toContain('"type":"null"');
 expect(schema.required).toContain("value");
});
it("keeps direct priority and load-count discovery independently bounded", () => {
 expect(docxValueSchema("integer 0..99")).toMatchObject({ type: "integer", minimum: 0, maximum: 99 });
 expect(docxValueSchema("nonnegative safe integer")).toMatchObject({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
});
for (const operation of operations)
it(`actual opted-in CLI schema exposes exact native signed32 range for ${operation}`, async () => {
 const shell = new Shell({ fs: new MemoryFileSystem() }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
 try {
  const result = await shell.exec(`docx schema --operation ${operation} --json`);
  expect(result.exitCode, result.stdout + result.stderr).toBe(0);
  const envelope = JSON.parse(result.stdout);
  expect(envelope.ok).toBe(true);
  expect(JSON.stringify(envelope.data)).toContain('"minimum":-2147483648');
  expect(JSON.stringify(envelope.data)).toContain('"maximum":2147483647');
  expect(JSON.stringify(envelope.data)).toContain('"type":"integer"');
 } finally { await shell.dispose(); }
});
