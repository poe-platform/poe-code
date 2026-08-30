import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const assembly = JSON.parse(readFileSync(join(owned, "assembly.json")));
const { task, candidate, reconstructed } = assembly;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const environment = { PATH: "/usr/bin:/bin", HOME: join(task, "home"), TMPDIR: join(task, "tmp"), TMP: join(task, "tmp"), TEMP: join(task, "tmp"), LC_ALL: "C", TZ: "UTC", GIT_OPTIONAL_LOCKS: "0" };
const compiler = join(task, "node_modules/typescript/bin/tsc");
const result = spawnSync(process.execPath, [compiler, "-p", "tsconfig.build.json"], { cwd: reconstructed, env: environment, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
const build = { executable: process.execPath, args: [compiler, "-p", "tsconfig.build.json"], cwd: reconstructed, pid: result.pid, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
writeFileSync(join(owned, "build-result.json"), JSON.stringify(build, null, 2) + "\n", { flag: "wx" });
assert.equal(result.error, undefined);
assert.equal(result.status, 0, result.stderr + result.stdout);
assert.throws(() => process.kill(result.pid, 0), { code: "ESRCH" });

function inventory(root) {
  const files = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false, path);
      if (stat.isDirectory()) visit(path);
      else { assert.ok(stat.isFile()); files.push({ path: relative(root, path), bytes: stat.size, sha256: hash(readFileSync(path)) }); }
    }
  }
  visit(root);
  return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

for (const directory of ["src", "tests", "dist"]) assert.deepEqual(inventory(join(reconstructed, directory)), inventory(join(candidate, directory)), directory);
const consumer = join(task, "consumer/node_modules/virtual-bash");
for (const entry of assembly.candidateFiles.filter(entry => entry.path === "package.json" || entry.path.startsWith("dist/"))) {
  const bytes = readFileSync(join(candidate, entry.path));
  assert.equal(hash(bytes), entry.sha256);
  const path = join(consumer, entry.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: "wx" });
}
const typescript = (await import(pathToFileURL(join(task, "node_modules/typescript/lib/typescript.js")).href)).default;
const sourceRoots = ["index", "contracts/index", "contracts/output", "contracts/io", "commands/network/index", "shell/runtime"].map(name => join(consumer, "dist", name + ".d.ts"));
const program = typescript.createProgram(sourceRoots, {
  target: typescript.ScriptTarget.ES2023, module: typescript.ModuleKind.NodeNext,
  moduleResolution: typescript.ModuleResolutionKind.NodeNext, strict: true, noEmit: true,
  skipLibCheck: false, typeRoots: [join(task, "node_modules/@types")],
});
const diagnostics = typescript.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, typescript.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => task, getCanonicalFileName: name => name, getNewLine: () => "\n" }));
const checker = program.getTypeChecker();
const exports = sourceRoots.map(path => {
  const source = program.getSourceFile(path);
  const module = checker.getSymbolAtLocation(source);
  return { path: relative(consumer, path), symbols: checker.getExportsOfModule(module).map(symbol => {
    const target = symbol.flags & typescript.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return { name: symbol.getName(), runtime: Boolean(target.flags & typescript.SymbolFlags.Value), declarations: (target.declarations ?? []).map(declaration => relative(consumer, declaration.getSourceFile().fileName)) };
  }).sort((left, right) => left.name.localeCompare(right.name)) };
});
const rootExports = exports[0].symbols;
for (const name of ["createOutputOperation", "safeJsCommands", "createSafeJsCommands", "makeSafeJsFsModule", "makeSafeJsShellModule"]) assert.ok(rootExports.some(symbol => symbol.name === name && symbol.runtime), name);
assert.ok(rootExports.some(symbol => symbol.name === "OutputOperation" && !symbol.runtime));
assert.ok(rootExports.some(symbol => symbol.name === "ByteSink" && !symbol.runtime));
assert.equal(rootExports.some(symbol => symbol.name === "ExecutionBudget"), false);
const engine = join(task, "engine/src");
const engineEntries = ["run.ts", "interp/budget.ts", "modules/fs.ts", "interp/host-bridge.ts"];
const sourceClosure = new Map();
const externalImports = new Set();
function inspectEngine(name) {
  if (sourceClosure.has(name)) return;
  const path = join(engine, name);
  const bytes = readFileSync(path);
  sourceClosure.set(name, { path: "src/" + name, sha256: hash(bytes) });
  const source = typescript.createSourceFile(path, bytes.toString(), typescript.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!typescript.isImportDeclaration(statement) && !typescript.isExportDeclaration(statement)) continue;
    if (statement.isTypeOnly || statement.importClause?.isTypeOnly || !statement.moduleSpecifier || !typescript.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.startsWith(".")) {
      const dependency = join(dirname(path), specifier.endsWith(".js") ? specifier.slice(0, -3) + ".ts" : specifier);
      assert.ok(dependency.startsWith(engine + "/"));
      inspectEngine(relative(engine, dependency));
    } else externalImports.add(specifier);
  }
}
for (const name of engineEntries) inspectEngine(name);
function seal(root) {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (lstatSync(path).isDirectory()) seal(path);
    else chmodSync(path, 0o444);
  }
  chmodSync(root, 0o555);
}
seal(reconstructed);
seal(join(task, "consumer"));
chmodSync(join(task, "loader.mjs"), 0o444);
const proof = {
  at: new Date().toISOString(), task, publicBuild: { ...build, reaped: true },
  compiledFilesMatched: inventory(join(candidate, "dist")).length,
  consumer, consumerFiles: inventory(consumer), packageExports: JSON.parse(readFileSync(join(consumer, "package.json"))).exports,
  declarationDiagnostics: 0, exports,
  engine: { sourceEntries: engineEntries, staticImportClosure: [...sourceClosure.values()], externalImports: [...externalImports].sort(), qualification: "Static declared import graph, not runtime loaded graph; no engine import/build/test" },
  productExecuted: false, engineExecuted: false,
};
writeFileSync(join(owned, "build-proof.json"), JSON.stringify(proof, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ task, compiledFilesMatched: proof.compiledFilesMatched, declarationDiagnostics: 0, rootExports: rootExports.length, consumer, staticEngineImports: sourceClosure.size, externalImports: proof.engine.externalImports }));
