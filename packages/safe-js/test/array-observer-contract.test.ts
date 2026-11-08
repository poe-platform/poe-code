import { describe, expect, it, vi } from "vitest";

import { observeArrayGraph } from "./fixtures/array-observer.js";

type DifferenceCase = {
  name: string;
  pair: () => readonly [unknown, unknown];
};

const differenceCases: readonly DifferenceCase[] = [
  {
    name: "ordinary versus null prototype",
    pair: () => {
      const nullRecord: Record<string, unknown> = Object.create(null);
      nullRecord.value = 1;
      return [{ value: 1 }, nullRecord];
    }
  },
  ...(["writable", "enumerable", "configurable"] as const).map((flag) => ({
    name: `${flag} descriptor flag`,
    pair: (): readonly [unknown, unknown] => [
      Object.defineProperty({}, "value", {
        value: 1,
        writable: true,
        enumerable: true,
        configurable: true
      }),
      Object.defineProperty({}, "value", {
        value: 1,
        writable: true,
        enumerable: true,
        configurable: true,
        [flag]: false
      })
    ]
  })),
  {
    name: "symbol-keyed property presence",
    pair: () => [{ [Symbol.for("array-observer-control")]: 1 }, {}]
  },
  {
    name: "local symbol identities despite equal descriptions",
    pair: () => {
      const shared = Symbol("same");
      return [
        [shared, shared],
        [Symbol("same"), Symbol("same")]
      ];
    }
  },
  {
    name: "nonenumerable property presence",
    pair: () => [Object.defineProperty({}, "hidden", { value: 1 }), {}]
  },
  {
    name: "hole versus present undefined",
    pair: () => [new Array(2), [undefined, undefined]]
  },
  {
    name: "shared versus copied children",
    pair: () => {
      const shared = { value: 1 };
      return [
        [shared, shared],
        [{ value: 1 }, { value: 1 }]
      ];
    }
  },
  {
    name: "extensibility",
    pair: () => [{ value: 1 }, Object.preventExtensions({ value: 1 })]
  },
  {
    name: "shared versus independent typed buffers",
    pair: () => {
      const buffer = new ArrayBuffer(8);
      return [
        [new Float32Array(buffer, 0, 1), new Float32Array(buffer, 4, 1)],
        [new Float32Array(1), new Float32Array(1)]
      ];
    }
  },
  {
    name: "typed buffer bytes",
    pair: () => [new Float32Array([1]).buffer, new Float32Array([2]).buffer]
  },
  {
    name: "Map insertion order",
    pair: () => [
      new Map([
        ["first", 1],
        ["second", 2]
      ]),
      new Map([
        ["second", 2],
        ["first", 1]
      ])
    ]
  },
  {
    name: "Set insertion order",
    pair: () => [new Set([1, 2]), new Set([2, 1])]
  },
  {
    name: "RegExp source",
    pair: () => [new RegExp("first", "u"), new RegExp("second", "u")]
  },
  {
    name: "unselected return field",
    pair: () => [{ returnValue: { values: [1], extra: true } }, { returnValue: { values: [1] } }]
  },
  {
    name: "whole journal tail",
    pair: () => [
      { hostCalls: [{ operation: "first" }] },
      { hostCalls: [{ operation: "first" }, { operation: "second" }] }
    ]
  },
  {
    name: "journal prototype despite identical JSON",
    pair: () => {
      const nullRecord: Record<string, unknown> = Object.create(null);
      nullRecord.operation = "mark";
      return [{ hostCalls: [{ operation: "mark" }] }, { hostCalls: [nullRecord] }];
    }
  },
  {
    name: "pending policy versus completed outcome",
    pair: () => [
      { replay: { calls: [{ policy: "re-issue", lifecycle: "running" }] } },
      { replay: { calls: [{ policy: "read-side-effect", lifecycle: "fulfilled" }] } }
    ]
  }
];

describe("independent Array observer contract", () => {
  it.each(differenceCases)("distinguishes $name without a value projection", ({ pair }) => {
    const [expectedDistinctLeft, expectedDistinctRight] = pair();
    expect(observeArrayGraph(expectedDistinctLeft)).not.toStrictEqual(
      observeArrayGraph(expectedDistinctRight)
    );
  });

  it("matches a literal descriptor/prototype graph, not expected-from-actual", () => {
    const input: Record<string, unknown> = Object.create(null);
    input.value = 1;
    expect(observeArrayGraph(input)).toStrictEqual({
      root: { tag: "ref", id: 0 },
      nodes: [
        {
          kind: "object",
          prototype: null,
          extensible: true,
          properties: [
            {
              key: "value",
              descriptor: {
                kind: "data",
                value: 1,
                configurable: true,
                enumerable: true,
                writable: true
              }
            }
          ],
          internal: { kind: "ordinary" }
        }
      ],
      symbols: []
    });
  });

  it("captures a getter descriptor without invoking the getter", () => {
    const getter = vi.fn(() => 9);
    const input = Object.defineProperty({}, "value", { get: getter, enumerable: true });
    expect(() => observeArrayGraph(input)).not.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(observeArrayGraph(input)).not.toStrictEqual(observeArrayGraph({ value: 9 }));
    expect(getter).not.toHaveBeenCalled();
  });

  it("does not invoke toJSON or mutate the input descriptors", () => {
    const toJSON = vi.fn(() => ({ hidden: true }));
    const input = Object.freeze({ value: 1, toJSON });
    const before = Object.getOwnPropertyDescriptors(input);
    observeArrayGraph(input);
    expect(toJSON).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptors(input)).toStrictEqual(before);
    expect(Object.isFrozen(input)).toBe(true);
  });

  it("preserves cycles and cross-root aliases", () => {
    const shared: Record<string, unknown> = { value: 1 };
    shared.self = shared;
    const journal = [{ outcome: shared }];
    const whole = { returnValue: shared, snapshot: { hostCalls: journal }, journal };
    expect(() => observeArrayGraph(whole)).not.toThrow();
    expect(observeArrayGraph(whole)).not.toStrictEqual(
      observeArrayGraph({
        returnValue: shared,
        snapshot: { hostCalls: [{ outcome: { value: 1 } }] },
        journal
      })
    );
  });

  it("preserves negative zero, nonfinite numbers and bigint tags through evidence JSON", () => {
    const observed = observeArrayGraph([undefined, -0, NaN, Infinity, -Infinity, 1n]);
    expect(() => JSON.stringify(observed)).not.toThrow();
    expect(JSON.parse(JSON.stringify(observed))).toStrictEqual(observed);
  });

  it("retains raw prototype loss separately from JSON projection", () => {
    const raw: Record<string, unknown> = Object.create(null);
    raw.operation = "mark";
    const parsed: unknown = JSON.parse(JSON.stringify(raw));
    expect(JSON.stringify(raw)).toBe(JSON.stringify(parsed));
    expect(observeArrayGraph(raw)).not.toStrictEqual(observeArrayGraph(parsed));
  });
});
