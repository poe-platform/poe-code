import assert from "node:assert/strict";
import test from "node:test";

const names = ["csvcut", "csvgrep", "csvkit", "diff3", "exiftool", "fmt", "fold", "htmlq", "imagemagick", "mmdc", "op", "pandoc", "pdfimages", "pdfinfo", "pdftk", "pdftoppm", "pdftotext", "qpdf", "sips", "soffice", "ssconvert", "unrtf", "wkhtmltopdf", "xmllint", "xz"];
for (const name of names) {
  test(`${name} package exposes command, list and plugin factories`, async () => {
    const entry = await import(`safe-bash-command-${name}`);
    const title = name[0]!.toUpperCase() + name.slice(1);
    for (const symbol of [`create${title}Command`, `create${title}Commands`, `${name}Commands`])
      assert.equal(typeof entry[symbol], "function", symbol);
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

test("public shell executes the Mike profile and numeric XPath predicates", async () => {
  const { Shell, mikeYqCommands, xmllintCommands } = await import("../../src/core.js");
  const { createMemoryFileSystem } = await import("../../src/fs/memory/index.js");
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(mikeYqCommands()).use(xmllintCommands());
  try {
    const yaml = await shell.exec("yq -n -o=json '.name = \"Alpha\"'");
    assert.equal(yaml.exitCode, 0, yaml.stderr);
    assert.deepEqual(JSON.parse(yaml.stdout), { name: "Alpha" });
    const xml = await shell.exec(`xmllint --xpath '//item[@price > 15]/text()' - <<'XML'
<root><item price="10">Alpha</item><item price="20">Beta</item></root>
XML`);
    assert.equal(xml.exitCode, 0, xml.stderr);
    assert.equal(xml.stdout, "Beta\n");
  } finally {
    await shell.dispose();
  }
});

test("public mmdc factories validate options and retain the array plugin contract", async () => {
  const { Shell, createMmdcCommand, createMmdcCommands, mmdcCommands } = await import("../../src/core.js");
  const { createMemoryFileSystem } = await import("../../src/fs/memory/index.js");
  assert.throws(() => createMmdcCommand({ limits: { maxSourceBytes: -1 } }));
  assert.equal(createMmdcCommands()[0]?.name, "mmdc");
  const settings = { replace: true };
  const plugin = mmdcCommands(settings);
  settings.replace = false;
  assert.ok(Array.isArray(plugin));
  assert.ok(Object.isFrozen(plugin));
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(mmdcCommands()).use(plugin);
  try {
    const result = await shell.exec("mmdc --help");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("mmdc"));
  } finally {
    await shell.dispose();
  }
});
