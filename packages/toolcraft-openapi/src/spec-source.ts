import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { UserError } from "toolcraft";
import type { OpenApiDocument } from "./generate.js";

export interface OpenApiSourceFileSystem {
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
}

export interface OpenApiSourceServices {
  cwd: string;
  fetch: typeof globalThis.fetch;
  fs: OpenApiSourceFileSystem;
}

export async function readOpenApiSourceText(
  input: string | URL,
  services: OpenApiSourceServices
): Promise<string> {
  const inputUrl = input instanceof URL ? input : tryParseUrl(input);
  const sourceLabel = formatSourceLabel(input);

  try {
    if (typeof input === "string" && inputUrl === null) {
      return await services.fs.readFile(path.resolve(services.cwd, input), "utf8");
    }

    if (inputUrl === null) {
      throw new UserError(`Unsupported OpenAPI input ${JSON.stringify(sourceLabel)}.`);
    }

    if (inputUrl.protocol === "file:") {
      return await services.fs.readFile(fileURLToPath(inputUrl), "utf8");
    }

    if (inputUrl.protocol !== "http:" && inputUrl.protocol !== "https:") {
      throw new UserError(`Unsupported OpenAPI input URL protocol ${JSON.stringify(inputUrl.protocol)}.`);
    }

    const response = await services.fetch(inputUrl.toString());

    if (!response.ok) {
      throw new UserError(
        `Failed to fetch ${JSON.stringify(inputUrl.toString())}: ${response.status} ${response.statusText}`
      );
    }

    return await response.text();
  } catch (error) {
    if (error instanceof UserError) {
      throw error;
    }

    throw new UserError(
      `Failed to read OpenAPI document ${JSON.stringify(sourceLabel)}: ${getErrorMessage(error)}`
    );
  }
}

export function parseOpenApiDocument(sourceText: string, input: string | URL): OpenApiDocument {
  let parsed: unknown;

  try {
    parsed = parseYaml(sourceText);
  } catch (error) {
    throw new UserError(
      `Failed to parse OpenAPI document ${JSON.stringify(formatSourceLabel(input))}: ${getErrorMessage(error)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UserError(
      `OpenAPI document ${JSON.stringify(formatSourceLabel(input))} must parse to an object.`
    );
  }

  return parsed as OpenApiDocument;
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function formatSourceLabel(source: string | URL): string {
  return source instanceof URL ? source.toString() : source;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
