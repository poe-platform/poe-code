import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { parseAnsi } from "./ansi-parser.js";
import { renderPng } from "./png-renderer.js";
import { renderSvg } from "./svg-renderer.js";

export interface TerminalPngOptions {
  padding?: number;
  window?: boolean;
  output?: string;
}

export async function renderTerminalPng(
  ansiText: string,
  options: TerminalPngOptions = {}
): Promise<Buffer> {
  if (options.padding !== undefined && (!Number.isInteger(options.padding) || options.padding < 0)) {
    throw new Error("Padding must be a non-negative integer.");
  }

  const runs = parseAnsi(ansiText);
  const svg = renderSvg(runs, {
    padding: options.padding,
    window: options.window
  });
  const png = renderPng(svg);

  if (options.output) {
    const temporaryPath = `${options.output}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, png, { flag: "wx" });
      await rename(temporaryPath, options.output);
    } catch (error) {
      try {
        await rm(temporaryPath, { force: true });
      } catch (cleanupError) {
        void cleanupError;
      }
      throw error;
    }
  }

  return png;
}

export * from "./ansi-parser.js";
export * from "./font.js";
export * from "./png-renderer.js";
export * from "./svg-renderer.js";
