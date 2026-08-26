import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const explorerDir = path.resolve(import.meta.dirname);
const srcDir = path.resolve(explorerDir, "..");

const importPattern = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g;
const leafModules = new Set([
  "actions.ts",
  "filter.ts",
  "jobs.ts",
  "keymap.ts",
  "layout.ts",
  "theme.ts"
]);
const reducerAllowed = new Set(["actions.ts", "events.ts", "filter.ts", "keymap.ts", "state.ts", "dashboard/terminal-width.ts"]);
const renderAllowed = new Set([
  "layout.ts",
  "state.ts",
  "theme.ts",
  "dashboard/ansi.ts",
  "dashboard/buffer.ts",
  "dashboard/terminal-width.ts",
  "dashboard/types.ts",
  "screen/screen.ts",
  "screen/ansi-text.ts",
  "internal/strip-ansi.ts",
  "terminal-markdown/index.ts"
]);
const leafAllowed = new Set(["events.ts", "state.ts"]);

interface ImportEdge {
  source: string;
  target: string;
  typeOnly: boolean;
}

describe("explorer import boundaries", () => {
  it("keeps explorer modules within the section 4.2 boundaries", async () => {
    const files = await listSourceFiles(explorerDir);
    const violations = (await Promise.all(files.map(readImportEdges))).flat().flatMap(validateEdge);

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("parses multiline imports and import-kind edge cases", () => {
    const edges = parseImportEdges(
      path.join(explorerDir, "reducer.ts"),
      "reducer.ts",
      [
        'import type { Effect, ExplorerEvent } from "./events.js";',
        'import { type FilterMatch, filterRows } from "./filter.js";',
        "import {",
        "  REGION_ALL,",
        "  type ExplorerState",
        '} from "./state.js";',
        'import { stripAnsi } from "../internal/strip-ansi.js";'
      ].join("\n")
    );

    expect(edges).toEqual([
      { source: "reducer.ts", target: "events.ts", typeOnly: true },
      { source: "reducer.ts", target: "filter.ts", typeOnly: false },
      { source: "reducer.ts", target: "state.ts", typeOnly: false },
      { source: "reducer.ts", target: "internal/strip-ansi.ts", typeOnly: false }
    ]);
  });

  it("excludes tests and test helper files from the source graph", () => {
    expect(isTestFile("runtime.test.ts")).toBe(true);
    expect(isTestFile("runtime.test-helpers.ts")).toBe(true);
    expect(isTestFile("test-fixtures.ts")).toBe(true);
    expect(isTestFile("runtime.ts")).toBe(false);
  });
});

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listSourceFiles(fullPath);
      }

      return entry.isFile() && entry.name.endsWith(".ts") && !isTestFile(entry.name)
        ? [fullPath]
        : [];
    })
  );

  return files.flat().sort();
}

function isTestFile(fileName: string): boolean {
  return fileName.includes(".test.") || fileName.includes(".test-") || fileName.startsWith("test-");
}

async function readImportEdges(filePath: string): Promise<ImportEdge[]> {
  const source = explorerRelative(filePath);
  return parseImportEdges(filePath, source, await readFile(filePath, "utf8"));
}

function parseImportEdges(filePath: string, source: string, contents: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const matches = contents.matchAll(importPattern);

  for (const match of matches) {
    const target = resolveImportTarget(filePath, source, match[2]!);
    if (target === null) {
      continue;
    }

    edges.push({
      source,
      target,
      typeOnly: isTypeOnlyImport(match[1]!)
    });
  }

  return edges;
}

function validateEdge(edge: ImportEdge): string[] {
  if (edge.source === "runtime.ts") {
    return [];
  }

  if (edge.source.startsWith("render/")) {
    if (edge.target.startsWith("render/") || renderAllowed.has(edge.target)) {
      return [];
    }

    return [
      formatViolation(
        edge,
        "render modules may only import render siblings or the explorer rendering layers"
      )
    ];
  }

  if (edge.source === "reducer.ts") {
    return reducerAllowed.has(edge.target)
      ? []
      : [
          formatViolation(edge, "reducer may only import state, events, actions, keymap, or filter")
        ];
  }

  if (edge.source === "theme.ts" && edge.target === "internal/theme-detect.ts") {
    return [];
  }

  if (leafModules.has(edge.source)) {
    return leafAllowed.has(edge.target) && edge.typeOnly
      ? []
      : [formatViolation(edge, "leaf modules may only type-import state or events")];
  }

  return [];
}

function resolveImportTarget(filePath: string, source: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const resolved = path.resolve(path.dirname(filePath), specifier).replace(/\.js$/, ".ts");
  const explorerRelativePath = relativeIfInside(explorerDir, resolved);
  if (explorerRelativePath !== null) {
    return explorerRelativePath;
  }

  const srcRelativePath = relativeIfInside(srcDir, resolved);
  return srcRelativePath;
}

function relativeIfInside(root: string, filePath: string): string | null {
  const relativePath = path.relative(root, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return relativePath.split(path.sep).join("/");
}

function explorerRelative(filePath: string): string {
  return relativeIfInside(explorerDir, filePath) ?? filePath;
}

function isTypeOnlyImport(importClause: string): boolean {
  if (importClause.startsWith("type ")) {
    return true;
  }

  if (importClause.startsWith("{") && importClause.endsWith("}")) {
    return importClause
      .slice(1, -1)
      .split(",")
      .map((specifier) => specifier.trim())
      .every((specifier) => specifier.startsWith("type "));
  }

  return false;
}

function formatViolation(edge: ImportEdge, reason: string): string {
  const kind = edge.typeOnly ? "type import" : "runtime import";
  return `${edge.source} -> ${edge.target} (${kind}): ${reason}`;
}
