import { writeFile } from "node:fs/promises";
import { parseAnsi } from "./ansi-parser.js";
import { renderPng } from "./png-renderer.js";
import { renderSvg } from "./svg-renderer.js";

export interface TerminalScreenshotOptions {
  padding?: number;
  window?: boolean;
  output?: string;
}

export async function renderTerminalScreenshot(
  ansiText: string,
  options: TerminalScreenshotOptions = {}
): Promise<Buffer> {
  const runs = parseAnsi(ansiText);
  const svg = renderSvg(runs, {
    padding: options.padding,
    window: options.window
  });
  const png = renderPng(svg);

  if (options.output) {
    await writeFile(options.output, png);
  }

  return png;
}

export * from "./ansi-parser.js";
export * from "./font.js";
export * from "./png-renderer.js";
export * from "./svg-renderer.js";
