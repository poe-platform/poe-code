import assert from "node:assert/strict";
import * as main from "@poe-platform/safe-bash";
import * as core from "@poe-platform/safe-bash/core";
import * as pandoc from "@poe-platform/safe-bash/commands/pandoc";

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
  const pdf = await shell.exec("pandoc -f markdown -t pdf /input.md -o /output.pdf");
  assert.equal(pdf.exitCode, 0, pdf.stderr);
  assert.equal(new TextDecoder().decode((await fs.readFile("/output.pdf")).slice(0, 5)), "%PDF-");
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
