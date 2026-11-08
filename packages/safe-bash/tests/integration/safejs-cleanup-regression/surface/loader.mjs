import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = realpathSync(process.env.SURFACE_ROOT);
const engine = join(root, "engine/src/");
const installed = join(root, "consumer/node_modules/virtual-bash/dist/");
const loaded = new Set();
let compiler;

function filenameFor(url) {
  if (url.startsWith("node:")) return;
  assert.ok(url.startsWith("file:"), `Forbidden import protocol: ${url}`);
  const filename = fileURLToPath(url);
  assert.equal(lstatSync(filename).isSymbolicLink(), false, filename);
  assert.equal(realpathSync(filename), filename, `Symlink import: ${filename}`);
  assert.ok(filename.startsWith(root + "/"), `Outside import: ${filename}`);
  assert.ok(!filename.startsWith(join(root, "product/")), "No archive-source fallback");
  return filename;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(pathToFileURL(engine).href) && specifier.startsWith(".") && specifier.endsWith(".js")) {
      const candidate = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
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
    if (!loaded.has(filename)) {
      loaded.add(filename);
      appendFileSync(process.env.SURFACE_IMPORTS, JSON.stringify({
        pid: process.pid, path: relative(root, filename),
        kind: filename.startsWith(engine) ? "actual-engine-source-copy" : filename.startsWith(installed) ? "packed-public-product" : "harness-or-copied-tool",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }) + "\n");
    }
    if (filename.startsWith(engine) && filename.endsWith(".ts")) {
      assert.ok(compiler, "TypeScript source loader is initialized before engine entry");
      const transformed = compiler.transpileModule(bytes.toString(), {
        fileName: filename,
        compilerOptions: { target: compiler.ScriptTarget.ES2023, module: compiler.ModuleKind.ESNext, verbatimModuleSyntax: true, sourceMap: false },
      });
      return { format: "module", source: transformed.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

compiler = (await import(pathToFileURL(join(root, "node_modules/typescript/lib/typescript.js")).href)).default;
