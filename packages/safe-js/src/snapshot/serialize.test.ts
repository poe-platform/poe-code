import { describe, expect, it } from "vitest";

import { createGeneratorChannel } from "../interp/generator.js";
import { createSandboxArguments, createSandboxGenerator } from "../interp/values.js";
import { hashSource } from "../parse/hash.js";
import { serialize, UnsnapshotableValueError } from "./serialize.js";
import { MAX_DATA_DEPTH, SnapshotBudgetError } from "../graph-depth.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";
import { validateDumpEnvelope } from "./validation.js";

function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => T
): T {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("serialize", () => {
  it("preserves arguments metadata in public dump files", () => {
    const args = createSandboxArguments([5, 6]);
    Object.freeze(args);
    const dumped = JSON.parse(
      serializeSafeJSSnapshot({ sourceHash: hashSource("await task()"), bindings: { args } })
    );
    expect(dumped.bindings.args).toMatchObject({ kind: "ref" });
    expect(dumped.heap[String(dumped.bindings.args.id)]).toMatchObject({
      kind: "arguments",
      extensible: false,
      lengthBeforeCallee: true,
      iterator: { configurable: false, enumerable: false, writable: false },
      properties: {
        length: { value: 2, enumerable: false, writable: false },
        0: { value: 5 },
        1: { value: 6 }
      }
    });
    expect(() => validateDumpEnvelope(dumped)).not.toThrow();
  });

  it("serializes the boundary byte-identically and rejects deeply nested arrays and objects", () => {
    const allowed = nestedObjectArrayGraph(MAX_DATA_DEPTH - 4);
    const input = {
      source: "await task()",
      currentAstNodeId: 1,
      scopeChain: [{ id: 1, bindings: { allowed } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    };

    const first = serializeSafeJSSnapshot(serialize(input));
    const second = serializeSafeJSSnapshot(serialize(input));
    expect(second).toBe(first);
    expect(serializeSafeJSSnapshot(JSON.parse(first))).toBe(first);
    expect(() =>
      serialize({
        ...input,
        scopeChain: [{ id: 1, bindings: { rejected: nestedObjectArrayGraph(5_000) } }]
      })
    ).toThrowError(
      expect.objectContaining({
        name: "SnapshotBudgetError",
        code: "budgetExceeded",
        current: MAX_DATA_DEPTH + 1,
        limit: MAX_DATA_DEPTH
      }) satisfies Partial<SnapshotBudgetError>
    );
  });
  it("serializes generators in start and done states", () => {
    const start = createSandboxGenerator(
      createGeneratorChannel(async () => undefined),
      {
        astNodeId: 7,
        capturedScopeId: "generator-scope"
      }
    );
    const done = createSandboxGenerator(createGeneratorChannel(async () => undefined));
    done.state = "done";

    const snapshot = serialize({
      source: "await task()",
      currentAstNodeId: 1,
      scopeChain: [{ id: 1, bindings: { start, done } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });

    expect(snapshot.scopeChain[0]?.bindings).toMatchObject({
      start: {
        kind: "generator",
        state: "start",
        astNodeId: 7,
        capturedScopeId: "generator-scope"
      },
      done: {
        kind: "generator",
        state: "done"
      }
    });
  });

  it("rejects a generator without a representable continuation", () => {
    const generator = createSandboxGenerator(createGeneratorChannel(async () => undefined));
    generator.state = "running";

    expect(() =>
      serialize({
        source: "await task()",
        currentAstNodeId: 1,
        scopeChain: [{ id: 1, bindings: { nested: { generator } } }],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      })
    ).toThrowError(
      expect.objectContaining({
        name: "UnsnapshotableValueError",
        path: "scopeChain[0].bindings.nested.generator",
        message:
          "Cannot snapshot a generator suspended mid-iteration; drain or discard it before the await boundary."
      }) satisfies Partial<UnsnapshotableValueError>
    );
  });

  it("serializes suspended generator continuation metadata", () => {
    const generator = createSandboxGenerator(
      createGeneratorChannel(async (yieldValue) => {
        await yieldValue(1, 9);
      }),
      {
        astNodeId: 7,
        capturedScopeId: "generator-scope"
      }
    );
    generator.state = "suspended";
    void generator.channel.next();

    return Promise.resolve().then(() => {
      const snapshot = serialize({
        source: "await task()",
        currentAstNodeId: 1,
        scopeChain: [{ id: 1, bindings: { generator } }],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      });

      expect(snapshot.scopeChain[0]?.bindings.generator).toEqual({
        kind: "generator",
        state: "suspended",
        astNodeId: 7,
        capturedScopeId: "generator-scope",
        yieldNodeId: 9,
        sent: [{ type: "normal", value: { kind: "undefined" } }]
      });
    });
  });

  it("normalizes a running generator parked at a yield to suspended state", async () => {
    const generator = createSandboxGenerator(
      createGeneratorChannel(async (yieldValue) => {
        await yieldValue(1, 9);
      }),
      {
        astNodeId: 7,
        capturedScopeId: "generator-scope"
      }
    );
    void generator.channel.next();
    await Promise.resolve();
    generator.state = "running";

    const snapshot = serialize({
      source: "await task()",
      currentAstNodeId: 1,
      scopeChain: [{ id: 1, bindings: { generator } }],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });

    expect(snapshot.scopeChain[0]?.bindings.generator).toMatchObject({
      kind: "generator",
      state: "suspended",
      yieldNodeId: 9
    });
  });

  it("serializes resumable interpreter state without host references", () => {
    const source = "await task()";
    const hostPromise = Promise.resolve("done");

    expect(
      serialize({
        source,
        currentAstNodeId: 42,
        scopeChain: [
          {
            id: 1,
            bindings: {
              answer: 42,
              callback: {
                kind: "fn",
                astNodeId: 11,
                capturedScopeId: 1,
                call: () => 42
              },
              pending: {
                kind: "promise",
                id: 7,
                promise: hostPromise,
                moduleId: "git"
              }
            }
          },
          {
            id: 2,
            parentId: 1,
            bindings: {
              nested: {
                items: [
                  "ok",
                  {
                    kind: "fn",
                    astNodeId: 12,
                    capturedScopeId: 2,
                    call: () => "nested"
                  }
                ]
              }
            }
          }
        ],
        callStack: [
          {
            astNodeId: 11,
            scopeId: 1
          },
          {
            astNodeId: 42,
            scopeId: 2,
            awaitingPromiseId: 7
          }
        ],
        pendingPromises: [
          {
            id: 7,
            promise: hostPromise,
            moduleId: "git",
            operation: "commit",
            context: {
              attempt: 1
            }
          }
        ],
        moduleBindings: {
          git: "git",
          log: "log"
        }
      })
    ).toEqual({
      sourceHash: hashSource(source),
      currentAstNodeId: 42,
      scopeChain: [
        {
          id: 1,
          bindings: {
            answer: 42,
            callback: {
              kind: "fn",
              astNodeId: 11,
              capturedScopeId: 1
            },
            pending: {
              kind: "promise",
              id: 7
            }
          }
        },
        {
          id: 2,
          parentId: 1,
          bindings: {
            nested: {
              items: [
                "ok",
                {
                  kind: "fn",
                  astNodeId: 12,
                  capturedScopeId: 2
                }
              ]
            }
          }
        }
      ],
      callStack: [
        {
          astNodeId: 11,
          scopeId: 1
        },
        {
          astNodeId: 42,
          scopeId: 2,
          awaitingPromiseId: 7
        }
      ],
      pendingPromises: [
        {
          id: 7,
          moduleId: "git",
          operation: "commit",
          context: {
            attempt: 1
          }
        }
      ],
      moduleBindings: {
        git: "git",
        log: "log"
      }
    });
  });

  it("serializes own __proto__ object properties as snapshot data", () => {
    const snapshot = serialize({
      source: "return payload",
      currentAstNodeId: 1,
      scopeChain: [
        {
          id: 1,
          bindings: {
            payload: Object.fromEntries([["__proto__", "preserved"]])
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });
    const payload = snapshot.scopeChain[0]?.bindings.payload as Record<string, unknown>;

    expect(Object.hasOwn(payload, "__proto__")).toBe(true);
    expect(payload.__proto__).toBe("preserved");
  });

  it("does not classify inherited runtime markers as closures or promises", () => {
    const inheritedClosureSnapshot = withObjectPrototypeProperties(
      {
        astNodeId: 11,
        capturedScopeId: 1,
        kind: "fn"
      },
      () =>
        serialize({
          source: "return payload",
          currentAstNodeId: 1,
          scopeChain: [
            {
              id: 1,
              bindings: {
                inheritedClosure: { label: "plain closure-shaped object" }
              }
            }
          ],
          callStack: [],
          pendingPromises: [],
          moduleBindings: {}
        })
    );
    const inheritedPromiseSnapshot = withObjectPrototypeProperties(
      {
        id: 7,
        kind: "promise"
      },
      () =>
        serialize({
          source: "return payload",
          currentAstNodeId: 1,
          scopeChain: [
            {
              id: 1,
              bindings: {
                inheritedPromise: { label: "plain promise-shaped object" }
              }
            }
          ],
          callStack: [],
          pendingPromises: [],
          moduleBindings: {}
        })
    );

    expect(inheritedClosureSnapshot.scopeChain[0]?.bindings.inheritedClosure).toEqual({
      label: "plain closure-shaped object"
    });
    expect(inheritedPromiseSnapshot.scopeChain[0]?.bindings.inheritedPromise).toEqual({
      label: "plain promise-shaped object"
    });
  });

  it("rejects host references captured in serialized values", () => {
    expect(() =>
      serialize({
        source: "await task()",
        currentAstNodeId: 1,
        scopeChain: [
          {
            id: 1,
            bindings: {
              bad: () => "host"
            }
          }
        ],
        callStack: [],
        pendingPromises: [],
        moduleBindings: {}
      })
    ).toThrowError("Cannot serialize host reference at scopeChain[0].bindings.bad.");
  });

  it("serializes undefined, non-finite numbers, null-prototype objects, and string ids", () => {
    const source = "await task()";

    expect(
      serialize({
        source,
        currentAstNodeId: 9,
        scopeChain: [
          {
            id: "root",
            bindings: {
              nil: undefined,
              nan: Number.NaN,
              infinity: Number.POSITIVE_INFINITY,
              negativeInfinity: Number.NEGATIVE_INFINITY,
              plain: Object.assign(Object.create(null) as Record<string, unknown>, {
                answer: 42
              }),
              closure: {
                kind: "fn",
                astNodeId: 3,
                capturedScopeId: "root",
                call: () => undefined
              },
              pending: {
                kind: "promise",
                id: "promise-1",
                promise: Promise.resolve("ignored")
              }
            }
          }
        ],
        callStack: [
          {
            astNodeId: 9,
            scopeId: "root",
            awaitingPromiseId: "promise-1"
          }
        ],
        pendingPromises: [
          {
            id: "promise-1",
            state: "pending",
            result: undefined
          }
        ],
        moduleBindings: {
          time: "time"
        }
      })
    ).toEqual({
      sourceHash: hashSource(source),
      currentAstNodeId: 9,
      scopeChain: [
        {
          id: "root",
          bindings: {
            nil: {
              kind: "undefined"
            },
            nan: {
              kind: "number",
              value: "NaN"
            },
            infinity: {
              kind: "number",
              value: "Infinity"
            },
            negativeInfinity: {
              kind: "number",
              value: "-Infinity"
            },
            plain: Object.assign(Object.create(null) as Record<string, unknown>, {
              answer: 42
            }),
            closure: {
              kind: "fn",
              astNodeId: 3,
              capturedScopeId: "root"
            },
            pending: {
              kind: "promise",
              id: "promise-1"
            }
          }
        }
      ],
      callStack: [
        {
          astNodeId: 9,
          scopeId: "root",
          awaitingPromiseId: "promise-1"
        }
      ],
      pendingPromises: [
        {
          id: "promise-1",
          state: "pending",
          result: {
            kind: "undefined"
          }
        }
      ],
      moduleBindings: {
        time: "time"
      }
    });
  });

  it("copies stack and module metadata without retaining caller-owned references", () => {
    const callStack = [
      {
        astNodeId: 1,
        scopeId: "scope-1",
        awaitingPromiseId: "promise-1"
      }
    ];
    const moduleBindings = {
      env: "env"
    };

    const snapshot = serialize({
      source: "await env.get()",
      currentAstNodeId: 1,
      scopeChain: [
        {
          id: "scope-1",
          bindings: {}
        }
      ],
      callStack,
      pendingPromises: [],
      moduleBindings
    });

    callStack[0].scopeId = "mutated";
    moduleBindings.env = "mutated";

    expect(snapshot.callStack).toEqual([
      {
        astNodeId: 1,
        scopeId: "scope-1",
        awaitingPromiseId: "promise-1"
      }
    ]);
    expect(snapshot.moduleBindings).toEqual({
      env: "env"
    });
  });

  it("rejects host references nested inside pending promise metadata", () => {
    expect(() =>
      serialize({
        source: "await task()",
        currentAstNodeId: 1,
        scopeChain: [
          {
            id: 1,
            bindings: {}
          }
        ],
        callStack: [],
        pendingPromises: [
          {
            id: 7,
            metadata: {
              bad: new Map([["x", 1]])
            }
          }
        ],
        moduleBindings: {}
      })
    ).toThrowError("Cannot serialize host reference at pendingPromises[0].metadata.bad.");
  });

  it("rejects cyclic values with a stable path instead of overflowing the stack", () => {
    const cyclic = { nested: {} as Record<string, unknown> };
    cyclic.nested.self = cyclic;

    const snapshot = serialize({
      source: "await task()",
      currentAstNodeId: 1,
      scopeChain: [
        {
          id: 1,
          bindings: {
            cyclic
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });

    expect(snapshot.scopeChain[0]?.bindings.cyclic).toEqual({
      kind: "ref",
      id: 1
    });
    expect(snapshot.heap?.["1"]).toEqual({
      kind: "object",
      entries: {
        nested: {
          self: {
            kind: "ref",
            id: 1
          }
        }
      }
    });
  });

  it("serializes shared sandbox object references once", () => {
    const shared = {
      value: 42
    };

    const snapshot = serialize({
      source: "await task()",
      currentAstNodeId: 1,
      scopeChain: [
        {
          id: 1,
          bindings: {
            l: shared,
            r: shared
          }
        }
      ],
      callStack: [],
      pendingPromises: [],
      moduleBindings: {}
    });

    expect(snapshot.scopeChain[0]?.bindings).toEqual({
      l: {
        kind: "ref",
        id: 1
      },
      r: {
        kind: "ref",
        id: 1
      }
    });
    expect(snapshot.heap).toEqual({
      "1": {
        kind: "object",
        entries: {
          value: 42
        }
      }
    });
  });
});

function nestedObjectArrayGraph(depth: number): RuntimeSnapshotValue {
  let value: RuntimeSnapshotValue = "leaf";
  for (let index = 0; index < depth; index += 1) {
    value = index % 2 === 0 ? [value] : { child: value };
  }
  return value;
}
