import fs from "node:fs/promises";
import { inspectOpenApiDocument, type OpenApiInspectionReport } from "./inspect.js";
import type { OpenApiDocument } from "./generate.js";
import {
  parseOpenApiDocument,
  readOpenApiSourceText,
  type OpenApiSourceFileSystem
} from "./spec-source.js";

export type OpenApiInspectionSource = OpenApiDocument | string | URL;

export interface InspectOpenApiSourceOptions {
  cwd?: string;
  fetch?: typeof globalThis.fetch;
  fs?: OpenApiSourceFileSystem;
}

export async function inspectOpenApiSource(
  source: OpenApiInspectionSource,
  options: InspectOpenApiSourceOptions = {}
): Promise<OpenApiInspectionReport> {
  if (typeof source !== "string" && !(source instanceof URL)) {
    return inspectOpenApiDocument(source);
  }

  const sourceText = await readOpenApiSourceText(source, {
    cwd: options.cwd ?? process.cwd(),
    fetch: options.fetch ?? globalThis.fetch,
    fs: options.fs ?? fs
  });

  return inspectOpenApiDocument(parseOpenApiDocument(sourceText, source));
}
