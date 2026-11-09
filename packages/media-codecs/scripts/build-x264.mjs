import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "scripts/x264-sources.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(process.argv.length, 3, "Usage: node scripts/build-x264.mjs /absolute/path/to/emcc");
const compiler = resolve(process.argv[2]);
const upstream = resolve(dirname(compiler), "..");
for (const entry of manifest.inputs) assert.equal(hash(readFileSync(join(root, entry.path))), entry.sha256, entry.path);
const outputRoot = resolve(root, "../../out");
mkdirSync(outputRoot, { recursive: true });
const output = mkdtempSync(join(outputRoot, "x264-build-"));
const temporary = join(output, "tmp");
mkdirSync(temporary);
const config = join(output, "em-config");
writeFileSync(config, `LLVM_ROOT = ${JSON.stringify(join(upstream, "bin"))}\nBINARYEN_ROOT = ${JSON.stringify(upstream)}\nNODE_JS = ${JSON.stringify(process.execPath)}\n`);
const env = { ...process.env, EM_CONFIG: config, EM_CACHE: join(outputRoot, "media-codecs-emscripten-4.0.13-cache"), TMPDIR: temporary, EMCC_CORES: "1" };
function run(command, args, cwd = output) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
assert.equal(run(compiler, ["--version"]).trim().split("\n")[0], manifest.toolchain);
run("tar", ["-xf", join(root, "vendor/sources/x264-c24e06c.tar.gz")]);
const directory = join(output, "x264-c24e06c2e184345ceb33eb20a15d1024d9fd3497");
Object.assign(env, { CC: compiler, AR: join(dirname(compiler), "emar"), RANLIB: join(dirname(compiler), "emranlib") });
run("./configure", ["--host=wasm32-unknown-linux", "--enable-static", "--disable-cli", "--disable-asm", "--disable-thread", "--disable-opencl", "--bit-depth=8", "--chroma-format=420", "--extra-cflags=-O2"], directory);
run("make", ["-j4"], directory);
const artifact = join(output, "x264-encoder.js");
run(compiler, ["-O2", join(root, "scripts/x264-encoder.c"), "-I" + directory, join(directory, "libx264.a"), "-lm",
  "-sWASM=0", "-sWASM_ASYNC_COMPILATION=0", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=web", "-sFILESYSTEM=0",
  "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=16777216", "-sMAXIMUM_MEMORY=134217728", "-sSTACK_SIZE=1048576",
  "-sMALLOC=emmalloc", "-sABORTING_MALLOC=0",
  '-sEXPORTED_FUNCTIONS=["_malloc","_free","_preset_encoder_create","_preset_encoder_frame","_preset_encoder_free"]',
  '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]', "-o", artifact]);
const source = readFileSync(artifact, "utf8");
const entry = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body[0];
assert.equal(entry.type, "FunctionDeclaration");
assert.equal(entry.id.name, "Module");
assert.equal(entry.async, true);
function check(node) {
  if (node !== entry && ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return;
  assert.notEqual(node.type, "AwaitExpression");
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) if (child?.type) check(child); }
    else if (value?.type) check(value);
  }
}
check(entry);
assert.equal(source.slice(entry.start, entry.start + 6), "async ");
writeFileSync(artifact, "/*! x264 (GPL-2.0-or-later). Source and build: https://github.com/poe-platform/poe-code/tree/main/packages/media-codecs\n" + readFileSync(join(root, "vendor/LICENSE.x264"), "utf8") + "\n*/\n" + source.slice(0, entry.start) + source.slice(entry.start + 6));
const bytes = readFileSync(artifact);
assert.equal(hash(bytes), manifest.artifact.sha256, `Artifact is not reproducible; inspect ${artifact}`);
assert.equal(bytes.length, manifest.artifact.bytes);
process.stdout.write(`Reproduced ${manifest.artifact.sha256}; build evidence: ${output}\n`);
