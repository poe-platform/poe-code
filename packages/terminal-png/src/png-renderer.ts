import { Resvg } from "@resvg/resvg-js";
import { FALLBACK_FONT_PATH, JETBRAINS_MONO_FONT_FILES } from "./font.js";

export function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    font: {
      defaultFontFamily: "JetBrains Mono",
      fontFiles: [...JETBRAINS_MONO_FONT_FILES, FALLBACK_FONT_PATH],
      loadSystemFonts: false,
      monospaceFamily: "JetBrains Mono"
    },
    fitTo: {
      mode: "zoom",
      value: 4
    }
  });
  const png = resvg.render();
  return Buffer.from(png.asPng());
}
