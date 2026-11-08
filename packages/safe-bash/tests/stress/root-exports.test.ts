import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as root from "../../src/index.js";
import * as core from "../../src/core.js";
import { posixPath } from "@poe-code/safe-fs/core";
import * as readonly from "../../src/fs/readonly/index.js";
import * as mount from "../../src/fs/mount/index.js";
import * as overlay from "../../src/fs/overlay/index.js";

test("root and core share the portable filesystem path API", () => {
  assert.equal(root.posixPath, posixPath);
  assert.equal(core.posixPath, posixPath);
  assert.equal(root.posixPath.join("/work", "..", "input.csv"), "/input.csv");
});

test("the public core subpath resolves to the core entry point", () => {
  assert.equal(import.meta.resolve("@poe-platform/safe-bash/core"), new URL("../../dist/core.js", import.meta.url).href);
});

for (const [pluginName, commandName] of [
  ["ffmpegCommands", "ffmpeg"], ["htmlqCommands", "htmlq"],
  ["csvcutCommands", "csvcut"], ["csvgrepCommands", "csvgrep"],
  ["pdfinfoCommands", "pdfinfo"], ["pdftotextCommands", "pdftotext"],
  ["pdfimagesCommands", "pdfimages"], ["pdftoppmCommands", "pdftoppm"],
  ["pdftkCommands", "pdftk"], ["qpdfCommands", "qpdf"],
  ["sipsCommands", "sips"], ["imagemagickCommands", "magick"],
  ["exiftoolCommands", "exiftool"], ["sofficeCommands", "soffice"],
  ["unrtfCommands", "unrtf"], ["wkhtmltopdfCommands", "wkhtmltopdf"],
  ["mmdcCommands", "mmdc"], ["diff3Commands", "diff3"],
  ["fmtCommands", "fmt"], ["foldCommands", "fold"],
] as const) {
  test(`root and core expose a usable ${pluginName} plugin`, async () => {
    const configure = core[pluginName];
    assert.equal(typeof configure, "function");
    assert.equal(root[pluginName], configure);
    const commands = new core.CommandRegistry();
    await configure().setup({ commands, use() {}, registerFileSystem() {} });
    assert.equal(typeof commands.get(commandName)?.execute, "function");
  });
}

test("root and core share media factories and the spreadsheet plugin", () => {
  for (const name of ["createFfmpegCommand", "createFfprobeCommand", "createFfmpegCommands", "createSsconvertCommand", "ssconvertCommands"] as const) {
    assert.equal(typeof core[name], "function", name);
    assert.equal(root[name], core[name], name);
  }
  assert.equal(core.createFfmpegCommand().name, "ffmpeg");
  assert.equal(core.createFfprobeCommand().name, "ffprobe");
});

test("root exposes delivered wrapper constructors and package subpaths", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  for (const [name, module] of Object.entries({ readonly, mount, overlay })) {
    for (const [symbol, value] of Object.entries(module)) {
      assert.equal(root[symbol as keyof typeof root], value);
    }
    assert.deepEqual(manifest.exports[`./fs/${name}`], {
      types: `./dist/fs/${name}/index.d.ts`,
      import: `./dist/fs/${name}/index.js`,
    });
  }
  assert.equal(manifest.name, "@poe-platform/safe-bash");
  assert.equal(manifest.private, true);
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.deepEqual(manifest.exports["./commands/xmllint"], manifest.exports["./commands/xml"]);
  assert.equal(root.createXmllintCommand().name, "xmllint");
  assert.equal(root.createXmllintCommands()[0]?.name, "xmllint");
  assert.equal(root.xmllintCommands().name, "xmllint-commands");
  for (const [name, version] of Object.entries({ "@noble/hashes": "2.4.0", pako: "3.0.1", "@poe-code/office-package": "*" }))
    assert.equal(manifest.devDependencies[name], version);
  assert.equal(root.createStructuredCommands()[0]?.name, "jq");
});

test("root wrapper factories preserve bytes and lower filesystem isolation", async () => {
  const bytes = new Uint8Array([0, 255, 10]);
  const lower = root.createMemoryFileSystem();
  await lower.writeFile("/lower", bytes);
  const readOnly = root.createReadOnlyFileSystem(lower);
  assert.deepEqual(await readOnly.readFile("/lower"), bytes);
  await assert.rejects(readOnly.writeFile("/denied", new Uint8Array()), { code: "EROFS" });
  const mounted = root.createMountFileSystem({ root: root.createMemoryFileSystem(), mounts: { "/mounted": readOnly } });
  assert.deepEqual(await mounted.readFile("/mounted/lower"), bytes);
  const merged = root.createOverlayFileSystem({ upper: root.createMemoryFileSystem(), lower });
  try {
    assert.deepEqual(await merged.readFile("/lower"), bytes);
    await merged.writeFile("/lower", new Uint8Array([1]));
    assert.deepEqual(await lower.readFile("/lower"), bytes);
    assert.deepEqual(await merged.readFile("/lower"), new Uint8Array([1]));
  } finally {
    await merged.cleanup();
  }
});

test("root exposes delivered search, byte, and diff/patch plugins with their definitions", async () => {
  const commands = new root.CommandRegistry();
  const host: root.PluginHost = { commands, use() {}, registerFileSystem() {} };
  for (const plugin of [root.searchCommands(), root.byteCommands(), root.diffPatchCommands()]) await plugin.setup(host);
  const definitions = [...root.createSearchCommands(), ...root.createByteCommands(), ...root.createDiffPatchCommands()];
  assert.deepEqual(commands.list().map(command => command.name), definitions.map(command => command.name));
  for (const name of ["rg", "base64", "diff", "patch"]) assert.equal(typeof commands.get(name)?.execute, "function");
});
