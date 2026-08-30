import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = realpathSync(process.env.SURFACE_ROOT);
const engine = join(root, "engine/src/");
const installed = join(root, "consumer/node_modules/virtual-bash/dist/");
const binding = JSON.parse(readFileSync(join(root, "CURRENT-IMPORTS.json"), "utf8"));
assert.equal(binding.root, root);
const allowed = new Map(binding.files.map(entry => [entry.path, entry]));
const enginePaths = new Set(binding.allowedEnginePaths);
const loaded = new Set();
let compiler;

function locationFor(url) {
  if (url.startsWith("node:")) return;
  assert.ok(url.startsWith("file:"), `Forbidden import protocol: ${url}`);
  const filename = fileURLToPath(url);
  assert.ok(filename.startsWith(root + "/"), `Outside import: ${filename}`);
  assert.ok(!filename.startsWith(join(root, "product/")), "No archive-source fallback");
  return filename;
}
function filenameFor(url) {
  const filename = locationFor(url);
  if (!filename) return;
  assert.equal(lstatSync(filename).isSymbolicLink(), false, filename);
  assert.equal(realpathSync(filename), filename, `Symlink import: ${filename}`);
  assert.ok(allowed.has(relative(root, filename)), `Unknown current import: ${filename}`);
  return filename;
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("file:")) locationFor(specifier);
    if (specifier.startsWith("/")) locationFor(pathToFileURL(specifier).href);
    if (context.parentURL?.startsWith(pathToFileURL(engine).href) && specifier.startsWith(".") && specifier.endsWith(".js")) {
      const candidate = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      locationFor(candidate.href);
      if (existsSync(candidate)) specifier = candidate.href;
    }
    const result = nextResolve(specifier, context);
    filenameFor(result.url);
    return result;
  },
  load(url, context, nextLoad) {
    const filename = filenameFor(url);
    if (!filename) return nextLoad(url, context);
    const bytes = readFileSync(filename);
    const path = relative(root, filename);
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest, allowed.get(path).sha256, `Changed current import: ${path}`);
    if (filename.startsWith(engine)) assert.ok(enginePaths.has(path), `Unapproved private source closure: ${path}`);
    if (!loaded.has(filename)) {
      loaded.add(filename);
      appendFileSync(process.env.SURFACE_IMPORTS, JSON.stringify({ pid: process.pid, path, kind: filename.startsWith(engine) ? "actual-engine-source-copy" : filename.startsWith(installed) ? "packed-public-product" : "harness-or-copied-tool", sha256: digest, candidateCommit: binding.candidateCommit }) + "\n");
    }
    if (filename.startsWith(engine) && filename.endsWith(".ts")) {
      assert.ok(compiler, "TypeScript source loader is initialized before engine entry");
      const transformed = compiler.transpileModule(bytes.toString(), { fileName: filename, compilerOptions: { target: compiler.ScriptTarget.ES2023, module: compiler.ModuleKind.ESNext, verbatimModuleSyntax: true, sourceMap: false } });
      return { format: "module", source: transformed.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
compiler = (await import(pathToFileURL(join(root, "node_modules/typescript/lib/typescript.js")).href)).default;
