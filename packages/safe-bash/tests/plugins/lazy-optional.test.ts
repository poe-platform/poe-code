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
  shell.register(createCsvcutCommand());
  await shell.exec("true");
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
  const shell = new Shell({ fs }).use(agentCommands()).use(lazy.ssconvertCommands());
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
