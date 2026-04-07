import path from "node:path";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import type { ParsedDocument } from "./types.js";

export function parseDocument(content: string, filePath: string): ParsedDocument {
  const normalizedContent = stripBom(content);
  const format = detectFormat(normalizedContent, filePath);
  const data =
    format === "markdown"
      ? parseMarkdown(normalizedContent)
      : toData(format === "json" ? JSON.parse(normalizedContent) : parseYaml(normalizedContent));
  const hasExtendsField = Object.hasOwn(data, "extends");
  const extendsValue = data.extends === true;

  delete data.extends;

  return {
    data,
    format,
    extends: extendsValue,
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

  if (content.startsWith("---\n") || content.startsWith("---\r\n")) {
    return "markdown";
  }

  return "yaml";
}

function parseMarkdown(content: string): Record<string, unknown> {
  const document = matter(content);
  return {
    ...toData(document.data),
    prompt: document.content
  };
}

function toData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function stripBom(content: string): string {
  if (!content.startsWith("\uFEFF")) {
    return content;
  }

  return content.slice(1);
}
