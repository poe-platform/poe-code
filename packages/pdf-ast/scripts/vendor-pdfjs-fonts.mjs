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
      'export { Stream, StringStream } from "./src/core/stream.js";',
      'export { getGlyphsUnicode, getDingbatsGlyphsUnicode } from "./src/core/glyphlist.js";',
      'export { SymbolSetEncoding, ZapfDingbatsEncoding, WinAnsiEncoding, getEncoding } from "./src/core/encodings.js";',
      'export { getMetrics } from "./src/core/metrics.js";',
      'export { DrawOPS } from "./src/shared/util.js";',
    ].join("\n"), resolveDir: reference, sourcefile: "pdf-ast-font-entry.js",
  },
  bundle: true, platform: "neutral", format: "esm", target: "es2022",
  outfile: output, write: false,
  banner: { js: "/* eslint-disable */\n/* Mozilla PDF.js, Apache-2.0. Generated from 91041fb94d6744bc2a5bccd9aad28d617faa8195; see THIRD_PARTY_NOTICES.md. */" },
  plugins: [{
    name: "expose-cff-path-compiler",
    setup(builder) {
      // The standalone CMap class has no imports. Exclude its browser/network
      // factory rather than pulling PDF.js's renderer and scripting entrypoints.
      builder.onLoad({ filter: /cmap\.js$/ }, args => {
        const source = readFileSync(args.path, "utf8");
        const start = source.indexOf("const MAX_MAP_RANGE =");
        const end = source.indexOf("// A special case of CMap,");
        if (start < 0 || end <= start) throw new Error("PDF.js CMap source markers changed");
        return { contents: source.slice(start, end) + "\nexport { CMap };\n", loader: "js" };
      });
      builder.onLoad({ filter: /font_renderer\.js$/ }, args => ({
        contents: readFileSync(args.path, "utf8") + "\nexport { Type2Compiled };\n", loader: "js",
      }));
    },
  }],
});

writeFileSync(output, result.outputFiles[0].text.split("\n").filter(line => !line.trimStart().startsWith("// eslint-")).join("\n"));
