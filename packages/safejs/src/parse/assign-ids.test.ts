import { describe, expect, it } from "vitest";

import { assignIds } from "./assign-ids.js";
import { parseModule, type Module } from "./parser.js";
import { parse, type ParseResult } from "../parse.js";

const ASSIGN_IDS_PERFORMANCE_BUDGET_MS = process.env.CI === "true" ? 250 : 100;

type AstNode = {
  nodeId?: number;
  span: {
    start: {
      offset: number;
    };
    end: {
      offset: number;
    };
  };
  type: string;
  [key: string]: unknown;
};

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string" &&
    "span" in value
  );
}

type NodeRecord = {
  end: number;
  id: number;
  start: number;
  type: string;
};

type StableNodeRecord = {
  id: number;
  signature: string;
};

function collectNodeRecords(root: ParseResult): NodeRecord[] {
  const entries = collectNodesInIdOrder(root).map((node) => ({
    end: node.span.end.offset,
    id: node.nodeId!,
    start: node.span.start.offset,
    type: node.type
  }));

  expect(entries.map((entry) => entry.id)).toEqual(entries.map((_, index) => index));

  return entries;
}

function collectStableNodeRecords(root: Module | ParseResult): StableNodeRecord[] {
  return collectNodesInIdOrder(root).map((node) => ({
    id: node.nodeId!,
    signature: stableSignature(node)
  }));
}

function collectNodesInIdOrder(root: Module | ParseResult): AstNode[] {
  const entries: NodeRecord[] = [];
  const nodes: AstNode[] = [];
  const visited = new Set<AstNode>();
  const stack: AstNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || visited.has(node)) {
      continue;
    }

    visited.add(node);
    expect(node.nodeId).toEqual(expect.any(Number));
    nodes.push(node);
    entries.push({
      end: node.span.end.offset,
      id: node.nodeId!,
      start: node.span.start.offset,
      type: node.type
    });

    const children: AstNode[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (key === "nodeId" || key === "span" || key === "type") {
        continue;
      }

      if (isAstNode(value)) {
        children.push(value);
        continue;
      }

      if (!Array.isArray(value)) {
        continue;
      }

      for (const entry of value) {
        if (isAstNode(entry)) {
          children.push(entry);
        }
      }
    }

    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]!);
    }
  }

  nodes.sort((left, right) => left.nodeId! - right.nodeId!);
  entries.sort((left, right) => left.id - right.id);

  expect(entries.map((entry) => entry.id)).toEqual(entries.map((_, index) => index));

  return nodes;
}

function stableSignature(node: AstNode): string {
  const fields = Object.entries(node)
    .filter(([key, value]) => {
      if (key === "nodeId" || key === "span" || isAstNode(value) || Array.isArray(value)) {
        return false;
      }
      return true;
    })
    .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
    .sort()
    .join(",");

  return `${node.type}{${fields}}`;
}

function setStaleNodeIds(root: Module | ParseResult): void {
  for (const node of collectNodesInIdOrder(root)) {
    Object.defineProperty(node, "nodeId", {
      value: 999_999,
      writable: true,
      configurable: true,
      enumerable: false
    });
  }
}

function collectSpanReferences(root: Module | ParseResult): Array<{
  end: AstNode["span"]["end"];
  node: AstNode;
  span: AstNode["span"];
  start: AstNode["span"]["start"];
}> {
  return collectNodesInIdOrder(root).map((node) => ({
    end: node.span.end,
    node,
    span: node.span,
    start: node.span.start
  }));
}

function createLargeModule(totalNodeCount: number): Module {
  const statementCount = (totalNodeCount - 1) / 2;
  const body = Array.from({ length: statementCount }, (_, index) => {
    const start = index * 2;
    return {
      type: "ExpressionStatement" as const,
      expression: {
        type: "Identifier" as const,
        name: `value${index}`,
        span: {
          start: { line: index + 1, column: 1, offset: start },
          end: { line: index + 1, column: 7, offset: start + 6 }
        }
      },
      span: {
        start: { line: index + 1, column: 1, offset: start },
        end: { line: index + 1, column: 8, offset: start + 7 }
      }
    };
  });

  return {
    type: "Module",
    body,
    span: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: totalNodeCount, column: 1, offset: totalNodeCount * 2 }
    }
  };
}

function createDeepModule(totalNodeCount: number): Module {
  let expression: AstNode = {
    type: "Identifier",
    name: "value",
    span: {
      start: { line: 1, column: 1, offset: totalNodeCount },
      end: { line: 1, column: 6, offset: totalNodeCount + 5 }
    }
  };

  for (let index = totalNodeCount - 4; index >= 0; index -= 1) {
    expression = {
      type: "UnaryExpression",
      argument: expression,
      operator: "!",
      prefix: true,
      span: {
        start: { line: 1, column: 1, offset: index },
        end: { line: 1, column: 6, offset: totalNodeCount + 5 }
      }
    };
  }

  return {
    type: "Module",
    body: [
      {
        type: "ExpressionStatement",
        expression,
        span: expression.span
      }
    ],
    span: {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 6, offset: totalNodeCount + 5 }
    }
  } as Module;
}

