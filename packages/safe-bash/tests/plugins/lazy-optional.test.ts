import { createCsvcutCommand } from "../../src/commands/csvcut/index.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as lazy from "../../src/lazy-optional.js";
import { Shell } from "../../src/shell/shell.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { agentCommands } from "../../src/plugins/index.js";

test("explicit command and family selection; full profile retains the optional inventory", () => {
  assert.deepEqual(lazy.createOptionalCommands(), []);
  assert.deepEqual(
    lazy
      .createOptionalCommands({ commands: ["ffprobe", "pdftotext"] })
      .map((command) => command.name),
    ["ffprobe", "pdftotext"]
  );
  assert.deepEqual(
    lazy.createOptionalCommands({ families: ["ffmpeg"] }).map((command) => command.name),
    ["ffmpeg", "ffprobe"]
  );
  assert.throws(
    () => lazy.createOptionalCommands({ commands: ["unknown"] }),
    /Unknown optional command/
  );
  assert.throws(
    () => lazy.createOptionalCommands({ families: ["unknown" as lazy.OptionalCommandFamily] }),
    /Unknown optional command family/
  );
  assert.deepEqual(
    lazy.createOptionalCommands({ profile: "full" }).map((command) => command.name),
    [
      "ffmpeg",
      "ffprobe",
      "git",
      "soffice",
      "libreoffice",
      "pandoc",
      "ssconvert",
      "pdfinfo",
      "pdfunite",
      "pdfseparate",
      "pdffonts",
      "pdfdetach",
      "pdftotext",
      "pdftohtml",
      "pdfimages",
      "pdftoppm",
      "pdftocairo",
      "pdftk",
      "qpdf",
      "qrencode",
      "sips",
      "magick",
      "convert",
      "mogrify",
      "composite",
      "montage",
      "identify",
      "compare",
      "wkhtmltopdf",
      "csvclean",
      "csvcut",
      "csvformat",
      "csvgrep",
      "csvjoin",
      "csvjson",
      "csvlook",
      "csvpy",
      "csvsort",
      "csvsql",
      "csvstack",
      "csvstat",
      "in2csv",
      "sql2csv",
      "gh"
    ]
  );
  const pair = lazy.createFfmpegCommands();
  assert.equal(pair.ffmpeg, pair[0]);
  assert.equal(pair.ffprobe, pair[1]);
});

test("full profile composes with agent commands and preserves fallback precedence", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  await shell.exec("true");
  shell.register(createCsvcutCommand(), { replace: true });
  const csvcut = shell.commands.get("csvcut");
  const gh = shell.commands.get("gh");
  shell.use(lazy.optionalCommands({ profile: "full" }));
  const results = await Promise.all([
    shell.exec("printf 'name,value\\na,2\\nb,1\\n' | csvsort -c value | csvcut -c name"),
    shell.exec("printf '# Title\\n' | pandoc -f markdown -t html"),
    shell.exec("ffprobe -version"),
    shell.exec("git --version")
  ]);
  assert.equal(shell.commands.get("csvcut"), csvcut);
  assert.ok(gh);
  assert.equal(shell.commands.get("gh"), gh);
  for (const result of results) assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(results[0]!.stdout, "name\nb\na\n");
  assert.match(results[1]!.stdout, /<h1[^>]*>Title<\/h1>/);
  await shell.dispose();
});

