import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

type ErrorConstructor = new (message?: string, options?: ErrorOptions) => Error & { readonly code: string };
const exported = api as unknown as Record<string, ErrorConstructor>;
const encode = (text: string) => new TextEncoder().encode(text);

it("exports a neutral document error with standard message and cause values", () => {
  expect(exported.DocumentError).toBeTypeOf("function");
  const cause = { original: true };
  const empty = new exported.DocumentError!();
  const error = new exported.DocumentError!("Original failure", { cause });
  expect(empty).toBeInstanceOf(Error);
  expect(empty.message).toBe("");
  expect(empty.code).toBe("invalid-package");
  expect(error.message).toBe("Original failure");
  expect(error.cause).toBe(cause);
  expect(error.code).toBe("invalid-package");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const fault of ["container", "xml", "package", "profile"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} preserves neutral ${fault} error classification; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Original note</w:t></w:r></w:p>', {}, strict));
  let types = new TextDecoder().decode(parts.get("[Content_Types].xml")!);
  if (kind === "dotx") types = types.replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml");
  if (fault === "profile") types = types.replace(kind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" : "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml", "application/vnd.ms-word.document.macroEnabled.main+xml");
  parts.set("[Content_Types].xml", encode(types));
  if (fault === "xml") parts.set("word/document.xml", encode("<document><broken></document>"));
  if (fault === "package") parts.set("_rels/.rels", encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
  const memory = Volume.fromJSON({ "/input": "", "/sentinel": "Retained output" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = fault === "container" ? encode("Original invalid archive") : new Uint8Array(memory.readFileSync("/input") as Buffer);
  memory.writeFileSync("/input", input);
  const code = { container: "invalid-container", xml: "invalid-xml", package: "invalid-package", profile: "unsupported-profile" }[fault];
  const concrete = { container: api.InvalidContainerError, xml: api.InvalidXmlError, package: api.InvalidPackageError, profile: api.UnsupportedProfileError }[fault];
  if (route === "shell") {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", input); await fs.writeFile("/sentinel", encode("Retained output"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx inspect /input --json");
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ version: 1, operation: "inspect", ok: false, data: null, affected: 0, errors: [{ code }], locations: [] });
      expect(result.stderr).not.toContain("Original note");
      expect(await fs.readFile("/input")).toEqual(input);
      expect(await fs.readFile("/sentinel")).toEqual(encode("Retained output"));
    } finally { await shell.dispose(); }
  } else {
    let failure: unknown;
    try { await (route === "model" ? api.Document(input, textContext) : api.inspectDocument(input, textContext)); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(concrete);
    expect(failure).toMatchObject({ code });
    expect(exported.DocumentError).toBeTypeOf("function");
    expect(failure).toBeInstanceOf(exported.DocumentError!);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  expect(memory.readFileSync("/sentinel", "utf8")).toBe("Retained output");
});
