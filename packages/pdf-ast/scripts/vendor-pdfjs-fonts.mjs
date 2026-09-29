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
        return { contents: source.slice(start, end) + "\nexport { CMap };\n", loader: "js" };
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
      builder.onLoad({ filter: /font_renderer\.js$/ }, args => ({
        contents: readFileSync(args.path, "utf8") + "\nexport { Type2Compiled };\n", loader: "js",
      }));
    },
  }],
});

writeFileSync(output, result.outputFiles[0].text.split("\n").filter(line => !line.trimStart().startsWith("// eslint-")).join("\n"));
