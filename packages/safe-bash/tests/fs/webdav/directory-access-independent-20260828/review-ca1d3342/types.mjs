import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ts = (await import(pathToFileURL(config.compiler).href)).default;
const filename = path.join(path.dirname(config.runner), "typed-inputs.ts");
const original = fs.readFileSync(filename, "utf8");
const lines = original.split("\n");
const negativeLines = lines.map((line, index) => line.includes("Assert<Not<Fits<") ? index : -1).filter(index => index >= 0);
assert.equal(negativeLines.length, 10);
const options = {
  strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true, skipLibCheck: true, types: ["node"], typeRoots: [path.join(config.tools, "node_modules/@types")],
  ...(config.layout === "source" ? { baseUrl: path.dirname(filename), paths: { "virtual-bash": [path.join(config.productRoot, "src/index.ts")] } } : {}),
};
const checked = new Map();
function compile(input) {
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  host.readFile = name => {
    const permitted = name.startsWith(`${config.tools}/`) || name.startsWith(`${config.productRoot}/`) || name.startsWith(`${path.dirname(filename)}/`);
    assert.ok(permitted, `type source fallback refused: ${name}`);
    const text = name === filename ? input : originalRead(name);
    if (text !== undefined && name !== filename) {
      const sha256 = createHash("sha256").update(text).digest("hex");
      if (name.startsWith(`${config.productRoot}/`)) assert.equal(sha256, config.allowedFiles[name], `declaration binding mismatch: ${name}`);
      checked.set(name, sha256);
    }
    return text;
  };
  host.getSourceFile = (name, version) => { const text = host.readFile(name); return text === undefined ? undefined : ts.createSourceFile(name, text, version, true); };
  const program = ts.createProgram([filename], options, host);
  return ts.getPreEmitDiagnostics(program).map(diagnostic => ({ code: diagnostic.code,
    file: diagnostic.file?.fileName, line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n") }));
}
const baseDiagnostics = compile(original);
assert.deepEqual(baseDiagnostics, [], "original frozen 8-positive/10-negative consumer");
const controls = [];
for (const index of negativeLines) {
  const changed = [...lines];
  changed[index] = changed[index].replace("Assert<Not<Fits<", "Assert<Fits<").replace(">>>", ">>");
  const diagnostics = compile(changed.join("\n"));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 2344);
  assert.equal(diagnostics[0].file, filename);
  assert.equal(diagnostics[0].line, index + 1);
  controls.push({ originalLine: index + 1, original: lines[index], inversion: changed[index], diagnostics });
}
const result = { layout: config.layout, positiveAssertions: 8, negativeAssertions: 10,
  originalDiagnostics: baseDiagnostics, targetedNegativeDiagnostics: controls,
  declarationAndSourceReads: Object.fromEntries([...checked].sort()), importsMissing: false,
  qualification: config.layout === "source" ? "exact composed source public API" : "actual installed declarations; no paths alias", skipLibCheck: true };
fs.writeFileSync(config.typeResult, JSON.stringify(result));
console.log(JSON.stringify({ layout: config.layout, positive: 8, negative: 10, exactTargetDiagnostics: controls.length, loadedFiles: checked.size }));
