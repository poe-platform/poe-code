import path from "node:path";
import { FrontmatterParseError, parseFrontmatter } from "@poe-code/frontmatter";
import { parse as parseYaml } from "yaml";
import type { ParsedDocument } from "./types.js";

export function parseDocument(content: string, filePath: string): ParsedDocument {
  const normalizedContent = stripBom(content);
  const format = detectFormat(normalizedContent, filePath);
  const data =
    format === "markdown"
      ? parseMarkdown(normalizedContent, filePath)
      : toData(
          format === "json"
            ? parseJson(normalizedContent, filePath)
            : (parseYaml(normalizedContent) ?? {}),
          filePath
        );
  const hasExtendsField = Object.hasOwn(data, "extends");
  const extendsValue = hasExtendsField ? data.extends : undefined;
  const parsedExtends = parseExtendsValue(extendsValue, hasExtendsField, filePath);

  delete data.extends;

  return {
    data,
    format,
    extends: parsedExtends,
    hasExtendsField
  };
}

function parseExtendsValue(
  value: unknown,
  hasExtendsField: boolean,
  filePath: string
): ParsedDocument["extends"] {
  if (!hasExtendsField || value === false || value === undefined) {
    return false;
  }

  if (value === true) {
    return true;
  }

  if (typeof value !== "string") {
    throw new Error(
      `Invalid extends value in ${filePath}: expected a boolean or relative string path.`
    );
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`Invalid extends value in ${filePath}: expected a non-empty relative path.`);
  }

  if (path.isAbsolute(trimmedValue)) {
    throw new Error(`Invalid extends value in ${filePath}: expected a relative path.`);
  }

  return trimmedValue;
}

function detectFormat(
  content: string,
  filePath: string
): ParsedDocument["format"] {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".md") {
    return "markdown";
  }

  if (extension === ".yaml" || extension === ".yml") {
    return "yaml";
  }

  if (extension === ".json") {
    return "json";
  }

  if (content.startsWith("{")) {
    return "json";
  }

  if (content.startsWith("---\n") || content.startsWith("---\r\n") || content.startsWith("---\r")) {
    return "markdown";
  }

  return "yaml";
}

function parseMarkdown(content: string, filePath: string): Record<string, unknown> {
  let document;

  try {
    document = parseFrontmatter(normalizeMarkdownLineEndings(content));
  } catch (error) {
    if (
      error instanceof FrontmatterParseError &&
      error.message === "Missing YAML frontmatter end delimiter (---)."
    ) {
      return { prompt: content };
    }

    throw error;
  }

  const data = toData(document.frontmatter, filePath);
  if (document.body !== "" || !Object.hasOwn(data, "prompt")) {
    return {
      ...data,
      prompt: document.body
    };
  }

  return data;
}

function parseJson(content: string, filePath: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Invalid JSON configuration in ${filePath}: ${message}`);
  }
}

function normalizeMarkdownLineEndings(content: string): string {
  let normalized = "";

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === "\r" && content[index + 1] !== "\n") {
      normalized += "\n";
      continue;
    }

    normalized += character;
  }

  return normalized;
}

function toData(value: unknown, filePath: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid configuration in ${filePath}: expected an object root.`);
  }

  return {
    ...(value as Record<string, unknown>)
  };
}

function stripBom(content: string): string {
  if (!content.startsWith("\uFEFF")) {
    return content;
  }

  return content.slice(1);
}
