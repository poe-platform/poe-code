import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();

async function parseSource(relPath: string): Promise<ts.SourceFile> {
  const filePath = path.join(root, relPath);
  return ts.createSourceFile(
    filePath,
    await readFile(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function getPropertyNames(object: ts.ObjectLiteralExpression): Set<string> {
  const names = new Set<string>();

  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      continue;
    }

    const name = property.name;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
      names.add(name.text);
    }
  }

  return names;
}

function getDefineCommandConfigs(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression[] {
  const configs: ts.ObjectLiteralExpression[] = [];

  walk(sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineCommand" &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      configs.push(node.arguments[0]);
    }
  });

  return configs;
}

function getServerToolCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];

  walk(sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "tool"
    ) {
      calls.push(node);
    }
  });

  return calls;
}

describe("MCP typed output cleanup guard", () => {
  it.each([
    "packages/markdown-reader/src/mcp/tools.ts",
    "packages/terminal-pilot-mcp/src/index.ts",
  ])("%s defineCommand MCP tools declare result schemas", async (relPath) => {
    const sourceFile = await parseSource(relPath);
    const configs = getDefineCommandConfigs(sourceFile);

    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      const properties = getPropertyNames(config);
      expect(properties.has("result"), relPath).toBe(true);
    }
  });

  it.each([
    "packages/memory/src/mcp.ts",
    "packages/superintendent/src/mcp.ts",
  ])("%s server.tool registrations pass output schemas", async (relPath) => {
    const sourceFile = await parseSource(relPath);
    const calls = getServerToolCalls(sourceFile);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.arguments.length, relPath).toBeGreaterThanOrEqual(5);
    }
  });
});
