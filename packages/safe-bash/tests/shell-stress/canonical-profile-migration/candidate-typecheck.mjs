import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";

const owned = "tests/shell-stress/canonical-profile-migration";
const roots = ["tests/shell/invocation-discovery-fixes.test.ts", "tests/shell-stress/differential.test.ts", "tests/shell-stress/current-gaps/compatibility.test.ts", "tests/shell-stress/invocation-closure/holdout.test.ts", ...readdirSync(owned).filter(name => name.endsWith(".ts")).map(name => `${owned}/${name}`)];
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const options = { ...parsed.options, noEmit: true };
const host = ts.createCompilerHost(options);
const originalRead = host.readFile.bind(host);
const reads = {};
host.readFile = path => {
  const value = originalRead(path);
  if (value !== undefined) reads[relative(process.cwd(), path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
  return value;
};
const program = ts.createProgram(roots, options, host);
const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(diagnostic => ({ code: diagnostic.code, file: diagnostic.file ? relative(process.cwd(), diagnostic.file.fileName) : null, start: diagnostic.start, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n") }));
console.log(JSON.stringify({ roots, options, version: ts.version, diagnostics, reads }));
process.exitCode = diagnostics.length ? 1 : 0;
