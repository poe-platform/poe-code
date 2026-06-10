import path from "node:path";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import type { ParsedDocument } from "./types.js";

export function parseDocument(content: string, filePath: string): ParsedDocument {
  const normalizedContent = stripBom(content);
  const format = detectFormat(normalizedContent, filePath);
  const data =
    format === "markdown"
      ? parseMarkdown(normalizedContent, filePath)
      : toData(
          format === "json" ? JSON.parse(normalizedContent) : (parseYaml(normalizedContent) ?? {}),
          filePath
        );
  const hasExtendsField = Object.hasOwn(data, "extends");
  const extendsValue = hasExtendsField ? data.extends : undefined;

  if (hasExtendsField && typeof extendsValue !== "boolean") {
    throw new Error(`Invalid extends value in ${filePath}: expected a boolean.`);
  }

  delete data.extends;

  return {
    data,
    format,
    extends: extendsValue === true,
    hasExtendsField
  };
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
  const document = matter(normalizeMarkdownLineEndings(content));
  return {
    ...toData(document.data, filePath),
    prompt: document.content
  };
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

  return { ...(value as Record<string, unknown>) };
}

function stripBom(content: string): string {
  if (!content.startsWith("\uFEFF")) {
    return content;
  }

  return content.slice(1);
}
