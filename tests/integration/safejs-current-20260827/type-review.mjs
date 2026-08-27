import assert from "node:assert/strict";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const consumer = realpathSync(process.cwd());
const root = realpathSync(process.env.SAFEJS_REVIEW_ROOT);
const source = readFileSync(join(consumer, "consumer.ts"), "utf8");
writeFileSync(join(consumer, "baseline-types.ts"), source.slice(0, source.indexOf("const runtime:")));
const options = {
  noEmit: true, strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, types: ["node"],
};

function inspect(name) {
  const filename = join(consumer, name);
  const program = ts.createProgram([filename], options);
  const inputs = program.getSourceFiles().map(file => {
    const canonical = realpathSync(file.fileName);
    assert.ok(canonical.startsWith(`${root}/`), `External TypeScript input: ${canonical}`);
    return relative(root, canonical);
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic => ({
    file: diagnostic.file ? relative(consumer, diagnostic.file.fileName) : null,
    line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : null,
    code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }));
  return { inputs, diagnostics };
}

const baseline = inspect("baseline-types.ts");
const integration = inspect("consumer.ts");
const key = diagnostic => JSON.stringify(diagnostic);
const baselineKeys = new Set(baseline.diagnostics.map(key));
const introduced = integration.diagnostics.filter(diagnostic => !baselineKeys.has(key(diagnostic)));
const removed = baseline.diagnostics.filter(diagnostic => !integration.diagnostics.some(entry => key(entry) === key(diagnostic)));
process.stdout.write(`${JSON.stringify({ typescript: ts.version, baseline, integration, introduced, removed }, null, 2)}\n`);
if (introduced.length) process.exitCode = 1;
