import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";

const root = process.cwd();
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const roots = ["tests/shell/invocation-modes.test.ts", "tests/shell/unsupported-options.test.ts", "tests/shell/script-entrypoint.test.ts"];
const options = { ...parsed.options, noEmit: true };
const host = ts.createCompilerHost(options);
const reads = {};
const originalRead = host.readFile.bind(host);
host.readFile = path => {
  const text = originalRead(path);
  if (text !== undefined) reads[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
  return text;
};
const program = ts.createProgram(roots, options, host);
const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(diagnostic => ({
  code: diagnostic.code,
  category: ts.DiagnosticCategory[diagnostic.category],
  file: diagnostic.file ? relative(root, diagnostic.file.fileName) : null,
  position: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : null,
  message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
}));
console.log(JSON.stringify({ roots, options, typescriptVersion: ts.version, reads, diagnostics }));
process.exitCode = diagnostics.length ? 1 : 0;
