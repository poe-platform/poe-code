import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(root, "../..");
assert.equal(process.argv.length, 3, "Usage: node scripts/build.mjs /absolute/path/to/emcc");
const compiler = resolve(process.argv[2]);
const compilerRoot = dirname(compiler);
const upstream = resolve(compilerRoot, "..");
const manifest = JSON.parse(readFileSync(join(root, "scripts/sources.json"), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
for (const entry of [...manifest.archives, ...manifest.inputs]) {
  assert.equal(hash(readFileSync(join(root, entry.path))), entry.sha256, `Source/input changed: ${entry.path}`);
}
const outputRoot = join(repository, "out");
mkdirSync(outputRoot, { recursive: true });
const output = mkdtempSync(join(outputRoot, "media-codecs-build-"));
const prefix = join(output, "audio-prefix");
const config = join(output, "em-config");
const temporary = join(output, "tmp");
mkdirSync(temporary);
writeFileSync(config, `LLVM_ROOT = ${JSON.stringify(join(upstream, "bin"))}\nBINARYEN_ROOT = ${JSON.stringify(upstream)}\nNODE_JS = ${JSON.stringify(process.execPath)}\n`);
const environment = { ...process.env, EM_CONFIG: config, EM_CACHE: join(outputRoot, "media-codecs-emscripten-4.0.13-cache"), TMPDIR: temporary,
  PATH: compilerRoot + ":" + process.env.PATH };
function run(command, args, name, cwd = output, env = environment) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(join(output, name + ".log"), (result.stdout ?? "") + (result.stderr ?? ""));
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${name} failed; see ${output}/${name}.log`);
  return result.stdout;
}
assert.equal(run(compiler, ["--version"], "compiler").trim().split("\n")[0], manifest.toolchain.versionLine);
for (const archive of manifest.archives) run("tar", ["-xf", join(root, archive.path), "-C", output], "extract-" + archive.name);
const audioEnvironment = { ...environment, CC: compiler, CXX: join(compilerRoot, "em++"), AR: join(compilerRoot, "emar"),
  RANLIB: join(compilerRoot, "emranlib"), CFLAGS: "-O2", PKG_CONFIG_LIBDIR: join(prefix, "lib/pkgconfig") };
for (const [name, flags] of [
  ["libogg-1.3.5", []],
  ["libvorbis-1.3.7", ["--with-ogg=" + prefix]],
  ["opus-1.5.2", ["--disable-intrinsics", "--disable-rtcd", "--disable-extra-programs", "--disable-doc", "--disable-dred", "--disable-osce"]]
]) {
  const directory = join(output, name);
  run("./configure", ["--prefix=" + prefix, "--host=wasm32-unknown-none", "--disable-shared", "--enable-static", ...flags], name + "-configure", directory, audioEnvironment);
  run("make", ["-j4"], name + "-make", directory, audioEnvironment);
  run("make", ["install"], name + "-install", directory, audioEnvironment);
}
const source = join(output, "ffmpeg-7.1.1");
run("./configure", ["--cc=" + compiler, "--ar=" + join(compilerRoot, "emar"), "--ranlib=" + join(compilerRoot, "emranlib"),
  "--arch=wasm32", "--target-os=none", "--enable-cross-compile", "--disable-asm", "--disable-x86asm", "--disable-everything",
  "--disable-programs", "--disable-doc", "--disable-network", "--disable-autodetect", "--disable-avdevice", "--disable-avformat",
  "--disable-swresample", "--disable-avfilter", "--disable-pthreads", "--disable-w32threads", "--disable-os2threads",
  "--disable-debug", "--enable-decoder=h264", "--enable-parser=h264", "--extra-cflags=-O2"], "ffmpeg-configure", source);
run("make", ["-j4"], "ffmpeg-make", source);
const artifact = join(output, "runtime.js");
const exports = ["_malloc", "_free", "_decoder_create", "_decoder_free", "_decoder_send", "_decoder_receive", "_audio_create", "_audio_free", "_audio_header", "_audio_send", "_audio_receive"];
const arguments_ = ["-O2", join(root, "scripts/codec.c"), "-I" + source, "-I" + join(prefix, "include"),
  join(source, "libavcodec/aom_film_grain.c"), join(source, "libavcodec/libavcodec.a"), join(source, "libswscale/libswscale.a"), join(source, "libavutil/libavutil.a"),
  ...["libvorbisenc.a", "libvorbis.a", "libogg.a", "libopus.a"].map(name => join(prefix, "lib", name)),
  "-lm", "-sWASM=0", "-sWASM_ASYNC_COMPILATION=0", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=web", "-sFILESYSTEM=0",
  "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=16777216", "-sMAXIMUM_MEMORY=134217728", "-sSTACK_SIZE=1048576", "-sMALLOC=emmalloc", "-sABORTING_MALLOC=0",
  "-sEXPORTED_FUNCTIONS=" + JSON.stringify(exports), '-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]', "-o", artifact];
writeFileSync(join(output, "link-arguments.json"), JSON.stringify(arguments_, null, 2) + "\n");
run(compiler, arguments_, "link");
run(process.execPath, [join(root, "scripts/normalize-runtime.mjs"), artifact], "normalize");
const bytes = readFileSync(artifact);
assert.equal(hash(bytes), manifest.artifact.sha256, `Artifact is not reproducible; inspect ${output}`);
assert.equal(bytes.length, manifest.artifact.bytes);
process.stdout.write(`Reproduced ${manifest.artifact.sha256}; build evidence: ${output}\n`);
