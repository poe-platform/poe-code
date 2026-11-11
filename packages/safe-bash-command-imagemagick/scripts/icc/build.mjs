import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
assert.equal(process.argv.length, 4, "Usage: node scripts/icc/build.mjs /path/to/lcms2-2.17.tar.gz /path/to/emcc");
const archive = resolve(process.argv[2]), compiler = resolve(process.argv[3]);
assert.equal(createHash("sha256").update(readFileSync(archive)).digest("hex"), "d11af569e42a1baa1650d20ad61d12e41af4fead4aa7964a01f93b08b53ab074");
const output = mkdtempSync(resolve(root, "../../out/icc-build-"));
const upstream = resolve(dirname(compiler), ".."), config = join(output, "em-config");
mkdirSync(join(output, "tmp"));
writeFileSync(config, `LLVM_ROOT = ${JSON.stringify(join(upstream, "bin"))}\nBINARYEN_ROOT = ${JSON.stringify(upstream)}\nNODE_JS = ${JSON.stringify(process.execPath)}\n`);
const env = { ...process.env, EMCC_CORES: "1", EM_CONFIG: config, EM_CACHE: resolve(root, "../../out/media-codecs-emscripten-4.0.13-cache"), TMPDIR: join(output, "tmp") };
function run(command, args) {
    const result = spawnSync(command, args, { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}
assert.ok(run(compiler, ["--version"]).startsWith("emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 4.0.13"));
run("tar", ["-xf", archive, "-C", output]);
const source = join(output, "lcms2-2.17"), artifact = join(output, "runtime.js");
run(compiler, ["-O2", "-I" + join(source, "include"),
    ...readdirSync(join(source, "src")).filter(name => name.endsWith(".c")).sort().map(name => join(source, "src", name)),
    "-sWASM=0", "-sWASM_ASYNC_COMPILATION=0", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=web", "-sFILESYSTEM=0",
    "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=4194304", "-sMAXIMUM_MEMORY=67108864", "-sSTACK_SIZE=262144", "-sMALLOC=emmalloc", "-sABORTING_MALLOC=0",
    '-sEXPORTED_FUNCTIONS=["_malloc","_free","_cmsOpenProfileFromMem","_cmsCloseProfile","_cmsGetColorSpace","_cmsFormatterForColorspaceOfProfile","_cmsCreateTransform","_cmsDeleteTransform","_cmsDoTransform"]', '-sEXPORTED_RUNTIME_METHODS=["HEAPU8","HEAPF64"]', "-o", artifact]);
const code = readFileSync(artifact, "utf8");
const entry = parse(code, { ecmaVersion: "latest", sourceType: "module" }).body[0];
assert.equal(entry.type, "FunctionDeclaration");
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
assert.equal(code.slice(entry.start, entry.start + 6), "async ");
const licenses = readFileSync(join(root, "src/icc/LICENSE.LittleCMS"), "utf8") + "\n\n" + ["Emscripten", "musl", "compiler-rt"].map(name => readFileSync(join(root, "src/font/LICENSE." + name), "utf8")).join("\n\n");
writeFileSync(join(root, "src/icc/runtime.js"), "/* eslint-disable */\n/*! Generated LittleCMS 2.17. See scripts/icc/build.mjs.\n" + licenses.replaceAll("*/", "* /") + "\n*/\n" + code.slice(0, entry.start) + code.slice(entry.start + 6));
console.log("Generated src/icc/runtime.js");
