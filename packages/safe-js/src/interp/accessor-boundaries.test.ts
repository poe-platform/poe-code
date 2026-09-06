import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import {
  createSandboxClosure,
  deepCopyFromSandbox,
  deepCopyToSandbox,
  type SandboxValue
} from "./values.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { getSandboxPrototype } from "./object-model.js";

describe("accessor execution boundaries", () => {
  it("accounts for bound names produced by getters", async () => {
    const budget = new Budget();
    const realm = createRealm({ budget });
    try {
      expect(
        await realm.evaluate(
          'function f(){}Object.defineProperty(f,"name",{get(){return "x".repeat(700)}});const bound=f.bind(null);'
        )
      ).toMatchObject({ ok: true });
      expect(budget.currentDataSize).toBeGreaterThanOrEqual(700);
    } finally {
      await realm.close();
    }
  });

  it.each(["get", "set"])("retains reverse operands through a later %s", async (kind) => {
    let checks = 0;
    const later = 'const padding="y".repeat(3000);check(padding);return 1';
    const source =
      kind === "get"
        ? `const a=[0,0];Object.defineProperty(a,0,{get(){return "x".repeat(4000)},set(v){}});Object.defineProperty(a,1,{get(){${later}},set(v){}});a.reverse();return 0;`
        : `const a=[0,0];Object.defineProperty(a,0,{get(){return "x".repeat(4000)},set(v){${later}}});a.reverse();return 0;`;
    await expect(
      run(source, {
        budget: new Budget({ dataSize: 9000 }),
        bindings: {
          check: () => {
            checks++;
          }
        }
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(checks).toBe(0);
  });

  it("retains the first default-sort string while coercing the second", async () => {
    let checks = 0;
    const source =
      'const a=[{toString(){return "x".repeat(4000)}},{toString(){const padding="y".repeat(3000);check(padding);return "y"}}];a.sort();return 0;';
    await expect(
      run(source, {
        budget: new Budget({ dataSize: 9000 }),
        bindings: {
          check: () => {
            checks++;
          }
        }
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(checks).toBe(0);
  });

  it.each(["Object", "Number", "String", "Boolean"] as const)(
    "awaits mediated new.target prototype reads in %s",
    async (name) => {
      const globals = createObjectArrayGlobals({ budget: new Budget() });
      const prototype = Object.create(null);
      const target = createSandboxClosure({ call: () => undefined, construct: () => undefined });
      let reads = 0;
      const value = await globals[name].construct!([7], {
        stack: [],
        thisValue: undefined,
        newTarget: target,
        getProperty: async (receiver, key) => {
          expect(receiver).toBe(target);
          expect(key).toBe("prototype");
          reads++;
          return prototype;
        }
      });
      expect(getSandboxPrototype(value as object)).toBe(prototype);
      expect(reads).toBe(1);
    }
  );
  it.each([
    "slice()",
    "toSorted()",
    "toReversed()",
    "toSpliced()",
    "with(2,7)",
    "map(x=>x)",
    "concat([])"
  ])("retains copied array getter values in %s", async (method) => {
    let checks = 0;
    const first = method === "toReversed()" ? 2 : 0;
    const source = `const a=[0,0,0];Object.defineProperty(a,${first},{get(){return "x".repeat(4000)}});Object.defineProperty(a,1,{get(){const padding="y".repeat(3000);check(padding);return 1}});a.${method};return 0;`;
    await expect(
      run(source, {
        budget: new Budget({ dataSize: 9000 }),
        bindings: {
          check: () => {
            checks++;
          }
        }
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(checks).toBe(0);
  });

  it.each(["Object.defineProperties({},descriptors)", "Object.create(null,descriptors)"])(
    "retains prepared descriptors in %s",
    async (expression) => {
      let checks = 0;
      const source = `const descriptors={};Object.defineProperties(descriptors,{a:{get(){return {value:"x".repeat(4000)}},enumerable:true},b:{get(){const padding="y".repeat(3000);check(padding);return {value:1}},enumerable:true}});${expression};return 0;`;
      await expect(
        run(source, {
          budget: new Budget({ dataSize: 9000 }),
          bindings: {
            check: () => {
              checks++;
            }
          }
        })
      ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
      expect(checks).toBe(0);
    }
  );

  it("retains descriptor value while evaluating later descriptor fields", async () => {
    let checks = 0;
    const source =
      'const d={};Object.defineProperties(d,{value:{get(){return "x".repeat(4000)}},writable:{get(){const padding="y".repeat(3000);check(padding);return true}}});Object.defineProperty({},"x",d);return 0;';
    await expect(
      run(source, {
        budget: new Budget({ dataSize: 9000 }),
        bindings: {
          check: () => {
            checks++;
          }
        }
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(checks).toBe(0);
  });

  it.each([
    "Object.values(o)",
    "Object.entries(o)",
    "({...o})",
    "(()=>{const {...rest}=o;return rest})()",
    "JSON.stringify(o)",
    "Object.assign({},o)"
  ])("retains earlier getter results while evaluating %s", async (expression) => {
    let checks = 0;
    const source = `const o={};Object.defineProperties(o,{a:{get(){return "x".repeat(4000)},enumerable:true},b:{get(){const padding="y".repeat(3000);check(padding);return 1},enumerable:true}});${expression};return 0;`;
    await expect(
      run(source, {
        budget: new Budget({ dataSize: 9000 }),
        bindings: {
          check: () => {
            checks++;
          }
        }
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(checks).toBe(0);
  });

  it.each(["Object.values(o)", "Object.entries(o)", "({...o})", "JSON.stringify(o)"])(
    "allows the smaller retained-value control: %s",
    async (expression) => {
      const source = `const o={};Object.defineProperties(o,{a:{get(){return "x"},enumerable:true},b:{get(){const padding="y".repeat(3000);check(padding);return 1},enumerable:true}});${expression};return 7;`;
      expect(
        await run(source, {
          budget: new Budget({ dataSize: 9000 }),
          bindings: { check: () => undefined }
        })
      ).toMatchObject({ ok: true, returnValue: 7 });
    }
  );

  it.each([
    ["get", "o.x"],
    ["get", "Object.values(o)"],
    ["get", "JSON.stringify(o)"],
    ["set", "o.x=1"],
    [
      "get",
      'Object.defineProperty(o,"then",Object.getOwnPropertyDescriptor(o,"x"));await Promise.resolve(o)'
    ]
  ])("keeps fatal %s budgets fatal through %s", async (kind, expression) => {
    await expect(
      run(
        `const o={};Object.defineProperty(o,"x",{${kind}(){while(true){}},enumerable:true});try{${expression}}catch(e){return "caught"}`,
        { budget: new Budget({ maxSteps: 1000 }) }
      )
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it.each(["{}", "[]", "new Number(7)"])(
    "rejects lossy data copies and preserves supported accessor snapshots: %s",
    async (target) => {
      const source = `const o=${target};Object.defineProperty(o,"x",{get(){return 7},enumerable:true,configurable:true});return o;`;
      const result = await run(source);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Accessor fixture failed");
      expect(() => deepCopyToSandbox(result.returnValue)).toThrow(/descriptor|accessor/i);
      expect(() => deepCopyFromSandbox(result.returnValue as SandboxValue)).toThrow(
        /descriptor|accessor/i
      );
      if (target === "{}") {
        const snapshot = JSON.parse(await dump(result));
        const resumed = await run(source, { snapshot: restore(snapshot, { source }) });
        expect(resumed.ok).toBe(true);
        if (!resumed.ok) throw new Error("Accessor replay failed");
        expect(Object.getOwnPropertyDescriptor(resumed.returnValue, "x")).toMatchObject({
          get: expect.any(Function), set: undefined, enumerable: true, configurable: true
        });
        const recaptured = JSON.parse(await dump(resumed));
        expect(recaptured.heap).toEqual(snapshot.heap);
        expect(recaptured.bindings).toEqual(snapshot.bindings);
      } else {
        await expect(dump(result)).rejects.toThrow(/descriptor|accessor|prototype/i);
      }
    }
  );

  it("cancels an awaited async getter and releases its retained roots", async () => {
    const controller = new AbortController();
    const budget = new Budget();
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    let calls = 0;
    const pending = run(
      'import {pause} from "test";const o={};Object.defineProperty(o,"x",{get:async()=>await pause()});try{return await o.x}catch(e){return e.message}',
      {
        budget,
        signal: controller.signal,
        modules: {
          test: {
            pause: () => {
              calls++;
              start();
              return new Promise(() => undefined);
            }
          }
        }
      }
    );
    await started;
    controller.abort(new Error("getter stopped"));
    expect(await pending).toMatchObject({ ok: true, returnValue: "getter stopped" });
    expect(calls).toBe(1);
    expect([...budget.retainedValues()]).toEqual([]);
  });
});
