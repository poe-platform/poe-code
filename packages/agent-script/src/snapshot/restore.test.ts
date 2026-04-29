import { describe, expect, it } from "vitest";

import { Budget } from "../interp/budget.js";
import { isSandboxPromise, createSandboxClosure } from "../interp/values.js";
import { parseModule, type Module, type ParseResult } from "../parse/parser.js";
import { hashSource } from "../parse/hash.js";
import { restore } from "./restore.js";

describe("snapshot restore", () => {
  it("rebuilds scopes, call stack, modules, and the saved code pointer", async () => {
    const source = [
      'import * as time from "time";',
      "const closure = async () => base;",
      "await time.now();"
    ].join("\n");
    const module = parseModule(source);
    const closureNodeId = getNodeIdByType(module, "ArrowFunctionExpression");
    const awaitNodeId = getNodeIdByType(module, "AwaitExpression");
    const budget = new Budget();
    const controller = new AbortController();

    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId: awaitNodeId,
        scopeChain: [
          {
            id: "module",
            bindings: {
              base: 41,
              closure: {
                kind: "fn",
                astNodeId: closureNodeId,
                capturedScopeId: "module"
              },
              values: [
                "ok",
                {
                  kind: "undefined"
                }
              ]
            }
          }
        ],
        callStack: [
          {
            astNodeId: awaitNodeId,
            scopeId: "module",
            awaitingPromiseId: "promise-1"
          }
        ],
        pendingPromises: [
          {
            id: "promise-1",
            moduleId: "time",
            state: "pending",
            result: {
              kind: "undefined"
            }
          }
        ],
        moduleBindings: {
          time: "time"
        }
      },
      {
        source,
        modules: {
          time: {
            now: createSandboxClosure({
              async: true,
              call: () => 123
            })
          }
        },
        budget,
        signal: controller.signal
      }
    );

    expect(restored.sourceHash).toBe(hashSource(source));
    expect(restored.currentNode.nodeId).toBe(awaitNodeId);
    expect(restored.currentNode.type).toBe("AwaitExpression");
    expect(restored.budget).toBe(budget);
    expect(restored.signal).toBe(controller.signal);
    expect(restored.callStack).toHaveLength(1);
    expect(restored.callStack[0]).toMatchObject({
      astNodeId: awaitNodeId,
      scopeId: "module",
      awaitingPromiseId: "promise-1"
    });
    expect(restored.callStack[0]?.node.nodeId).toBe(awaitNodeId);
    expect(restored.callStack[0]?.scope).toBe(restored.currentScope);
    expect(restored.callStack[0]?.awaitingPromise).toBe(restored.pendingPromises[0]);
    expect(restored.pendingPromises).toEqual([
      {
        id: "promise-1",
        moduleId: "time",
        state: "pending",
        result: undefined
      }
    ]);

    const base = restored.currentScope.lookup("base");
    expect(base).toMatchObject({
      found: true,
      value: 41
    });

    const values = restored.currentScope.lookup("values");
    expect(values).toMatchObject({
      found: true,
      value: ["ok", undefined]
    });

    const time = restored.currentScope.lookup("time");
    expect(time.found).toBe(true);
    if (!time.found) {
      return;
    }
    expect(Object.getPrototypeOf(time.value)).toBeNull();
    expect(time.value.now).toMatchObject({
      kind: "fn"
    });

    const closure = restored.currentScope.lookup("closure");
    expect(closure.found).toBe(true);
    if (!closure.found) {
      return;
    }
    expect(closure.value).toMatchObject({
      kind: "fn",
      astNodeId: closureNodeId,
      capturedScopeId: "module"
    });

    const promise = closure.value.call?.([]);
    expect(isSandboxPromise(promise)).toBe(true);
    if (!isSandboxPromise(promise)) {
      return;
    }
    await expect(promise.promise).resolves.toBe(41);
  });

  it("rejects snapshots whose source hash no longer matches the reparsed source", () => {
    const snapshot = {
      sourceHash: hashSource("await task()"),
      currentAstNodeId: 1,
      scopeChain: [],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    };

    expect(() =>
      restore(snapshot, {
        source: "await otherTask()",
        budget: new Budget()
      })
    ).toThrowError(
      `source changed since snapshot was taken (hash ${snapshot.sourceHash} expected, got ${hashSource("await otherTask()")}); pass --reset to discard`
    );
  });

  it("rejects snapshots when a saved module is no longer registered", () => {
    const source = 'import * as time from "time"; await time.now();';
    const awaitNodeId = getNodeIdByType(parseModule(source), "AwaitExpression");

    expect(() =>
      restore(
        {
          sourceHash: hashSource(source),
          currentAstNodeId: awaitNodeId,
          scopeChain: [
            {
              id: "module",
              bindings: {}
            }
          ],
          callStack: [],
          pendingPromises: [],
          moduleBindings: {
            time: "time"
          }
        },
        {
          source,
          budget: new Budget()
        }
      )
    ).toThrowError("Unknown module 'time'. No modules are registered.");
  });

  it("rejects snapshots when the saved code pointer no longer resolves", () => {
    const source = "await task()";

    expect(() =>
      restore(
        {
          sourceHash: hashSource(source),
          currentAstNodeId: 9999,
          scopeChain: [
            {
              id: "root",
              bindings: {}
            }
          ],
          callStack: [],
          pendingPromises: [],
          moduleBindings: {}
        },
        {
          source,
          budget: new Budget()
        }
      )
    ).toThrowError("Snapshot references unknown AST node 9999.");
  });

  it("preserves null-prototype sandbox objects during restoration", () => {
    const source = "return value";

    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId: getNodeIdByType(parseModule(source), "Identifier"),
        scopeChain: [
          {
            id: "root",
            bindings: {
              value: {
                nested: 1
              }
            }
          }
        ],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      },
      {
        source,
        budget: new Budget()
      }
    );

    const value = restored.currentScope.lookup("value");
    expect(value.found).toBe(true);
    if (!value.found || value.value === null || typeof value.value !== "object" || Array.isArray(value.value)) {
      return;
    }

    expect(Object.getPrototypeOf(value.value)).toBeNull();
  });

  it("reuses the same runtime promise for every restored reference to a pending promise", () => {
    const source = "await task()";
    const awaitNodeId = getNodeIdByType(parseModule(source), "AwaitExpression");

    const restored = restore(
      {
        sourceHash: hashSource(source),
        currentAstNodeId: awaitNodeId,
        scopeChain: [
          {
            id: "root",
            bindings: {
              task: {
                kind: "promise",
                id: "promise-1"
              }
            }
          }
        ],
        callStack: [
          {
            astNodeId: awaitNodeId,
            scopeId: "root",
            awaitingPromiseId: "promise-1"
          }
        ],
        pendingPromises: [
          {
            id: "promise-1",
            state: "pending"
          }
        ],
        moduleBindings: {}
      },
      {
        source,
        budget: new Budget()
      }
    );

    const task = restored.currentScope.lookup("task");
    expect(task.found).toBe(true);
    if (!task.found || typeof task.value !== "object" || task.value === null) {
      return;
    }

    expect(task.value).toBe(restored.pendingPromises[0]);
    expect(restored.callStack[0]?.awaitingPromise).toBe(restored.pendingPromises[0]);
  });
});

function getNodeIdByType(module: Module, type: ParseResult["type"]): number {
  const match = findNode(module, (node): node is ParseResult => node.type === type);

  if (match?.nodeId === undefined) {
    throw new Error(`Expected node type '${type}' in test source.`);
  }

  return match.nodeId;
}

function findNode<TNode extends { nodeId?: number; type: string }>(
  value: unknown,
  predicate: (node: TNode) => boolean
): TNode | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  if ("type" in value && typeof value.type === "string" && predicate(value as TNode)) {
    return value as TNode;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findNode(entry, predicate);
      if (match !== undefined) {
        return match;
      }
    }

    return undefined;
  }

  for (const entry of Object.values(value)) {
    const match = findNode(entry, predicate);
    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
}