function measureCpuMs(action: () => void): number {
  const start = process.cpuUsage();
  action();
  const elapsed = process.cpuUsage(start);
  return (elapsed.user + elapsed.system) / 1000;
}

describe("assignIds", () => {
  it("assigns IDs to function expressions and their children", () => {
    const root = parse("const f = function check(value) { return value; };");
    const records = collectNodeRecords(root);

    expect(records.map((record) => record.type)).toContain("FunctionExpression");
    expect(records.map((record) => record.type)).toContain("Identifier");
    expect(records.map((record) => record.id)).toEqual(records.map((_, index) => index));
  });
  it.each([
    "const { user = fallback, profile: { name }, ...rest } = config",
    "`prefix ${first} middle ${second}`",
    "({ a, a: alias = fallback, nested: { b }, ...rest }) => `${a}${alias}${b}${rest}`"
  ])("assigns stable ids for the same source across parse runs: %s", (source) => {
    expect(collectNodeRecords(parse(source))).toEqual(collectNodeRecords(parse(source)));
  });

  it("assigns ids throughout function declarations", () => {
    const nodes = collectNodesInIdOrder(
      parse("async function load(value = fallback) { return await task(value); }")
    );

    expect(nodes.map((node) => node.type)).toEqual([
      "FunctionDeclaration",
      "Identifier",
      "AssignmentPattern",
      "Identifier",
      "Identifier",
      "BlockStatement",
      "ReturnStatement",
      "AwaitExpression",
      "CallExpression",
      "Identifier",
      "Identifier"
    ]);
  });

  it("does not shift unrelated node ids when comments are added", () => {
    const base = parseModule("const first = 1;\nconst second = first + 2;");
    const withComment = parseModule("const first = 1;\n// comment\nconst second = first + 2;");

    expect(collectStableNodeRecords(withComment)).toEqual(collectStableNodeRecords(base));
  });

  it("does not shift node ids when whitespace is reformatted", () => {
    const compact = parseModule("const first=1;const second=first+2;");
    const formatted = parseModule("const first = 1;\n\nconst second = first + 2;");

    expect(collectStableNodeRecords(formatted)).toEqual(collectStableNodeRecords(compact));
  });

  it("appends new ids when a statement is added at the end", () => {
    const base = collectStableNodeRecords(
      parseModule("const first = 1;\nconst second = first + 2;")
    );
    const appended = collectStableNodeRecords(
      parseModule("const first = 1;\nconst second = first + 2;\nconst third = second + 3;")
    );

    expect(appended.slice(0, base.length)).toEqual(base);
    expect(appended.slice(base.length).map((entry) => entry.id)).toEqual(
      appended.slice(base.length).map((_, index) => base.length + index)
    );
  });

  it("renumbers following nodes when a statement is inserted at the beginning", () => {
    const base = collectStableNodeRecords(
      parseModule("const first = 1;\nconst second = first + 2;")
    );
    const prepended = collectStableNodeRecords(
      parseModule("const before = 0;\nconst first = 1;\nconst second = first + 2;")
    );
    const firstIdentifier = 'Identifier{name:"first",type:"Identifier"}';

    // Expected limitation: node ids are positional, so inserting before existing statements renumbers
    // later nodes. Snapshot restoration should not treat this as a stale-id resilience guarantee.
    expect(prepended.map((entry) => entry.signature)).toContain(firstIdentifier);
    expect(prepended.find((entry) => entry.signature === firstIdentifier)?.id).toBeGreaterThan(
      base.find((entry) => entry.signature === firstIdentifier)?.id ?? 0
    );
  });

  it("assigns ids to more than 10k AST nodes within the performance budget", () => {
    const module = createLargeModule(10_001);

    const elapsedMs = measureCpuMs(() => assignIds(module));

    expect(collectNodesInIdOrder(module)).toHaveLength(10_001);
    expect(elapsedMs).toBeLessThan(ASSIGN_IDS_PERFORMANCE_BUDGET_MS);
  });

  it("assigns ids to more than 20k deeply nested AST nodes within the performance budget", () => {
    const module = createDeepModule(20_001);

    const elapsedMs = measureCpuMs(() => assignIds(module));

    expect(collectNodesInIdOrder(module)).toHaveLength(20_001);
    expect(elapsedMs).toBeLessThan(ASSIGN_IDS_PERFORMANCE_BUDGET_MS);
  });

  it("overwrites stale pre-existing node ids", () => {
    const parsed = parseModule("const first = 1;\nconst second = first + 2;");
    setStaleNodeIds(parsed);

    assignIds(parsed);

    expect(collectNodesInIdOrder(parsed).map((node) => node.nodeId)).toEqual(
      collectNodesInIdOrder(parsed).map((_, index) => index)
    );
  });

  it("preserves span and loc fields untouched", () => {
    const parsed = parseModule("const first = 1;\nconst second = first + 2;");
    const spans = collectSpanReferences(parsed);

    assignIds(parsed);

    for (const { end, node, span, start } of spans) {
      expect(node.span).toBe(span);
      expect(node.span.start).toBe(start);
      expect(node.span.end).toBe(end);
    }
  });
});
