import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const [checkout] = process.argv.slice(2);
if (!checkout) throw new Error("Usage: node vendor-pdfjs-fonts.mjs <PDF.js checkout at the revision in THIRD_PARTY_NOTICES.md>");
const reference = resolve(checkout);
const output = fileURLToPath(new URL("../src/vendor/pdfjs-fonts.mjs", import.meta.url));
const result = await build({
  absWorkingDir: reference,
  stdin: {
    contents: [
      'export { CMap } from "./src/core/cmap.js";',
      'export { CFFParser, CFFCompiler, CFFStrings } from "./src/core/cff_parser.js";',
      'export { Type2Compiled } from "./src/core/font_renderer.js";',
      'export { Type1Font } from "./src/core/type1_font.js";',
      'export { Type1Parser } from "./src/core/type1_parser.js";',
      'export { MacStandardGlyphOrdering } from "./src/core/fonts_utils.js";',
      'export { CipherTransformFactory, PDF17, PDF20 } from "./src/core/crypto.js";',
      'export { Dict, Name } from "./src/core/primitives.js";',
      'export { saslPrep } from "./src/core/sasl_prep.js";',
      'export { FlateStream } from "./src/core/flate_stream.js";',
      'export { Stream, StringStream } from "./src/core/stream.js";',
      'export { getGlyphsUnicode, getDingbatsGlyphsUnicode } from "./src/core/glyphlist.js";',
      'export { SymbolSetEncoding, ZapfDingbatsEncoding, WinAnsiEncoding, getEncoding } from "./src/core/encodings.js";',
      'export { getMetrics } from "./src/core/metrics.js";',
      'export { DrawOPS } from "./src/shared/util.js";',
      'export { PageViewport } from "./src/display/page_viewport.js";',
      'export { DeviceCmykCS, CalGrayCS, CalRGBCS, LabCS } from "./src/core/colorspace.js";',
      'export { buildPostScriptJsFunction } from "./src/core/postscript/js_evaluator.js";',
      'export { MeshShading } from "./src/core/pattern.js";',
      'export { encodeToXmlString } from "./src/core/core_utils.js";',
    ].join("\n"), resolveDir: reference, sourcefile: "pdf-ast-font-entry.js",
  },
  bundle: true, platform: "neutral", format: "esm", target: "es2022",
  outfile: output, write: false,
  banner: { js: "/* eslint-disable */\n/* Mozilla PDF.js, Apache-2.0. Generated from 91041fb94d6744bc2a5bccd9aad28d617faa8195; see THIRD_PARTY_NOTICES.md. */" },
  plugins: [{
    name: "expose-cff-path-compiler",
    setup(builder) {
      builder.onLoad({ filter: /pattern\.js$/ }, args => {
        const source = readFileSync(args.path, "utf8");
        const section = (start, end) => {
          const a = source.indexOf(start), b = source.indexOf(end, a);
          if (a < 0 || b <= a) throw new Error("PDF.js mesh source markers changed");
          return source.slice(a, b);
        };
        // Keep PDF.js's stream reader, patch decoding, tessellation and packing.
        // Supply already-resolved colors/functions from the local COS evaluator
        // instead of importing PDF.js's document and ICC/Wasm resource loaders.
        let mesh = section("class MeshStreamReader", "class DummyShading");
        const constructorStart = mesh.indexOf("  constructor(\n", mesh.indexOf("class MeshShading"));
        const decodeStart = mesh.indexOf("    let patchMesh = false;", constructorStart);
        if (constructorStart < 0 || decodeStart < constructorStart) throw new Error("PDF.js mesh constructor changed");
        mesh = mesh.slice(0, constructorStart) + [
          "  constructor(shadingType, stream, context, rowVertices) {",
          "    super();",
          "    this.shadingType = shadingType;",
          "    this.bbox = this.background = null;",
          "    this.coords = []; this.colors = []; this.figures = [];",
          "    const reader = new MeshStreamReader(stream, context);",
          "",
        ].join("\n") + mesh.slice(decodeStart);
        mesh = mesh.replace('dict.get("VerticesPerRow") | 0', "rowVertices | 0");
        // Equivalent cache operations for the package's ES2022/Node 22 target.
        mesh = mesh.replace("return (bCache ??= new Map()).getOrInsertComputed(count, () =>", "if (bCache?.has(count)) return bCache.get(count);\n  const values = (");
        const cacheEnd = mesh.indexOf("\n}\n\nfunction clearPatternCaches");
        if (cacheEnd < 0) throw new Error("PDF.js mesh cache source changed");
        mesh = mesh.slice(0, cacheEnd) + "\n  (bCache ??= new Map()).set(count, values);\n  return values;" + mesh.slice(cacheEnd);
        return { contents: [
          'import { assert, FormatError, MeshFigureType, unreachable } from "../shared/util.js";',
          'import { MathClamp } from "../shared/math_clamp.js";',
          section("const ShadingType =", "// Bound temporary buffers"),
          section("class BaseShading", "// Radial and axial shading"),
          section("function meshUpdateBounds", "// Type 1 shading"),
          mesh,
          "export { MeshShading };",
        ].join("\n"), loader: "js" };
      });
      // The standalone CMap class has no imports. Exclude its browser/network
      // factory rather than pulling PDF.js's renderer and scripting entrypoints.
      builder.onLoad({ filter: /cmap\.js$/ }, args => {
        const source = readFileSync(args.path, "utf8");
        const start = source.indexOf("const MAX_MAP_RANGE =");
        const end = source.indexOf("// A special case of CMap,");
        if (start < 0 || end <= start) throw new Error("PDF.js CMap source markers changed");
        let cmap = source.slice(start, end);
        const patches = [
          ["constructor(builtInCMap = false) {", "#onAllocation;\n  constructor(builtInCMap = false, onAllocation) {\n    this.#onAllocation = onAllocation;"],
          ["this.codespaceRanges[n - 1].push(low, high);", "this.#onAllocation?.(16);\n    this.codespaceRanges[n - 1].push(low, high);"],
          ["#consumeBudget(count, name) {", "#consumeBudget(count, name, bytesPerEntry = 64) {"],
          ["this.#mappedEntries += count;", "this.#onAllocation?.(count * bytesPerEntry);\n    this.#mappedEntries += count;"],
          ['this.#consumeBudget(high - low + 1, "mapBfRange");', 'this.#consumeBudget(high - low + 1, "mapBfRange", 64 + 4 * (dstLow.length + 2));'],
          ["mapOne(src, dst) {", 'mapOne(src, dst) {\n    this.#onAllocation?.(64 + (typeof dst === "string" ? dst.length * 2 : 0));'],
        ];
        for (const [before, after] of patches) {
          if (!cmap.includes(before)) throw new Error("PDF.js CMap allocation source marker changed: " + before);
          cmap = cmap.replace(before, after);
        }
        return { contents: cmap + "\nexport { CMap };\n", loader: "js" };
      });
      builder.onLoad({ filter: /crypto\.js$/ }, args => {
        let source = readFileSync(args.path, "utf8");
        // Node 22/ES2022 equivalents: summing sixteen bytes is exact.
        const sum = "Math.sumPrecise(e.slice(0, 16))";
        const cache = "return this.#cipherCache.getOrInsertComputed(key, () =>\n      this.resolveCipher(filterName)\n    );";
        if (!source.includes(sum) || !source.includes(cache)) throw new Error("PDF.js crypto source markers changed");
        source = source.replace(sum, "e.slice(0, 16).reduce((sum, byte) => sum + byte, 0)");
        source = source.replace(cache, "if (!this.#cipherCache.has(key)) this.#cipherCache.set(key, this.resolveCipher(filterName));\n    return this.#cipherCache.get(key);");
        return { contents: source, loader: "js" };
      });
      builder.onLoad({ filter: /type1_font\.js$/ }, args => {
        let source = readFileSync(args.path, "utf8");
        const patches = [
          ["class Type1Font {", "class Type1Font {\n  #data;\n  get data() { return this.#data ??= new CFFCompiler(this.cff).compile(); }"],
          ["constructor(name, file, properties) {", "constructor(name, file, properties, onAllocation) {\n    this.onAllocation = onAllocation;\n    onAllocation?.(2048);"],
          ["this.data = this.wrap(", "this.cff = this.wrap("],
          ["  getCharset() {", "  getCharset() {\n    this.onAllocation?.(256 + this.charstrings.length * 16);"],
          ["  getGlyphMapping(properties) {", "  getGlyphMapping(properties) {\n    this.onAllocation?.(65536 + this.charstrings.length * 128);"],
          ["  getSeacs(charstrings) {", "  getSeacs(charstrings) {\n    this.onAllocation?.(256 + charstrings.length * 64);"],
          ["  getType2Charstrings(type1Charstrings) {", "  getType2Charstrings(type1Charstrings) {\n    this.onAllocation?.(256 + type1Charstrings.length * 16);"],
          ["const type2Subrs = [];", "this.onAllocation?.(256 + (count + bias) * 64);\n    const type2Subrs = [];"],
          ["  wrap(name, glyphs, charstrings, subrs, properties) {", "  wrap(name, glyphs, charstrings, subrs, properties) {\n    this.onAllocation?.(4096 + glyphs.length * 256 + subrs.length * 128);"],
          ["charStringsIndex.add([0x8b, 0x0e]);", "charStringsIndex.add(new Uint8Array([0x8b, 0x0e]));"],
          ["charStringsIndex.add(glyphs[i]);", "this.onAllocation?.(glyphs[i].length);\n      charStringsIndex.add(Uint8Array.from(glyphs[i]));"],
          ["subrIndex.add(subr);", "this.onAllocation?.(subr.length);\n      subrIndex.add(Uint8Array.from(subr));"],
          ["const compiler = new CFFCompiler(cff);\n    return compiler.compile();", "return cff;"],
        ];
        for (const [before, after] of patches) {
          if (!source.includes(before)) throw new Error("PDF.js Type1 font source marker changed: " + before);
          source = source.replace(before, after);
        }
        return { contents: source, loader: "js" };
      });
      builder.onLoad({ filter: /cff_parser\.js$/ }, args => {
        const source = readFileSync(args.path, "utf8");
        const start = source.indexOf("class CFFParser {");
        const end = source.indexOf("\nclass CFF {", start);
        if (start < 0 || end <= start) throw new Error("PDF.js CFF parser source markers changed");
        let parser = source.slice(start, end);
        const patches = [
          ["constructor(file, properties, seacAnalysisEnabled) {", "constructor(file, properties, seacAnalysisEnabled, onAllocation) {\n    this.onAllocation = onAllocation;\n    onAllocation?.(2048);"],
          ["  parse() {", "  parse() {\n    this.onAllocation?.(2048);"],
          ["  parseDict(dict) {", "  parseDict(dict) {\n    this.onAllocation?.(1024 + dict.length * 128);"],
          ["const count = (bytes[pos++] << 8) | bytes[pos++];", "const count = (bytes[pos++] << 8) | bytes[pos++];\n    this.onAllocation?.(256 + count * 128);"],
          ["const name = index.get(i);", "const name = index.get(i);\n      this.onAllocation?.(64 + name.length * 32);"],
          ["const data = index.get(i);", "const data = index.get(i);\n      this.onAllocation?.(64 + data.length * 32);"],
          ["  createDict(Type, dict, strings) {", "  createDict(Type, dict, strings) {\n    this.onAllocation?.(2048 + dict.length * 128);"],
          ["const view = new DataView(data.buffer, data.byteOffset, data.bytesLength);", "this.onAllocation?.(256 + data.length * 16);\n    const view = new DataView(data.buffer, data.byteOffset, data.bytesLength);"],
          ["const count = charStrings.count;", "const count = charStrings.count;\n    this.onAllocation?.(count * 512);"],
          ["  parseCharsets(pos, length, strings, cid) {", "  parseCharsets(pos, length, strings, cid) {\n    this.onAllocation?.(256);"],
          ["for (i = 0; i < length; i++) {", "this.onAllocation?.(Math.max(0, length) * 16);\n        for (i = 0; i < length; i++) {"],
          ["while (charset.length <= length) {", "while (charset.length <= length) {\n          if (pos + (format === 1 ? 3 : 4) > bytes.length) throw new FormatError(\"Truncated CFF charset range\");"],
          ["for (i = 0; i <= count; i++) {", "this.onAllocation?.((count + 1) * 16);\n          for (i = 0; i <= count; i++) {"],
          ["  parseEncoding(pos, properties, strings, charset) {", "  parseEncoding(pos, properties, strings, charset) {\n    this.onAllocation?.(32768);"],
          ["  parseFDSelect(pos, length) {", "  parseFDSelect(pos, length) {\n    this.onAllocation?.(256);"],
          ["for (i = 0; i < length; ++i) {", "this.onAllocation?.(Math.max(0, length) * 16);\n        for (i = 0; i < length; ++i) {"],
          ["for (let j = first; j < next; ++j) {", "this.onAllocation?.(Math.max(0, next - first) * 16);\n          for (let j = first; j < next; ++j) {"],
        ];
        for (const [before, after] of patches) {
          if (!parser.includes(before)) throw new Error("PDF.js CFF allocation source marker changed: " + before);
          parser = parser.replaceAll(before, after);
        }
        return { contents: source.slice(0, start) + parser + source.slice(end), loader: "js" };
      });
      builder.onLoad({ filter: /font_renderer\.js$/ }, args => {
        let source = readFileSync(args.path, "utf8");
        const patches = [
          ["class Commands {", "class Commands {\n  constructor(onAllocation) { this.onAllocation = onAllocation; }"],
          ["  add(cmd, args) {", "  add(cmd, args) {\n    this.onAllocation?.(64 + (args?.length ?? 0) * 16);"],
          ["  transform(transf) {", "  transform(transf) {\n    this.onAllocation?.(128);"],
          ["  save() {", "  save() {\n    this.onAllocation?.(128);"],
          ["  getPath() {", "  getPath() {\n    this.onAllocation?.(this.cmds.length * 4);"],
          ["  compileGlyph(code, glyphId) {", "  compileGlyph(code, glyphId, onAllocation) {\n    onAllocation?.(512);"],
          ["const cmds = new Commands();", "const cmds = new Commands(onAllocation);"],
          ["function compileCharString(charStringCode, cmds, font, glyphId) {", "function compileCharString(charStringCode, cmds, font, glyphId) {\n  cmds.onAllocation?.(512);"],
          ["  function parse(code) {", "  function parse(code) {\n    cmds.onAllocation?.(256 + code.length * 16);"],
        ];
        for (const [before, after] of patches) {
          if (!source.includes(before)) throw new Error("PDF.js outline allocation source marker changed: " + before);
          source = source.replace(before, after);
        }
        return { contents: source + "\nexport { Type2Compiled };\n", loader: "js" };
      });
    },
  }],
});

writeFileSync(output, result.outputFiles[0].text.split("\n").filter(line => !line.trimStart().startsWith("// eslint-")).join("\n"));
