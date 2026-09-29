import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const consumer = process.env.SAFE_BASH_LAZY_CONSUMER_ROOT;

test(`optional public profile executes under Node (${consumer ? "installed" : "source"})`, async (t) => {
  let entry = resolve(root, "packages/safe-bash/src/index.ts");
  if (consumer) {
    const directory = resolve(consumer, "node_modules/@poe-platform/safe-bash");
    assert.equal((await lstat(directory)).isSymbolicLink(), false);
    const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
    entry = resolve(directory, manifest.exports["."].import);
  }
  const importedAt = performance.now();
  const { Shell, createMemoryFileSystem, agentCommands, optionalCommands, optionalCommandCatalog } =
    await import(pathToFileURL(entry).href);
  const coldImportMs = performance.now() - importedAt;
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const setupAt = performance.now();
  const shell = new Shell({ fs, cwd: "/work", env: { MARK: "node" } })
    .use(agentCommands())
    .use(optionalCommands({ profile: "full" }));
  const setupMs = performance.now() - setupAt;
  try {
    assert.equal(optionalCommandCatalog.length, 42);
    const firstAt = performance.now();
    const results = await Promise.all([
      shell.exec("printf 'name,value\\na,2\\nb,1\\n' | csvsort -c value | csvcut -c name"),
      shell.exec("printf '<h1>Node PDF</h1>' | wkhtmltopdf - result.pdf; pdftotext result.pdf -"),
      shell.exec("printf '# Node document\\n' | pandoc -f markdown -t html"),
      shell.exec("ffprobe -version"),
      shell.exec("git --version")
    ]);
    const firstUseMs = performance.now() - firstAt;
    for (const result of results) assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(results[0].stdout, "name\nb\na\n");
    assert.match(results[1].stdout, /Node PDF/);
    assert.match(results[2].stdout, /Node document/);
    assert.ok((await fs.readFile("/work/result.pdf")).length > 0);
    const repeatAt = performance.now();
    const repeat = await shell.exec("printf 'name,value\\nc,3\\n' | csvsort -c value");
    const repeatUseMs = performance.now() - repeatAt;
    assert.equal(repeat.exitCode, 0, repeat.stderr);
    t.diagnostic(
      JSON.stringify({
        profile: consumer ? "installed" : "source",
        coldImportMs,
        setupMs,
        firstUseMs,
        repeatUseMs
      })
    );
  } finally {
    await shell.dispose();
  }
});
