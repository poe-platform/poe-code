import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine, parseDocxArguments } from "./index.js";
import { inspectDocumentStyles } from "./styles.js";
import { paragraph, textContext, textFixture, w } from "../tests/fixtures/text.js";

async function execute(words: string[]) {
  const bytes = await textFixture(paragraph("Harbor log"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Harbor"><w:name w:val="Harbor"/></w:style></w:styles>` } });
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes), "/output": "" });
  let stderr = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: words.map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { volume.appendFileSync("/output", chunk); } }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(bytes));
  return { ...result, stderr, bytes: new Uint8Array(volume.readFileSync("/output") as Buffer) };
}
it("dispatches latent entry creation and defaults through the SDK-backed CLI", async () => {
  const added = await execute(["styles", "latent", "add", "input.docx", "--name", "Harbor title", "--hidden", "null", "--priority", "99", "--output", "-"]);
  expect(added.exitCode).toBe(0); expect(added.stderr).toBe("");
  expect((await inspectDocumentStyles(added.bytes, {}, textContext)).latent?.entries).toMatchObject([{ name: "Harbor title", hidden: null, priority: 99 }]);
  const defaults = await execute(["styles", "latent", "defaults", "set", "input.docx", "--default-to-hidden", "false", "--load-count", "0", "--default-priority", "0", "--dry-run", "--json"]);
  expect(defaults.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(defaults.bytes))).toMatchObject({ operation: "styles.latent.defaults.set", ok: true, affected: 1, data: { changed: true, dryRun: true } });
});
it("publishes inherited font flags and paragraph tabs while keeping visibility separate", async () => {
  const edited = await execute(["styles", "set", "input.docx", "--name", "Harbor", "--hidden", "true", "--font-hidden", "false", "--all-caps", "true", "--keep-together", "false", "--tab-stop-add-json", '{"position":{"value":1,"unit":"in"}}', "--output", "-"]);
  expect(edited.exitCode, edited.stderr).toBe(0); expect(edited.stderr).toBe("");
  expect((await inspectDocumentStyles(edited.bytes, {}, textContext)).styles).toMatchObject([{ hidden: true, direct: { fontHidden: false, allCaps: true, keepTogether: false, tabStops: [{ position: 72 }] } }]);
});
it("normalizes tab insertion JSON and preserves negative deletion indices", () => {
  const parse = (...words: string[]) => parseDocxArguments(words.map(word => new TextEncoder().encode(word)));
  expect(parse("paragraphs", "set", "input.docx", "--paragraph", "1", "--tab-stop-add-json", '{"position":{"value":2,"unit":"cm"}}', "--dry-run").options).toMatchObject({ tabStopAdd: { position: { value: 2, unit: "cm" } } });
  expect(parse("paragraphs", "set", "input.docx", "--paragraph", "1", "--tab-stop-delete", "-1", "--dry-run").options).toMatchObject({ tabStopDelete: -1 });
});

it("prints structured default inspection with real layout line breaks", async () => {
  const result = await execute(["styles", "defaults", "get", "input.docx"]);
  const text = new TextDecoder().decode(result.bytes);
  expect(result.exitCode).toBe(0);
  expect(text).toContain('{\n  "run":');
  expect(text).not.toContain('\\u000a');
});
