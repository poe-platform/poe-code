import { describe, expect, it, vi } from "vitest";

import {
  parse,
  type AssignmentExpression,
  type ParseResult,
  type VariableDeclaration
} from "../parse.js";
import { bindPattern, type PatternContext } from "./patterns.js";
import { Scope } from "./scope.js";

function declarationPattern(source: string): VariableDeclaration["declarations"][number]["id"] {
  const node = parse(source);
  if (node.type !== "VariableDeclaration") {
    throw new TypeError("Expected variable declaration.");
  }
  return node.declarations[0].id;
}

function assignmentPattern(source: string): AssignmentExpression["left"] {
  const node = parse(source);
  if (node.type !== "AssignmentExpression") {
    throw new TypeError("Expected assignment expression.");
  }
  return node.left;
}

function normal(value: unknown) {
  return {
    kind: "normal" as const,
    hasValue: true as const,
    value
  };
}

function context(
  evaluate: (node: ParseResult) => ReturnType<typeof normal> = () => normal(undefined)
): PatternContext & { evaluate: ReturnType<typeof vi.fn> } {
  return {
    evaluate: vi.fn(async (node: ParseResult) => evaluate(node))
  };
}

describe("bindPattern", () => {
  it("declares identifier bindings", async () => {
    const scope = new Scope();

    await expect(
      bindPattern(
        declarationPattern("const item = source"),
        42,
        { kind: "const" },
        scope,
        context()
      )
    ).resolves.toEqual({ ok: true });

    expect(scope.lookup("item")).toMatchObject({ found: true, kind: "const", value: 42 });
  });

  it("binds nested object and array patterns with elisions and rest values", async () => {
    const scope = new Scope();
    const pattern = declarationPattern("const { item: [, first, ...remaining], ...meta } = source");

    await expect(
      bindPattern(
        pattern,
        { item: [0, 1, 2, 3], label: "example" },
        { kind: "const" },
        scope,
        context()
      )
    ).resolves.toEqual({ ok: true });

    expect(scope.snapshot()).toEqual({
      bindings: {
        first: 1,
        remaining: [2, 3],
        meta: { label: "example" }
      }
    });
  });

  it("evaluates defaults only for undefined values", async () => {
    const scope = new Scope();
    const pattern = declarationPattern("const [missing = fallback, present = fallback] = source");
    const patternContext = context(() => normal(7));

    await bindPattern(pattern, [undefined, null], { kind: "let" }, scope, patternContext);

    expect(scope.lookup("missing")).toMatchObject({ found: true, value: 7 });
    expect(scope.lookup("present")).toMatchObject({ found: true, value: null });
    expect(patternContext.evaluate).toHaveBeenCalledOnce();
  });

  it("supports string array destructuring and rejects unsupported iterables", async () => {
    const scope = new Scope();
    const pattern = declarationPattern("const [first, ...remaining] = source");

    await bindPattern(pattern, "abc", { kind: "const" }, scope, context());

    expect(scope.lookup("first")).toMatchObject({ found: true, value: "a" });
    expect(scope.lookup("remaining")).toMatchObject({ found: true, value: ["b", "c"] });
    await expect(
      bindPattern(pattern, new Set([1, 2]) as never, { kind: "const" }, new Scope(), context())
    ).rejects.toThrow(
      "Array destructuring declarations support only arrays and strings; received Set."
    );
  });

  it("evaluates computed object keys and excludes them from object rest", async () => {
    const scope = new Scope();
    const pattern = declarationPattern("const { [key]: selected, ...remaining } = source");
    const patternContext = context(() => normal("chosen"));

    await bindPattern(pattern, { chosen: 1, other: 2 }, { kind: "const" }, scope, patternContext);

    expect(scope.lookup("selected")).toMatchObject({ found: true, value: 1 });
    expect(scope.lookup("remaining")).toMatchObject({ found: true, value: { other: 2 } });
    expect(patternContext.evaluate).toHaveBeenCalledOnce();
  });

  it("propagates abrupt completion from default and computed-key evaluation", async () => {
    const completion = {
      kind: "completion" as const,
      result: normal("stopped")
    };
    const patternContext: PatternContext = {
      evaluate: vi.fn(async () => completion)
    };

    await expect(
      bindPattern(
        declarationPattern("const [item = fallback] = source"),
        [],
        { kind: "const" },
        new Scope(),
        patternContext
      )
    ).resolves.toEqual({ ok: false, result: completion });
    await expect(
      bindPattern(
        declarationPattern("const { [key]: item } = source"),
        {},
        { kind: "const" },
        new Scope(),
        patternContext
      )
    ).resolves.toEqual({ ok: false, result: completion });
  });

  it("assigns nested patterns to existing bindings and member targets", async () => {
    const target = { value: 0, nested: [0] };
    const scope = new Scope();
    scope.declare("first", "let", 0);
    scope.declare("remaining", "let", []);
    scope.declare("target", "const", target);
    scope.declare("property", "const", "value");
    const pattern = assignmentPattern(
      "[first, target[property], target.nested[0], ...remaining] = source"
    );
    const evaluate = (node: ParseResult): ReturnType<typeof normal> => {
      if (node.type === "MemberExpression") {
        const object = evaluate(node.object).value as Record<string | number, unknown>;
        const property = node.computed
          ? evaluate(node.property).value
          : node.property.type === "Identifier"
            ? node.property.name
            : node.property.value;
        if (typeof property !== "string" && typeof property !== "number") {
          throw new TypeError("Expected a property key.");
        }
        return normal(object[property]);
      }
      if (node.type === "NumericLiteral" || node.type === "StringLiteral") {
        return normal(node.value);
      }
      if (node.type !== "Identifier") {
        throw new TypeError(`Unexpected evaluation node '${node.type}'.`);
      }
      const binding = scope.lookup(node.name);
      if (!binding.found) {
        throw new ReferenceError(node.name);
      }
      return normal(binding.value);
    };
    const patternContext = context(evaluate);

    await expect(
      bindPattern(pattern, [1, 2, 3, 4, 5], { assign: true }, scope, patternContext)
    ).resolves.toEqual({ ok: true });

    expect(scope.lookup("first")).toMatchObject({ found: true, value: 1 });
    expect(scope.lookup("remaining")).toMatchObject({ found: true, value: [4, 5] });
    expect(target).toEqual({ value: 2, nested: [3] });
  });

  it("assigns array and object patterns to existing bindings", async () => {
    const scope = new Scope();
    scope.declare("left", "let", 1);
    scope.declare("right", "let", 2);
    scope.declare("selected", "let", 0);

    await expect(
      bindPattern(
        assignmentPattern("[left, right] = source"),
        [2, 1],
        { assign: true },
        scope,
        context()
      )
    ).resolves.toEqual({ ok: true });
    await expect(
      bindPattern(
        assignmentPattern("({ value: selected } = source)"),
        { value: 3 },
        { assign: true },
        scope,
        context()
      )
    ).resolves.toEqual({ ok: true });

    expect(scope.lookup("left")).toMatchObject({ found: true, value: 2 });
    expect(scope.lookup("right")).toMatchObject({ found: true, value: 1 });
    expect(scope.lookup("selected")).toMatchObject({ found: true, value: 3 });
  });

  it("rejects undeclared and const assignment bindings", async () => {
    const scope = new Scope();
    scope.declare("fixed", "const", 1);

    await expect(
      bindPattern(assignmentPattern("[missing] = source"), [2], { assign: true }, scope, context())
    ).rejects.toThrow("Cannot assign to undeclared binding 'missing'.");
    await expect(
      bindPattern(assignmentPattern("[fixed] = source"), [2], { assign: true }, scope, context())
    ).rejects.toThrow("Cannot assign to const 'fixed'");
  });

  it("rejects null object sources and invalid member targets", async () => {
    await expect(
      bindPattern(
        declarationPattern("const { item } = source"),
        null,
        { kind: "const" },
        new Scope(),
        context()
      )
    ).rejects.toThrow("Object destructuring declarations require a non-null object value.");

    const scope = new Scope();
    scope.declare("target", "const", null);
    const patternContext = context(() => normal(null));
    await expect(
      bindPattern(
        assignmentPattern("[target.value] = source"),
        [1],
        { assign: true },
        scope,
        patternContext
      )
    ).rejects.toThrow("Cannot assign properties of null or undefined.");
  });
});
