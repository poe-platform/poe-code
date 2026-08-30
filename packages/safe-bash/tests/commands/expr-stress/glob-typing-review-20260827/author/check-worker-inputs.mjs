import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const configuration = ts.getParsedCommandLineOfConfigFile(resolve(root, "tsconfig.build.json"), {}, ts.sys);
assert.ok(configuration);
assert.deepEqual(configuration.errors, []);
const program = ts.createProgram([resolve(root, "src/commands/regex-execution/worker.ts")], configuration.options);
assert.deepEqual(ts.getPreEmitDiagnostics(program), []);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const emitted = [];
program.emit(undefined, (filename, content) => {
  if (!filename.endsWith(".js")) return;
  const existing = readFileSync(filename, "utf8");
  emitted.push({ file: relative(root, filename), expected: hash(content), actual: hash(existing), equal: content === existing });
});
const inputs = program.getSourceFiles().filter(source => !source.isDeclarationFile).map(source => ({ file: relative(root, source.fileName), sha256: hash(readFileSync(source.fileName)) }));
const result = { checkedAt: new Date().toISOString(), node: process.version, typescript: ts.version, config: hash(readFileSync(resolve(root, "tsconfig.build.json"))), inputs, emitted, writesToDist: 0, qualifier: "Worker TypeScript dependency closure emitted only in memory and compared with existing dist JavaScript. This authenticates worker runtime prerequisites, not a full build." };
writeFileSync(new URL("worker-inputs.json", import.meta.url), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
assert.ok(emitted.length > 0);
assert.ok(emitted.every(item => item.equal));
console.log(JSON.stringify({ inputs: inputs.length, verifiedJavaScriptFiles: emitted.length, allEqual: true }));
