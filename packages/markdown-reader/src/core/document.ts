import { createDefaultFileSystem } from "#markdown-reader-filesystem";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { posixPath as path } from "@poe-code/safe-fs/contracts";
import { FrontmatterParseError, parseFrontmatter } from "@poe-code/frontmatter";
import { UserError } from "toolcraft/user-error";
import { getOwnErrorCode } from "../error-codes.js";
import { scanMarkdown, type Section } from "./scan.js";

export interface MarkdownReaderFs {
  readFile(path: string, encoding: "utf8"): Promise<string>;
}

export interface MarkdownReaderDependencies {
  fs?: MarkdownReaderFs | Pick<FileSystem, "capabilities" | "readFile">;
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
  const source = await readMarkdownFile(resolvedFile, file, dependencies.fs ?? createDefaultFileSystem());
  const frontmatter = readFrontmatter(source, file);

  return {
    frontmatter,
    sections: scanMarkdown(source),
    source
  };
}

export function resolveMarkdownPath(file: string, cwd = globalThis.process?.cwd?.() ?? "/"): string {
  if (file.trim().length === 0) {
    throw new UserError("invalid file: expected a non-empty path");
  }

  return path.isAbsolute(file) ? file : path.resolve(cwd, file);
}

export function sliceMarkdownBytes(source: string, start: number, end: number): string {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(source).subarray(start, end));
}

async function readMarkdownFile(
  resolvedFile: string,
  originalFile: string,
  fs: NonNullable<MarkdownReaderDependencies["fs"]>
): Promise<string> {
  try {
    return "capabilities" in fs
      ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(await fs.readFile(resolvedFile))
      : await fs.readFile(resolvedFile, "utf8");
  } catch (error) {
    throw toUserError(error, originalFile);
  }
}

function readFrontmatter(source: string, file: string): Record<string, unknown> {
  try {
    return parseFrontmatter(source).frontmatter;
  } catch (error) {
    if (error instanceof FrontmatterParseError) {
      if (
        error.message === "Missing YAML frontmatter end delimiter (---)." &&
        !hasYamlLikeLeadingFrontmatter(source)
      ) {
        return {};
      }

      throw new UserError(`invalid frontmatter in ${file}: ${error.message}`);
    }

    throw error;
  }
}

function hasYamlLikeLeadingFrontmatter(source: string): boolean {
  const content = source.startsWith("\uFEFF") ? source.slice(1) : source;

  if (!content.startsWith("---")) {
    return false;
  }

  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");

  if (lines[0] !== "---") {
    return false;
  }

  if (lines[1]?.trim().length === 0) {
    return false;
  }

  for (const line of lines.slice(1)) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    return trimmed.includes(":");
  }

  return false;
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
