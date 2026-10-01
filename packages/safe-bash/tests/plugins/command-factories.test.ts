import assert from "node:assert/strict";
import test from "node:test";

const names = ["cmp", "install", "truncate", "docx", "pptx", "xan", "shuf", "dd", "yes", "csvcut", "csvgrep", "csvkit", "diff3", "exiftool", "fmt", "fold", "htmlq", "imagemagick", "mmdc", "op", "pandoc", "pdfimages", "pdfinfo", "pdftk", "pdftoppm", "pdftotext", "qpdf", "sips", "soffice", "ssconvert", "unrtf", "wkhtmltopdf", "xmllint", "xz"];
test("core exposes zero-argument command, collection and plugin factories", async () => {
  const core: Record<string, unknown> = await import("../../src/core.js");
  for (const name of [...names, "ffmpeg"]) {
    const title = name[0]!.toUpperCase() + name.slice(1);
    for (const symbol of [`create${title}Command`, `create${title}Commands`, `${name}Commands`]) {
      assert.equal(typeof core[symbol], "function", symbol);
      assert.ok((core[symbol] as () => unknown)(), symbol);
    }
  }
});

test("public entry exposes every extracted command factory", async () => {
  const entry: Record<string, unknown> = await import("../../src/index.js");
  for (const name of names) {
    const title = name[0]!.toUpperCase() + name.slice(1);
    for (const symbol of [`create${title}Command`, `create${title}Commands`, `${name}Commands`])
      assert.equal(typeof entry[symbol], "function", symbol);
  }
});

test("spreadsheet plugins execute with omitted and empty options", async () => {
  const { Shell, csvkitCommands, ssconvertCommands } = await import("../../src/core.js");
  const { createMemoryFileSystem } = await import("../../src/fs/memory/index.js");
  for (const options of [undefined, {}]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/sales.csv", new TextEncoder().encode("name,total\nAlice,12.5\n"));
    const shell = new Shell({ fs }).use(csvkitCommands(options)).use(ssconvertCommands(options));
    try {
      for (const command of ["csvcut -c name /sales.csv", "ssconvert /sales.csv /sales.xlsx", "ssconvert /sales.xlsx /roundtrip.csv"]) {
        const result = await shell.exec(command);
        assert.equal(result.exitCode, 0, result.stderr);
        if (command.startsWith("csvcut")) assert.equal(result.stdout, "name\nAlice\n");
      }
      assert.equal(new TextDecoder().decode(await fs.readFile("/roundtrip.csv")), "name,total\nAlice,12.5\n");
    } finally { await shell.dispose(); }
  }
});
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


test("default public yq accepts attached YAML and TOML format flags", async () => {
  const { Shell, yqCommands } = await import("../../src/core.js");
  const { createMemoryFileSystem } = await import("../../src/fs/memory/index.js");
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(yqCommands());
  try {
    for (const [format, input] of [["yaml", "name: Alpha\n"], ["toml", 'name = "Alpha"\n']] as const) {
      const result = await shell.exec(`yq -p=${format} -o=json .`, { stdin: input });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { name: "Alpha" });
    }
  } finally { await shell.dispose(); }
});
