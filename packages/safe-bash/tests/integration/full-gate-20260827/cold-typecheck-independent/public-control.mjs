import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const consumer = realpathSync(process.cwd());
const packageRoot = realpathSync(join(consumer, "node_modules/virtual-bash"));
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json")));
const loadedPaths = new Set();
const guard = registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.startsWith("node:")) return result;
    assert.ok(result.url.startsWith("file:"));
    const filename = realpathSync(fileURLToPath(result.url));
    if (!filename.startsWith(packageRoot + "/dist/") || filename.endsWith(".ts")) {
      throw Object.assign(new Error("Outside packed JavaScript declarations consumer"), { code: "INDEPENDENT_OUTSIDE_PACK" });
    }
    loadedPaths.add(relative(packageRoot, filename));
    return result;
  },
});
const imports = [];
const pipelines = [];
try {
  for (const [key, target] of Object.entries(manifest.exports)) {
    const pattern = typeof target === "string" ? target : target.import;
    const exposed = key.includes("*")
      ? readdirSync(join(packageRoot, dirname(pattern))).filter(name => name.endsWith(".js")).sort().map(name => key.replace("*", name.slice(0, -3)))
      : [key];
    for (const name of exposed) {
      const specifier = name === "." ? "virtual-bash" : "virtual-bash/" + name.slice(2);
      const filename = realpathSync(fileURLToPath(import.meta.resolve(specifier)));
      assert.ok(filename.startsWith(packageRoot + "/dist/"));
      const exports = Object.keys(await import(specifier)).sort();
      imports.push({ specifier, path: relative(packageRoot, filename), exports, sha256: createHash("sha256").update(readFileSync(filename)).digest("hex") });
    }
  }
  assert.equal(imports.length, 20);
  assert.equal(new Set(imports.map(row => row.specifier)).size, 20);
  assert.deepEqual(manifest.dependencies ?? {}, {});
  const api = await import("virtual-bash");
  const subpath = await import("virtual-bash/commands/stream-inspection");
  assert.equal(api.createStreamInspectionCommands, subpath.createStreamInspectionCommands);
  assert.equal(api.streamInspectionCommands, subpath.streamInspectionCommands);
  const registry = new api.CommandRegistry();
  api.agentCommands().setup({ commands: registry, use() { assert.fail("Unexpected middleware"); }, registerFileSystem() { assert.fail("Unexpected adapter registration"); } });
  const names = registry.list().map(command => {
    assert.equal(typeof command.execute, "function");
    return command.name;
  }).sort();
  assert.equal(names.length, 60);
  assert.equal(new Set(names).size, 60);
  assert.deepEqual(api.createAgentCommands().map(command => command.name).sort(), names);
  assert.ok(!names.includes("curl") && !names.includes("safejs"));
  const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
  try {
    for (const [source, expected] of [
      ["printf 'a\\nb\\n' | tac", "b\na\n"],
      ["printf 'a\\tb\\n' | expand", "a       b\n"],
      ["printf 'abcdef\\n' | fold -w 3", "abc\ndef\n"],
      ["printf 'abc\\000de\\000fghi' | strings -n 3", "abc\nfghi\n"],
    ]) {
      const result = await shell.exec(source, { signal: AbortSignal.timeout(10000) });
      const actual = { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") };
      assert.equal(actual.exitCode, 0);
      assert.equal(actual.stdout, expected);
      assert.equal(actual.stdoutHex, Buffer.from(expected).toString("hex"));
      assert.equal(actual.stderr, "");
      assert.equal(actual.stderrHex, "");
      pipelines.push({ source, expected, actual });
    }
  } finally { await shell.dispose(); }
  await assert.rejects(import(pathToFileURL(process.argv[2]).href), { code: "INDEPENDENT_OUTSIDE_PACK" });
  console.log(JSON.stringify({ imports, names, registered: names.length, pipelines, outsideSourceRejected: true, loadedPaths: [...loadedPaths].sort(), scope: "Imports/registry/four virtual pipelines only; no network, provider, authentication or native tool acceptance" }, null, 2));
} finally { guard.deregister(); }