test("static discovery metadata stays compatible with the maintained command factories", async () => {
  const families = [
    "ffmpeg",
    "git",
    "soffice",
    "pandoc",
    "ssconvert",
    "pdfinfo",
    "pdftotext",
    "pdfimages",
    "pdftoppm",
    "pdftk",
    "qpdf",
    "qrencode",
    "sips",
    "imagemagick",
    "wkhtmltopdf",
    "csvkit",
    "gh"
  ] as const;
  const actualPluginNames = [];
  const expectedPluginNames = [];
  for (const family of families) {
    const module = (await import(`../../src/commands/${family}/index.js`)) as Record<
      string,
      (options?: object) => readonly import("../../src/contracts/command.js").CommandDefinition[]
    >;
    const factory = Object.entries(module).find(
      ([name]) => name.startsWith("create") && name.endsWith("Commands")
    )![1];
    const expected = factory!().map(({ name, description, fallback, filesystemRequirements }) => ({
      name,
      description,
      fallback,
      filesystemRequirements
    }));
    const actual = lazy
      .createOptionalCommands({ families: [family] })
      .map(({ name, description, fallback, filesystemRequirements }) => ({
        name,
        description,
        fallback,
        filesystemRequirements
      }));
    assert.deepEqual(actual, expected, family);
    const pluginName = `${family}Commands` as const;
    const originalPlugin = module[pluginName] as unknown as () => import("../../src/contracts/index.js").VirtualShellPlugin;
    actualPluginNames.push(lazy[pluginName]().name);
    expectedPluginNames.push(originalPlugin().name);
  }
  assert.deepEqual(actualPluginNames, expectedPluginNames);
});

test("default ssconvert keeps its existing CSV and XLSX formats", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec(
      "printf 'Name,Value\\nAda,2\\n' > /input.csv; ssconvert /input.csv /output.xlsx; ssconvert /output.xlsx /roundtrip.csv; cat /roundtrip.csv"
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Ada,2/);
  } finally {
    await shell.dispose();
  }
});

test("explicit ssconvert format selections do not install implicit default formats", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(
    lazy.ssconvertCommands({ formats: [] })
  );
  try {
    const result = await shell.exec("ssconvert --list-exporters");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(!result.stderr.includes("Gnumeric_Excel"));
    assert.ok(!result.stderr.includes("Gnumeric_stf:stf_csv"));
  } finally {
    await shell.dispose();
  }
});


test("lazy Pandoc factories reject invalid registration before execution", () => {
  for (const create of [lazy.createPandocCommand, lazy.createPandocCommands, lazy.pandocCommands]) {
    assert.throws(() => create({ jsonFilterCommand: "node --eval" }), TypeError);
    assert.throws(() => create({ citeproc: { style: 73 as unknown as string } }), TypeError);
    assert.throws(() => create({ jsonFilterCommand: "node", filters: { apply: async document => document } }), TypeError);
  }
});

test("lazy GitHub state persists per filesystem without leaking to another filesystem", async () => {
  const plugin = lazy.ghCommands();
  const filesystem = createMemoryFileSystem();
  const first = new Shell({ fs: filesystem }).use(plugin);
  const shared = new Shell({ fs: filesystem }).use(plugin);
  const second = new Shell({ fs: createMemoryFileSystem() }).use(plugin);
  try {
    const created = await first.exec("gh issue create -R octocat/demo -t retained -b body");
    assert.equal(created.exitCode, 0, created.stderr);
    const retained = await first.exec("gh issue list -R octocat/demo --json title");
    const sharedState = await shared.exec("gh issue list -R octocat/demo --json title");
    const isolated = await second.exec("gh issue list -R octocat/demo --json title");
    assert.equal(retained.exitCode, 0, retained.stderr);
    assert.equal(sharedState.exitCode, 0, sharedState.stderr);
    assert.equal(isolated.exitCode, 0, isolated.stderr);
    assert.deepEqual(JSON.parse(retained.stdout).map((issue: { title: string }) => issue.title), ["retained"]);
    assert.deepEqual(JSON.parse(sharedState.stdout), [{ title: "retained" }]);
    assert.deepEqual(JSON.parse(isolated.stdout), []);
  } finally {
    await Promise.all([first.dispose(), shared.dispose(), second.dispose()]);
  }
});

