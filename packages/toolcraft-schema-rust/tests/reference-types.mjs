import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const source = fileURLToPath(new URL("../../toolcraft-schema/src/", import.meta.url));
const entry = fileURLToPath(new URL("../dist/index.d.ts", import.meta.url));
const fixtures = readdirSync(source)
  .filter((name) => name.endsWith(".compile-check.ts"))
  .map((name) => source + name);
assert.ok(fixtures.length > 0, "original compile-check fixtures must be available");
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  types: [],
  noEmit: true,
  skipLibCheck: false
};
const host = ts.createCompilerHost(options);
host.resolveModuleNames = (names, containingFile) =>
  names.map((name) => {
    if (fixtures.includes(containingFile) && name === "./index.js") {
      return { resolvedFileName: entry, extension: ts.Extension.Dts };
    }
    return ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
  });
const program = ts.createProgram(fixtures, options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  process.stderr.write(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n"
    })
  );
  process.exitCode = 1;
} else {
  const originalRoot = fileURLToPath(new URL("../../toolcraft-schema/", import.meta.url));
  for (const file of program.getSourceFiles()) {
    assert.ok(
      !file.fileName.startsWith(originalRoot) || fixtures.includes(file.fileName),
      `native declarations must be standalone: ${file.fileName}`
    );
  }
  process.stdout.write(
    `Native declarations passed ${fixtures.length} original compile-check fixtures\n`
  );
}
