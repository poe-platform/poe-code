import assert from "node:assert/strict";
import * as main from "@poe-platform/safe-bash";
import * as core from "@poe-platform/safe-bash/core";
import * as pandoc from "@poe-platform/safe-bash/commands/pandoc";
import { createCommandArguments } from "@poe-platform/safe-bash/contracts/command";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { FsError as FileSystemError } from "@poe-platform/safe-fs/core";

assert.throws(() => import.meta.resolve("safe-bash-command-pandoc"), { code: "ERR_MODULE_NOT_FOUND" });
assert.equal(FsError, FileSystemError);

for (const entry of [main, core]) {
  for (const name of ["createPandocCommand", "createPandocCommands", "pandocCommands"])
    assert.equal(entry[name], pandoc[name], name);
}
assert.deepEqual(pandoc.createPandocCommands().map(command => command.name), ["pandoc"]);
const bytes = new TextEncoder().encode("**Bold** and *italic* and ~~strikeout~~\n\n---\n\n| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n");
const fs = main.createMemoryFileSystem();
await fs.writeFile("/input.md", bytes);
const shell = new main.Shell({ fs });
try {
  assert.equal(shell.commands.has("pandoc"), false);
  shell.use(main.pandocCommands());
  const html = await shell.exec("pandoc -f markdown -t html /input.md");
  assert.equal(html.exitCode, 0, html.stderr);
  assert.ok(html.stdout.includes("<strong>Bold</strong>"));
  assert.throws(() => shell.commands.register(pandoc.createPandocCommand()), /already registered/);
  shell.use(main.pandocCommands({ replace: true }));
  shell.commands.register(main.createAgentCommands().find(command => command.name === "cat"));
  await fs.writeFile("/convert.sh", new TextEncoder().encode("cat /input.md | pandoc -f markdown -t html | cat"));
  const pipeline = await shell.exec("sh /convert.sh");
  assert.deepEqual([pipeline.exitCode, pipeline.stdout, pipeline.stderr], [0, html.stdout, ""]);
  // Invalid byte argv must not become a valid replacement-character filename.
  await fs.writeFile("/�", new TextEncoder().encode("must not be read"));
  for (const byte of ["377", "376"]) {
    const invalid = await shell.exec(`pandoc -f markdown -t plain $'/\\${byte}'`);
    assert.equal(invalid.exitCode, 2, invalid.stderr);
    assert.ok(invalid.stderr.includes("Arguments must be valid UTF-8"));
    assert.equal(invalid.stdout, "");
  }
  const missing = await shell.exec("pandoc -f markdown -t plain /missing.md");
  assert.equal(missing.exitCode, 9, missing.stderr);
  assert.ok(missing.stderr.includes("E_IO"));
  const reason = new Error("packed pandoc cancellation");
  const carrier = createCommandArguments(["-f", "markdown", "-t", "plain", "/input.md"]);
  await assert.rejects(pandoc.createPandocCommand().execute({
    command: "pandoc", args: carrier.args, argumentValues: carrier, cwd: "/", env: {}, fs,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write() { assert.fail("cancelled command wrote output"); } },
    stderr: { async write() { assert.fail("cancelled command wrote diagnostics"); } },
    signal: AbortSignal.abort(reason),
  }), error => error === reason);
  const pdf = await shell.exec("pandoc -f markdown -t pdf /input.md -o /output.pdf");
  assert.equal(pdf.exitCode, 0, pdf.stderr);
  assert.equal(new TextDecoder().decode((await fs.readFile("/output.pdf")).slice(0, 5)), "%PDF-");
  shell.use(main.ssconvertCommands({ codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" } }));
  await fs.writeFile("/table.csv", new TextEncoder().encode("Item name,Total\nGreen apples,7\n"));
  const spreadsheet = await shell.exec("ssconvert /table.csv /table.xlsx");
  assert.equal(spreadsheet.exitCode, 0, spreadsheet.stderr);
  const markdown = await shell.exec("pandoc -f xlsx -t markdown /table.xlsx");
  assert.equal(markdown.exitCode, 0, markdown.stderr);
  assert.ok(markdown.stdout.includes("Item name"));
  assert.ok(markdown.stdout.includes("Green apples"));
  assert.equal(markdown.stderr, "");
  shell.commands.register(pandoc.createPandocCommand({ limits: { outputBytes: 1 } }), { replace: true });
  const limited = await shell.exec("pandoc -f markdown -t html /input.md");
  assert.equal(limited.exitCode, 7, limited.stderr);
  assert.equal(limited.stdout, "");
} finally {
  await shell.dispose();
}
const converted = await pandoc.convert([{ bytes }], { from: "markdown", to: "gfm" }, { limits: { inputBytes: Infinity } });
assert.equal(converted.kind, "text");
assert.ok(converted.text.includes("**Bold**"));
assert.ok(pandoc.createFormatRegistry().list("write").includes("markdown"));
const lua = await pandoc.convert([{ bytes: new TextEncoder().encode("hello") }], {
  from: "markdown", to: "plain", filters: [{ kind: "lua", path: "uppercase.lua" }]
}, { filters: pandoc.createLuaFilterCapability({ readFile: async () => new TextEncoder().encode(
  "function Str(el) el.text = string.upper(el.text); return el end"
) }) });
assert.equal(lua.text, "HELLO\n");
