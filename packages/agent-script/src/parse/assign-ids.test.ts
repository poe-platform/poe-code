import { describe, expect, it } from "vitest";

import { parse, type ParseResult } from "../parse.js";

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

function collectNodeRecords(root: ParseResult): NodeRecord[] {
  const entries: NodeRecord[] = [];
  const visited = new Set<AstNode>();
  const stack: AstNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || visited.has(node)) {
      continue;
    }

    visited.add(node);
    expect(node.nodeId).toEqual(expect.any(Number));
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

  entries.sort((left, right) => left.id - right.id);

  expect(entries.map((entry) => entry.id)).toEqual(entries.map((_, index) => index));

  return entries;
}

describe("assignIds", () => {
  it.each([
    "const { user = fallback, profile: { name }, ...rest } = config",
    "`prefix ${first} middle ${second}`",
    "({ a, a: alias = fallback, nested: { b }, ...rest }) => `${a}${alias}${b}${rest}`"
  ])("assigns stable ids for the same source across parse runs: %s", (source) => {
    expect(collectNodeRecords(parse(source))).toEqual(collectNodeRecords(parse(source)));
  });
});
