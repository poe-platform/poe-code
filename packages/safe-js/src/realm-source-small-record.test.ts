import { expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension } from "./core.js";
import { reconcileCompiledValues } from "./interp/values.js";

function fixture(source = 'export const record={entry0:"small",child:{text:"child"}};') {
  return createRealm({
    classicScripts: true,
    sourceResolver: () => ({ id: "https://fixture.example/dep.js", source })
  });
}

const load =
  'import {record} from "dep";globalThis.record=record;export const loaded=record.entry0;';

it("does not recapture warmed fixed-key source module records", async () => {
  const realm = fixture();
  try {
    expect(await realm.evaluate(load, { sourceType: "module" })).toMatchObject({ ok: true });
    const read = vi.spyOn(Object, "getOwnPropertyDescriptor");
    let result: unknown;
    let captures: number;
    try {
      result = await realm.evaluate("var result=0;for(var i=0;i<8;i++)result++;result;");
      captures = read.mock.calls.filter(([, key]) => key === "entry0" || key === "text").length;
    } finally {
      read.mockRestore();
    }
    expect(result).toMatchObject({ ok: true, returnValue: 8 });
    expect(captures).toBe(0);
  } finally {
    await realm.close();
  }
});

it("owns records created by source module functions invoked later", async () => {
  const realm = fixture('export function make(){return {entry0:"small",child:{text:"child"}}}');
  try {
    expect(
      await realm.evaluate('import {make} from "dep";globalThis.make=make;', {
        sourceType: "module"
      })
    ).toMatchObject({ ok: true });
    expect(await realm.evaluate("var record=make();")).toMatchObject({ ok: true });
    const read = vi.spyOn(Object, "getOwnPropertyDescriptor");
    let captures: number;
    try {
      expect(await realm.evaluate("var count=0;for(var i=0;i<8;i++)count++;count;")).toMatchObject({
        ok: true,
        returnValue: 8
      });
      captures = read.mock.calls.filter(([, key]) => key === "entry0" || key === "text").length;
    } finally {
      read.mockRestore();
    }
    expect(captures).toBe(0);
  } finally {
    await realm.close();
  }
});

it("keeps source record aliases, mutations, descriptors and prototypes compatible", async () => {
  const realm = fixture();
  try {
    expect(await realm.evaluate(load, { sourceType: "module" })).toMatchObject({ ok: true });
    expect(
      await realm.evaluate(`var alias=record;var child=record.child;record.self=record;
      child.text="grown";Object.setPrototypeOf(record,{prototypeValue:7});
      Object.defineProperty(record,"getter",{get(){return child.text},enumerable:true,configurable:true});
      [record===alias,record.child===child,record.self===record,record.getter==="grown",record.prototypeValue===7];`)
    ).toMatchObject({ ok: true, returnValue: [true, true, true, true, true] });
    expect(
      await realm.evaluate(
        "delete record.self;delete record.getter;JSON.parse(JSON.stringify(record));"
      )
    ).toMatchObject({ ok: true, returnValue: { entry0: "small", child: { text: "grown" } } });
  } finally {
    await realm.close();
  }
});

it("exports source-owned records as native cloneable data", async () => {
  const realm = fixture();
  try {
    const result = await realm.evaluate(
      'export const record={entry0:"small",child:{text:"child"}};',
      { sourceType: "module" }
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Expected module namespace");
    expect(structuredClone(result.returnValue)).toEqual({
      record: { entry0: "small", child: { text: "child" } }
    });
  } finally {
    await realm.close();
  }
});

it("copies source records through host calls with cycles and aliases intact", async () => {
  let cloned: unknown;
  const extension = defineExtension({
    manifest: { version: 1, name: "record-echo", globals: ["echo"] },
    setup() {
      return {
        globals: {
          echo(value: unknown) {
            cloned = structuredClone(value);
            return cloned;
          }
        }
      };
    }
  });
  const realm = createRealm({ classicScripts: true, extensions: [extension] });
  try {
    expect(
      await realm.evaluate(
        `const child={text:"small"};const record={first:child,second:child};record.self=record;
      const copied=echo(record);export const checks=[copied.first===copied.second,copied.self===copied,copied.first.text==="small"];`,
        { sourceType: "module" }
      )
    ).toMatchObject({ ok: true, returnValue: { checks: [true, true, true] } });
    expect(structuredClone(cloned)).toMatchObject({
      first: { text: "small" },
      second: { text: "small" }
    });
  } finally {
    await realm.close();
  }
});

it.each([
  { held: false, descendant: false },
  { held: true, descendant: false },
  { held: false, descendant: true },
  { held: true, descendant: true }
])(
  "rejects native source record growth after warming (held=$held, descendant=$descendant)",
  async ({ held, descendant }) => {
    class Observed extends Budget {
      captured?: Record<string, unknown>;
      override visitNode(units = 1): void {
        super.visitNode(units);
        if (this.captured !== undefined) return;
        for (const value of this.retainedValues())
          if (value && typeof value === "object" && Object.hasOwn(value, "entry0")) {
            this.captured = value as Record<string, unknown>;
            break;
          }
      }
    }
    const budget = new Observed({ dataSize: 50000 });
    const realm = createRealm({ classicScripts: true, budget });
    try {
      expect(
        await realm.evaluate('export const record={entry0:"small",child:{text:"small"}};', {
          sourceType: "module"
        })
      ).toMatchObject({ ok: true });
      if (budget.captured === undefined) throw new Error("Missing retained record");
      const release = held ? budget.deferReconciliation() : undefined;
      try {
        if (descendant) (budget.captured.child as { text: string }).text = "x".repeat(50001);
        else Object.defineProperty(budget.captured, "entry0", { value: "x".repeat(50001) });
        await expect(realm.evaluate("0;")).rejects.toMatchObject({
          code: "budgetExceeded",
          budget: "dataSize"
        });
      } finally {
        release?.();
      }
    } finally {
      await realm.close();
    }
    if (held) reconcileCompiledValues(budget, []);
    expect(budget.currentDataSize).toBe(0);
  }
);

it.each([
  'const key="entry0";export const record={[key]:"small"};',
  'const initial={entry0:"small"};export const record={...initial};',
  'export const record={get entry0(){return "small"}};'
])("preserves fresh descriptor capture for non-fixed source records: %s", async (source) => {
  const realm = fixture(source);
  try {
    expect(await realm.evaluate(load, { sourceType: "module" })).toMatchObject({ ok: true });
    const read = vi.spyOn(Object, "getOwnPropertyDescriptor");
    let captures: number;
    try {
      expect(await realm.evaluate("0;")).toMatchObject({ ok: true });
      captures = read.mock.calls.filter(([, key]) => key === "entry0").length;
    } finally {
      read.mockRestore();
    }
    expect(captures).toBeGreaterThan(0);
  } finally {
    await realm.close();
  }
});
