import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const path = value => fileURLToPath(new URL(value, import.meta.url));
const fixture = path("../../toolcraft/src/cli.compile-check.ts");
const entries = new Map([
  ["./cli.js", path("../dist/cli.d.ts")],
  ["./index.js", path("../dist/index.d.ts")],
  ["toolcraft-schema", path("../../toolcraft-schema-rust/dist/index.d.ts")]
]);
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  types: ["node"],
  noEmit: true,
  // Native declarations still reference the original public contract types.
  // This checks the original consumer; standalone declarations remain a gate.
  skipLibCheck: true
};
const host = ts.createCompilerHost(options);
const redirected = new Set();
host.resolveModuleNames = (names, containingFile) => names.map(name => {
  if (containingFile === fixture && entries.has(name)) {
    redirected.add(name);
    return { resolvedFileName: entries.get(name), extension: ts.Extension.Dts };
  }
  return ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
});
const program = ts.createProgram([fixture], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.deepEqual(redirected, new Set(entries.keys()));
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n"
  }));
  process.exitCode = 1;
} else {
  process.stdout.write("Native CLI declarations passed the original CLI compile-check consumer\n");
}
