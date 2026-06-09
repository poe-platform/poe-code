import nodeFs from "node:fs/promises";
import path from "node:path";
import { UserError } from "toolcraft";
import { parse } from "toolcraft-design";
import { parseDocument } from "yaml";
import { getOwnErrorCode } from "../error-codes.js";
import { scanMarkdown, type Section } from "./scan.js";

export interface MarkdownReaderFs {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
}

const defaultFs: MarkdownReaderFs = {
  readFile(file, encoding) {
    return nodeFs.readFile(file, encoding);
  }
};

export interface MarkdownReaderDependencies {
  fs?: MarkdownReaderFs;
  cwd?: string;
}

export interface LoadedMarkdownDocument {
  frontmatter: Record<string, unknown>;
  sections: Section[];
  source: string;
}

export async function loadMarkdownDocument(
  file: string,
  dependencies: MarkdownReaderDependencies = {}
): Promise<LoadedMarkdownDocument> {
  const resolvedFile = resolveMarkdownPath(file, dependencies.cwd);
  const source = await readMarkdownFile(resolvedFile, file, dependencies.fs ?? defaultFs);
  const parsed = parse(source);
  const frontmatter = parsed.frontmatter ?? {};

  assertValidFrontmatter(source, file, frontmatter);

  return {
    frontmatter,
    sections: scanMarkdown(source),
    source
  };
}

export function resolveMarkdownPath(file: string, cwd = process.cwd()): string {
  return path.isAbsolute(file) ? file : path.resolve(cwd, file);
}

export function sliceMarkdownBytes(source: string, start: number, end: number): string {
  return Buffer.from(source, "utf8").subarray(start, end).toString("utf8");
}

async function readMarkdownFile(
  resolvedFile: string,
  originalFile: string,
  fs: MarkdownReaderFs
): Promise<string> {
  try {
    return await fs.readFile(resolvedFile, "utf8");
  } catch (error) {
    throw toUserError(error, originalFile);
  }
}

function assertValidFrontmatter(
  source: string,
  file: string,
  frontmatter: Record<string, unknown>
): void {
  const rawFrontmatter = getInvalidRawFrontmatter(frontmatter, source);

  if (rawFrontmatter === undefined) {
    return;
  }

  const document = parseDocument(rawFrontmatter, { prettyErrors: false });
  const reason = document.errors[0]?.message ?? "unsupported YAML frontmatter";

  throw new UserError(`invalid frontmatter in ${file}: ${reason}`);
}

function getInvalidRawFrontmatter(
  frontmatter: Record<string, unknown>,
  source: string
): string | undefined {
  const rawValue = frontmatter.raw;

  if (typeof rawValue !== "string" || Object.keys(frontmatter).length !== 1) {
    return undefined;
  }

  const yamlBlock = getLeadingFrontmatterBlock(source);

  if (yamlBlock === undefined) {
    return undefined;
  }

  const normalized = normalizeYamlBlock(yamlBlock);
  return normalized === normalizeYamlBlock(rawValue) ? normalized : undefined;
}

function getLeadingFrontmatterBlock(source: string): string | undefined {
  const start = source.startsWith("\uFEFF") ? 1 : 0;

  if (!source.startsWith("---", start)) {
    return undefined;
  }

  const openingFenceEnd = readLineEnd(source, start);

  if (openingFenceEnd.content !== "---") {
    return undefined;
  }

  let position = openingFenceEnd.next;

  while (position <= source.length) {
    const line = readLineEnd(source, position);

    if (line.content === "---") {
      return source.slice(openingFenceEnd.next, position);
    }

    if (line.next <= position) {
      break;
    }

    position = line.next;
  }

  return undefined;
}

function readLineEnd(source: string, start: number): { content: string; next: number } {
  let position = start;

  while (position < source.length) {
    const character = source[position];

    if (character === "\n") {
      return { content: source.slice(start, position), next: position + 1 };
    }

    if (character === "\r") {
      return {
        content: source.slice(start, position),
        next: source[position + 1] === "\n" ? position + 2 : position + 1
      };
    }

    position += 1;
  }

  return { content: source.slice(start), next: source.length + 1 };
}

function normalizeYamlBlock(value: string): string {
  let end = value.length;

  if (end > 0 && value[end - 1] === "\n") {
    end -= 1;
  }

  if (end > 0 && value[end - 1] === "\r") {
    end -= 1;
  }

  return value.slice(0, end);
}

function toUserError(error: unknown, file: string): UserError {
  if (error instanceof UserError) {
    return error;
  }

  const code = getOwnErrorCode(error);

  if (code === "ENOENT") {
    return new UserError(`file not found: ${file}`);
  }

  if (error instanceof Error) {
    return new UserError(error.message);
  }

  return new UserError(String(error));
}
