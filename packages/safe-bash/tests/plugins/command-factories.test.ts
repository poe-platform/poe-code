import assert from "node:assert/strict";
import test from "node:test";

const names = ["csvcut", "csvgrep", "csvkit", "diff3", "exiftool", "fmt", "fold", "htmlq", "imagemagick", "mmdc", "op", "pandoc", "pdfimages", "pdfinfo", "pdftk", "pdftoppm", "pdftotext", "qpdf", "sips", "soffice", "ssconvert", "unrtf", "wkhtmltopdf", "xmllint", "xz"];
for (const name of names) {
  test(`${name} package exposes command, list and plugin factories`, async () => {
    const entry = await import(`safe-bash-command-${name}`);
    const title = name[0]!.toUpperCase() + name.slice(1);
    for (const symbol of [`create${title}Command`, `create${title}Commands`, `${name}Commands`])
      assert.equal(typeof entry[symbol], "function", symbol);
    if (name !== "op") {
      const single = entry[`create${title}Command`]();
      const list = entry[`create${title}Commands`]();
      assert.equal(typeof single.execute, "function");
      assert.ok(list.some((definition: { name: string }) => definition.name === single.name));
      assert.equal(new Set(list.map((definition: { name: string }) => definition.name)).size, list.length);
      const registered: string[] = [];
      await entry[`${name}Commands`]().setup({ commands: {
        has: () => false,
        register: (definition: { name: string }) => registered.push(definition.name)
      } });
      assert.deepEqual(registered, list.map((definition: { name: string }) => definition.name));
    }
  });
}
test("Mike yq profile is available from the safe-bash adapter", async () => {
  const entry = await import("../../src/commands/yq/index.js");
  for (const symbol of ["createMikeYqCommand", "createMikeYqCommands", "mikeYqCommands"] as const)
    assert.equal(typeof entry[symbol], "function", symbol);
});

test("Mike yq profile is exported by public core", async () => {
  const core = await import("../../src/core.js");
  assert.equal(core.createMikeYqCommand().name, "yq");
  assert.equal(core.createMikeYqCommands()[0]?.name, "yq");
  assert.equal(core.mikeYqCommands().name, "mike-yq-commands");
});
