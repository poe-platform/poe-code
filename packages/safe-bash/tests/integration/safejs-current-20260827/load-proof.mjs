import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const isolatedRoot = realpathSync(process.env.SAFEJS_REVIEW_ROOT);
const consumer = join(isolatedRoot, "consumer");
const engineRoot = join(consumer, "packages/safejs/src/");
const productRoot = join(consumer, "node_modules/virtual-bash/dist/");
const copiedSourcePrefix = `${consumer}/src/`;
const loaded = new Set();
const emit = value => appendFileSync(process.env.SAFEJS_REVIEW_PROOF, `${JSON.stringify({ pid: process.pid, ...value })}\n`);

function check(url) {
  if (url.startsWith("node:")) return;
  assert.ok(url.startsWith("file:"), `Unexpected import protocol: ${url}`);
  const filename = realpathSync(fileURLToPath(url));
  const local = relative(isolatedRoot, filename);
  if (isAbsolute(local) || local === ".." || local.startsWith("../")) {
    emit({ rejectedOutside: filename });
    throw Object.assign(new Error(`Forbidden outside import: ${filename}`), { code: "SAFEJS_REVIEW_OUTSIDE" });
  }
  assert.ok(!filename.startsWith(join(isolatedRoot, "product/src/")), "Product source fallback");
  if (filename.includes("/packages/safejs/src/")) assert.ok(filename.startsWith(engineRoot), "Wrong engine copy");
  return filename;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let candidate;
    if (specifier.startsWith(".") || specifier.startsWith("file:")) candidate = new URL(specifier, context.parentURL).href;
    if (candidate?.startsWith("file:")) {
      const filename = fileURLToPath(candidate);
      if (filename.startsWith(copiedSourcePrefix)) {
        const local = filename.slice(copiedSourcePrefix.length).replace(/\.ts$/u, ".js");
        const target = local.endsWith("/index.js") ? join(productRoot, "index.js") : join(productRoot, local);
        emit({ redirectedFixtureImport: local, packedTarget: relative(isolatedRoot, target) });
        specifier = local.endsWith("/index.js") ? "virtual-bash" : pathToFileURL(target).href;
      }
    }
    const result = nextResolve(specifier, context);
    check(result.url);
    return result;
  },
  load(url, context, nextLoad) {
    const filename = check(url);
    if (filename && !loaded.has(filename)) {
      loaded.add(filename);
      emit({ loaded: relative(isolatedRoot, filename),
        kind: filename.startsWith(engineRoot) ? "actual-engine-copy" : filename.startsWith(productRoot) ? "packed-product" : "fixture-or-tooling",
        sha256: createHash("sha256").update(readFileSync(filename)).digest("hex") });
    }
    if (filename === join(isolatedRoot, "node_modules/typescript/lib/typescript.js")) {
      return { format: "commonjs", source: readFileSync(filename), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
