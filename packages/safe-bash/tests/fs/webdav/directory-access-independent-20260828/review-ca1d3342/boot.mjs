import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { registerHooks, isBuiltin } from "node:module";

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const typescript = config.layout === "source" ? (await import(pathToFileURL(config.compiler).href)).default : undefined;
const trace = { layout: config.layout, loaded: [], rejected: [], networkAttempts: 0 };
const fail = (code, filename) => {
  trace.rejected.push({ code, filename });
  throw Object.assign(new Error(`${code}: ${filename}`), { code });
};
const manifest = JSON.parse(fs.readFileSync(path.join(config.productRoot, "package.json"), "utf8"));
function checked(filename) {
  if (!Object.hasOwn(config.allowedFiles, filename)) fail("REVIEW_OUTSIDE_BOUNDARY", filename);
  if (!fs.existsSync(filename)) fail("REVIEW_MISSING_ARTIFACT", filename);
  if (!fs.lstatSync(filename).isFile() || fs.realpathSync(filename) !== filename) fail("REVIEW_NOT_REGULAR", filename);
  return filename;
}
globalThis.fetch = () => { trace.networkAttempts++; throw new Error("REVIEW_NETWORK_FORBIDDEN"); };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (isBuiltin(specifier)) return nextResolve(specifier, context);
    let filename;
    if (specifier === "virtual-bash" || specifier.startsWith("virtual-bash/")) {
      const key = specifier === "virtual-bash" ? "." : `.${specifier.slice("virtual-bash".length)}`;
      const entry = manifest.exports[key]?.import;
      if (!entry) fail("REVIEW_UNDECLARED_EXPORT", specifier);
      filename = path.resolve(config.productRoot, config.layout === "source" ? entry.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts") : entry);
      checked(filename);
      if (config.layout !== "source") {
        const actual = nextResolve(specifier, context);
        if (fileURLToPath(actual.url) !== filename) fail("REVIEW_PACKAGE_RESOLUTION_MISMATCH", actual.url);
      }
    } else if (specifier.startsWith("file:")) filename = fileURLToPath(specifier);
    else if (specifier.startsWith(".")) {
      filename = fileURLToPath(new URL(specifier, context.parentURL));
      if (config.layout === "source" && filename.startsWith(`${config.productRoot}/src/`) && filename.endsWith(".js")) filename = filename.slice(0, -3) + ".ts";
    } else fail("REVIEW_UNDECLARED_IMPORT", specifier);
    return { url: pathToFileURL(checked(filename)).href, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (isBuiltin(url)) return nextLoad(url, context);
    const filename = checked(fileURLToPath(url));
    const bytes = fs.readFileSync(filename);
    const actual = hash(bytes);
    if (actual !== config.allowedFiles[filename]) fail("REVIEW_ARTIFACT_HASH_MISMATCH", filename);
    let source = bytes.toString();
    if (filename.endsWith(".ts")) {
      if (!typescript) fail("REVIEW_SOURCE_FALLBACK", filename);
      source = typescript.transpileModule(source, { fileName: filename, compilerOptions: {
        module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2023,
        verbatimModuleSyntax: true, sourceMap: false,
      } }).outputText;
    }
    trace.loaded.push({ filename, sha256: actual, transformedSha256: hash(source), product: filename.startsWith(`${config.productRoot}/`) });
    return { format: "module", source, shortCircuit: true };
  },
});
try {
  if (config.control) {
    let observed;
    try { await import(config.control.specifier); }
    catch (error) { observed = error.code; }
    if (observed !== config.control.expected) throw new Error(`load control expected ${config.control.expected}; got ${observed}`);
    fs.writeFileSync(config.result, JSON.stringify({ kind: "load-admission-control-not-mutant-kill", observed, expected: config.control.expected }));
  } else {
    const runner = await import(pathToFileURL(config.runner).href);
    await runner.run(config);
  }
} finally {
  fs.writeFileSync(config.loadLog, JSON.stringify(trace));
}
