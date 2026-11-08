import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The human-in-loop runtime (and its @poe-code/task-list storage) must only load
 * through the `toolcraft/human-in-loop` export. Core entrypoints ship to every
 * consumer, so a runtime import here reintroduces the #517 class of failure:
 * generated servers crashing on code paths they never opted into.
 */
const ENTRYPOINTS = ["index.ts", "cli.ts", "mcp.ts", "sdk.ts", "http.ts"];

const FORBIDDEN_BARE_IMPORTS = ["@poe-code/task-list", "@poe-code/agent-human-in-loop"];

const FORBIDDEN_MODULES = [
  "human-in-loop/gate.ts",
  "human-in-loop/approval-tasks.ts",
  "human-in-loop/approvals-commands.ts",
  "human-in-loop/runner.ts",
  "human-in-loop/spawn.ts",
  "human-in-loop/default-provider.ts",
  "human-in-loop/runtime.ts",
  "human-in-loop/runtime-options.ts",
  "human-in-loop/index.ts",
  "human-in-loop/state-machine.ts"
];

const srcDir = path.dirname(fileURLToPath(import.meta.url));

function collectRuntimeImports(filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    false
  );
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return;
    }

    if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return;
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return specifiers;
}

function resolveRelative(fromFile: string, specifier: string): string {
  const resolved = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ".ts"));
  return resolved;
}

function walkImportGraph(entrypoint: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const queue = [path.join(srcDir, entrypoint)];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) {
      continue;
    }
    files.add(file);

    for (const specifier of collectRuntimeImports(file)) {
      if (specifier.startsWith(".")) {
        queue.push(resolveRelative(file, specifier));
      } else {
        bare.add(specifier);
      }
    }
  }

  return { files, bare };
}

describe("core entrypoints do not load the human-in-loop runtime", () => {
  for (const entrypoint of ENTRYPOINTS) {
    it(`${entrypoint} import graph stays clear of the runtime and task-list`, () => {
      const { files, bare } = walkImportGraph(entrypoint);

      for (const forbidden of FORBIDDEN_BARE_IMPORTS) {
        expect([...bare].filter((specifier) => specifier.startsWith(forbidden))).toEqual([]);
      }

      const relativeFiles = [...files].map((file) => path.relative(srcDir, file));
      for (const forbidden of FORBIDDEN_MODULES) {
        expect(relativeFiles).not.toContain(forbidden);
      }
    });
  }
});
