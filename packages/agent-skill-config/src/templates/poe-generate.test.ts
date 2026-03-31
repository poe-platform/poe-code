import fs from "node:fs/promises";
import { describe, expect, it } from "bun:test";

function normalizeNewlines(value: string): string {
  return value.replaceAll("\r\n", "\n");
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYamlFrontmatter(markdown: string): Record<string, string> {
  const normalized = normalizeNewlines(markdown);
  const lines = normalized.split("\n");

  if (lines.length === 0 || lines[0] !== "---") {
    throw new Error("Missing YAML frontmatter start delimiter (---).");
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    throw new Error("Missing YAML frontmatter end delimiter (---).");
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const result: Record<string, string> = {};
  for (const rawLine of frontmatterLines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      throw new Error(`Invalid frontmatter line: "${rawLine}"`);
    }
    const key = line.slice(0, colonIndex).trim();
    const value = stripQuotes(line.slice(colonIndex + 1).trim());
    if (key.length === 0) {
      throw new Error(`Invalid frontmatter key in line: "${rawLine}"`);
    }
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`Duplicate frontmatter key: "${key}"`);
    }
    result[key] = value;
  }

  return result;
}

function extractBodyAfterFrontmatter(markdown: string): string {
  const normalized = normalizeNewlines(markdown);
  const lines = normalized.split("\n");

  if (lines.length === 0 || lines[0] !== "---") {
    return normalized;
  }

  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      return lines.slice(i + 1).join("\n");
    }
  }

  return "";
}

describe("bundled skill template: poe-generate.md", () => {
  it("renders valid markdown with YAML frontmatter", async () => {
    const templateUrl = new URL("./poe-generate.md", import.meta.url);
    const template = await fs.readFile(templateUrl, "utf8");

    const frontmatter = parseYamlFrontmatter(template);
    expect(frontmatter).toMatchObject({
      name: "poe-generate",
      description: "Poe code generation skill"
    });

    const body = extractBodyAfterFrontmatter(template);
    expect(body.trim().length).toBeGreaterThan(0);
    expect(body).toContain("poe-code generate");
  });

  it("fails validation when frontmatter is malformed", () => {
    expect(() =>
      parseYamlFrontmatter(["---", "name: poe-generate"].join("\n"))
    ).toThrow("Missing YAML frontmatter end delimiter");
  });
});