test("auxiliary public factories retain lazy registration and execute their own commands", async () => {
  const core = await import("../../src/core.js");
  const factories = [
    ["createConvertCommand", "convert"], ["createMogrifyCommand", "mogrify"],
    ["createCompositeCommand", "composite"], ["createMontageCommand", "montage"],
    ["createIdentifyCommand", "identify"], ["createCompareCommand", "compare"],
    ["createPdfuniteCommand", "pdfunite"], ["createPdfseparateCommand", "pdfseparate"],
    ["createPdffontsCommand", "pdffonts"], ["createPdfdetachCommand", "pdfdetach"],
    ["createPdftocairoCommand", "pdftocairo"], ["createLibreofficeCommand", "libreoffice"]
  ] as const;
  const directFactories = { ...await import("../../src/commands/imagemagick/index.js"), ...await import("../../src/commands/pdfinfo/index.js"), ...await import("../../src/commands/soffice/index.js") };
  const shell = new Shell({ fs: createMemoryFileSystem() });
  const direct = new Shell({ fs: createMemoryFileSystem() });
  try {
    for (const [factory, name] of factories) {
      assert.equal(typeof lazy[factory], "function", factory);
      assert.equal(core[factory], lazy[factory], factory);
      const command = lazy[factory]();
      assert.equal(command.name, name);
      shell.register(command);
      direct.register(directFactories[factory]());
      const result = await shell.exec(`${name} --help`);
      const expected = await direct.exec(`${name} --help`);
      assert.deepEqual(result, expected, name);
    }
  } finally { await Promise.all([shell.dispose(), direct.dispose()]); }
});

test("lazy format inspection accepts its standalone context", async () => {
  assert.equal(typeof lazy.createFormatInspectionCommand, "function");
  const core = await import("../../src/core.js");
  assert.equal(core.createFormatInspectionCommand, lazy.createFormatInspectionCommand);
  const chunks: Uint8Array[] = [];
  const command = lazy.createFormatInspectionCommand();
  const result = await command.execute({ args: ["--list-input-formats"], signal: new AbortController().signal,
    stdout: { async write(bytes) { chunks.push(bytes); } }, stderr: { async write() { assert.fail("unexpected stderr"); } } });
  assert.equal(result.exitCode, 0);
  assert.ok(new TextDecoder().decode(Buffer.concat(chunks)).includes("markdown"));
});

test("root mmdc registration preserves settings snapshots and its array-shaped plugin", async t => {
  const core = await import("../../src/core.js");
  const direct = await import("../../src/commands/mmdc/index.js");
  const mmdc = await import("../../src/lazy-mmdc.js");
  assert.equal(core.createMmdcCommand, mmdc.createMmdcCommand);
  assert.equal(core.createMmdcCommands, mmdc.createMmdcCommands);
  assert.equal(core.mmdcCommands, mmdc.mmdcCommands);
  for (const create of [core.createMmdcCommand, core.createMmdcCommands, core.mmdcCommands]) {
    assert.throws(() => create({ limits: { maxNodes: 0 } }), /maxNodes/);
  }

  const settings: { theme: { mode: "light" | "dark" }; limits: { maxNodes: number } } = {
    theme: { mode: "light" }, limits: { maxNodes: 5 }
  };
  const command = core.createMmdcCommand(settings);
  const family = core.createMmdcCommands(settings);
  const plugin = core.mmdcCommands(settings);
  assert.ok(Array.isArray(plugin));
  assert.ok(Object.isFrozen(plugin));
  assert.equal(plugin.length, 1);
  assert.equal(plugin.name, "mmdc-commands");
  assert.deepEqual(family.map(({ name }) => name), ["mmdc"]);

  const fs = createMemoryFileSystem();
  await fs.writeFile("/diagram.mmd", new TextEncoder().encode("flowchart LR\nA --> B"));
  const reference = new Shell({ fs }).register(direct.createMmdcCommand(settings));
  t.after(() => reference.dispose());
  const expected = await reference.exec("mmdc -i /diagram.mmd -o -");
  assert.equal(expected.exitCode, 0, expected.stderr);
  settings.theme.mode = "dark";
  settings.limits.maxNodes = 0;
  for (const definition of [command, family[0]!]) {
    const shell = new Shell({ fs }).register(definition);
    t.after(() => shell.dispose());
    assert.deepEqual(await shell.exec("mmdc -i /diagram.mmd -o -"), expected);
  }
  const shell = new Shell({ fs }).use(plugin);
  t.after(() => shell.dispose());
  assert.deepEqual(await shell.exec("mmdc -i /diagram.mmd -o -"), expected);
});
