import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

// Explicit maintenance only. Normal builds use verify.mjs and frozen bytes.
const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../../..");
const [sourceRoot, compiler] = process.argv.slice(2).map(path => resolve(path));
assert.ok(sourceRoot && compiler && process.argv.length === 4,
  "Usage: node build.mjs PINNED_HARFBUZZ_SRC_DIRECTORY EMSCRIPTEN_EM++");
const manifest = JSON.parse(readFileSync(join(directory, "sources.json"), "utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");

function sourceTree(root) {
  const records = [];
  function visit(relative) {
    for (const entry of readdirSync(join(root, relative), {withFileTypes: true})) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path);
      else {
        assert.ok(entry.isFile(), `nonregular upstream source: ${path}`);
        const bytes = readFileSync(join(root, path));
        records.push([path, bytes.length, hash(bytes)]);
      }
    }
  }
  visit("");
  return records.sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
}
const records = sourceTree(sourceRoot);
assert.equal(records.length, manifest.upstream.sourceFiles, "upstream source membership mismatch");
assert.equal(hash(JSON.stringify(records)), manifest.upstream.sourceTreeSha256, "upstream source digest mismatch");
for (const input of manifest.inputs) {
  const path = resolve(repository, input.path);
  assert.ok(path.startsWith(repository + "/") && lstatSync(path).isFile(), "invalid build input");
  assert.equal(hash(readFileSync(path)), input.sha256, `build input digest mismatch: ${input.path}`);
}

const outputRoot = join(repository, "out");
mkdirSync(outputRoot, {recursive: true});
const output = mkdtempSync(join(outputRoot, "ssconvert-harfbuzz-build-"));
const staged = join(output, "source");
mkdirSync(staged);
for (const [path] of records) {
  mkdirSync(dirname(join(staged, path)), {recursive: true});
  copyFileSync(join(sourceRoot, path), join(staged, path));
}
assert.equal(hash(JSON.stringify(sourceTree(staged))), manifest.upstream.sourceTreeSha256, "copied source digest mismatch");
const upstream = resolve(dirname(compiler), "..");
const config = join(output, "em-config");
const cache = join(outputRoot, `ssconvert-emscripten-${manifest.toolchain.emscripten}-cache`);
const temporary = join(output, "tmp");
mkdirSync(temporary);
writeFileSync(config, `LLVM_ROOT = ${JSON.stringify(join(upstream, "bin"))}\nBINARYEN_ROOT = ${JSON.stringify(upstream)}\nNODE_JS = ${JSON.stringify(process.execPath)}\nCACHE = ${JSON.stringify(cache)}\n`);
const environment = {...process.env, EM_CONFIG: config, EM_CACHE: cache, TMPDIR: temporary};
function run(command, args, name) {
  const result = spawnSync(command, args, {env: environment, encoding: "utf8", maxBuffer: 16 * 1024 * 1024});
  writeFileSync(join(output, name + ".log"), (result.stdout ?? "") + (result.stderr ?? ""));
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${name} failed; see ${output}/${name}.log`);
  return result.stdout;
}
assert.equal(run(compiler, ["--version"], "compiler-version").trim().split("\n")[0], manifest.toolchain.versionLine,
  "Emscripten version mismatch");
const patchRoot = join(output, "patch-root");
mkdirSync(join(patchRoot, "src"), {recursive: true});
for (const patch of manifest.patches) {
  const bytes = readFileSync(join(staged, patch.path));
  assert.equal(hash(bytes), patch.beforeSha256, "unpatched source mismatch");
  copyFileSync(join(staged, patch.path), join(patchRoot, "src", patch.path));
}
run("patch", ["-t", "-N", "-p1", "-d", patchRoot, "-i", join(directory, "completion.patch")], "patch");
for (const patch of manifest.patches) {
  const bytes = readFileSync(join(patchRoot, "src", patch.path));
  assert.equal(hash(bytes), patch.afterSha256, "patched source mismatch");
  writeFileSync(join(staged, patch.path), bytes);
}
const args = [...manifest.compilerFlags, `-I${directory}`, `-I${staged}`,
  `-sEXPORTED_FUNCTIONS=@${join(directory, "exports.json")}`,
  join(staged, "harfbuzz.cc"), join(directory, "allocator.cc"), "-o", join(output, "harfbuzz.mjs")];
writeFileSync(join(output, "arguments.json"), JSON.stringify(args, null, 2) + "\n");
run(compiler, args, "compile");
const bytes = readFileSync(join(output, "harfbuzz.wasm"));
assert.equal(bytes.length, manifest.artifact.bytes, "rebuilt artifact size differs; requalification required");
assert.equal(hash(bytes), manifest.artifact.sha256, "rebuilt artifact digest differs; requalification required");
const text = "// Generated from the pinned HarfBuzz build. See NOTICE.md and scripts/harfbuzz/sources.json.\n" +
  `export const harfbuzzBase64 = ${JSON.stringify(bytes.toString("base64"))};\n`;
const generatedPath = resolve(repository, manifest.artifact.path);
if (readFileSync(generatedPath, "utf8") !== text) writeFileSync(generatedPath, text);
run(process.execPath, [join(directory, "verify.mjs")], "verify");
process.stdout.write(`Reproduced ${manifest.artifact.sha256}; build evidence: ${output}\n`);
