import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstatSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const sourcePath = "packages/safe-bash-command-ssconvert/src/rendering/print/harfbuzz/data.ts";
const allowedRoots = ["packages/safe-bash-command-ssconvert/src/rendering/print/harfbuzz/", "packages/safe-bash-command-ssconvert/scripts/harfbuzz/"];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function inputPath(path) {
  assert.equal(typeof path, "string", "invalid input path");
  assert.ok(allowedRoots.some(root => path.startsWith(root)) && !path.includes("\\") &&
    path.split("/").every(part => part && part !== "." && part !== ".."), "invalid input path");
  return resolve(repository, path);
}

function memoryLimits(bytes) {
  let offset = 8;
  const integer = () => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      assert.ok(offset < bytes.length, "truncated memory metadata");
      const byte = bytes[offset++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
    }
    throw new Error("invalid memory metadata");
  };
  while (offset < bytes.length) {
    const section = bytes[offset++], size = integer(), end = offset + size;
    assert.ok(end <= bytes.length, "invalid memory section bounds");
    if (section === 5) {
      assert.equal(integer(), 1, "expected one memory");
      assert.equal(integer(), 1, "expected bounded, nonshared wasm32 memory");
      const initialMemoryBytes = integer() * 65536, maximumMemoryBytes = integer() * 65536;
      assert.equal(offset, end, "unexpected memory section data");
      return {initialMemoryBytes, maximumMemoryBytes};
    }
    offset = end;
  }
  throw new Error("missing memory section");
}

export function verifyArtifact({source, manifest, files}) {
  assert.equal(manifest.schema, 1, "unsupported source manifest");
  const tree = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(tree.parseDiagnostics.length, 0, "invalid generated source");
  assert.equal(tree.statements.length, 1, "expected a single exported string");
  const statement = tree.statements[0];
  assert.ok(ts.isVariableStatement(statement) && statement.modifiers?.length === 1 &&
    statement.modifiers[0].kind === ts.SyntaxKind.ExportKeyword &&
    (statement.declarationList.flags & ts.NodeFlags.Const) && statement.declarationList.declarations.length === 1,
  "expected a single exported string");
  const declaration = statement.declarationList.declarations[0];
  assert.ok(ts.isIdentifier(declaration.name) && declaration.name.text === "harfbuzzBase64" &&
    declaration.initializer && ts.isStringLiteral(declaration.initializer), "expected harfbuzzBase64 string literal");
  const encoded = declaration.initializer.text;
  assert.ok(declaration.initializer.getText(tree) === JSON.stringify(encoded), "expected canonical base64 literal");
  const bytes = Buffer.from(encoded, "base64");
  assert.ok(bytes.toString("base64") === encoded, "invalid base64 encoding");
  assert.equal(bytes.length, manifest.artifact.bytes, "artifact byte length mismatch");
  assert.equal(digest(bytes), manifest.artifact.sha256, "artifact digest mismatch");
  const module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), manifest.artifact.imports, "artifact imports mismatch");
  assert.deepEqual(WebAssembly.Module.exports(module), manifest.artifact.exports, "artifact exports mismatch");
  const memory = memoryLimits(bytes);
  assert.equal(memory.initialMemoryBytes, manifest.artifact.initialMemoryBytes, "initial memory mismatch");
  assert.equal(memory.maximumMemoryBytes, manifest.artifact.maximumMemoryBytes, "maximum memory mismatch");
  const paths = new Set();
  for (const input of manifest.inputs) {
    inputPath(input.path);
    assert.ok(!paths.has(input.path), "duplicate input path");
    paths.add(input.path);
    const value = files.get(input.path);
    assert.ok(value instanceof Uint8Array, `missing input: ${input.path}`);
    assert.equal(digest(value), input.sha256, `input digest mismatch: ${input.path}`);
  }
  return {byteLength: bytes.length, ...memory, sha256: manifest.artifact.sha256};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(new URL("sources.json", import.meta.url), "utf8"));
  const files = new Map();
  for (const input of manifest.inputs) {
    const path = inputPath(input.path);
    assert.ok(lstatSync(path).isFile(), `input is not a regular file: ${input.path}`);
    files.set(input.path, readFileSync(path));
  }
  const source = inputPath(sourcePath);
  assert.ok(lstatSync(source).isFile(), "generated source is not a regular file");
  const result = verifyArtifact({source: readFileSync(source, "utf8"), manifest, files});
  process.stdout.write(`Verified HarfBuzz ${manifest.upstream.version}: ${result.byteLength} bytes, ${result.sha256}\n`);
}
