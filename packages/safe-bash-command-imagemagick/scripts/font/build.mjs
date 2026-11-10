import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
assert.equal(process.argv.length, 4, "Usage: node scripts/font/build.mjs /path/to/freetype-2.14.1.tar.xz /path/to/emcc");
const archive = resolve(process.argv[2]), compiler = resolve(process.argv[3]);
assert.equal(createHash("sha256").update(readFileSync(archive)).digest("hex"), "32427e8c471ac095853212a37aef816c60b42052d4d9e48230bab3bdf2936ccc");
const output = mkdtempSync(resolve(root, "../../out/font-build-"));
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
const source = join(output, "freetype-2.14.1"), artifact = join(output, "runtime.js");
run(compiler, ["-O2", "-DFT2_BUILD_LIBRARY", '-DFT_CONFIG_MODULES_H="ftmodule.h"', "-I" + join(root, "scripts/font"), "-I" + join(source, "include"), join(root, "scripts/font/font.c"),
    ...["cff/cff.c", "psaux/psaux.c", "pshinter/pshinter.c", "base/ftbase.c", "base/ftinit.c", "base/ftsystem.c", "base/ftdebug.c", "truetype/truetype.c", "sfnt/sfnt.c", "autofit/autofit.c", "smooth/smooth.c", "psnames/psnames.c", "base/ftbitmap.c", "base/ftglyph.c", "base/ftmm.c", "gzip/ftgzip.c"].map(path => join(source, "src", path)),
    "-sWASM=0", "-sWASM_ASYNC_COMPILATION=0", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=web", "-sFILESYSTEM=0",
    "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=4194304", "-sMAXIMUM_MEMORY=67108864", "-sSTACK_SIZE=262144", "-sMALLOC=emmalloc", "-sABORTING_MALLOC=0",
    '-sEXPORTED_FUNCTIONS=["_malloc","_free","_font_open","_font_metrics","_font_glyph","_font_kerning","_font_close"]', '-sEXPORTED_RUNTIME_METHODS=["HEAPU8","HEAP32"]', "-o", artifact]);
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
const licenses = ["FreeType", "Emscripten", "zlib", "musl", "compiler-rt"].map(name => readFileSync(join(root, "src/font/LICENSE." + name), "utf8")).join("\n\n");
writeFileSync(join(root, "src/font/runtime.js"), "/* eslint-disable */\n/*! Generated FreeType 2.14.1. See scripts/font/build.mjs.\n" + licenses.replaceAll("*/", "* /") + "\n*/\n" + code.slice(0, entry.start) + code.slice(entry.start + 6));
console.log("Generated src/font/runtime.js");
