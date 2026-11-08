import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { parseAnsi } from "./ansi-parser.js";
import { hasOwnErrorCode } from "./error-codes.js";
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
  if (
    options.padding !== undefined &&
    (!Number.isInteger(options.padding) || options.padding < 0)
  ) {
    throw new Error("Padding must be a non-negative integer.");
  }
  if (options.output !== undefined && options.output.length === 0) {
    throw new Error("Output path must not be empty.");
  }

  const runs = parseAnsi(ansiText);
  const svg = renderSvg(runs, {
    padding: options.padding,
    window: options.window
  });
  const png = renderPng(svg);

  if (options.output !== undefined) {
    const temporaryPath = `${options.output}.${randomUUID()}.tmp`;
    let temporaryCreated = false;
    try {
      await writeFile(temporaryPath, png, { flag: "wx" });
      temporaryCreated = true;
      await rename(temporaryPath, options.output);
    } catch (error) {
      if (temporaryCreated || !isAlreadyExistsError(error)) {
        try {
          await rm(temporaryPath, { force: true });
        } catch (cleanupError) {
          void cleanupError;
        }
      }
      throw error;
    }
  }

  return png;
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && hasOwnErrorCode(error, "EEXIST");
}

export * from "./ansi-parser.js";
export * from "./font.js";
export * from "./png-renderer.js";
export * from "./svg-renderer.js";
