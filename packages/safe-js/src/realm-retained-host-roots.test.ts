import { expect, it, vi } from "vitest";
import { Budget, createRealm, defineExtension } from "./core.js";
import { hostObjectGuestRoot } from "./interp/host-capabilities.js";
import {
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxObject
} from "./interp/values.js";

async function fixture() {
  const budget = new Budget({ dataSize: 50000 });
  const roots: SandboxObject[] = [];
  const realm = createRealm({
    budget,
    extensions: [
      defineExtension({
        manifest: { version: 1, name: "retained-host-roots" },
        setup(context) {
          context.createHostObject({});
          for (let index = 0; index < 2; index++) {
            const host = context.createHostObject({
              expandos: { maxKeys: 4, maxKeyCodeUnits: 32 }
            });
            roots.push(hostObjectGuestRoot(host)!);
          }
          return { globals: {} };
        }
      })
    ]
  });
  try {
    expect(await realm.evaluate("return true;")).toMatchObject({ ok: true, returnValue: true });
    return { budget, realm, roots };
  } catch (error) {
    await realm.close();
    throw error;
  }
}

it.each([false, true])(
  "retains host descendants when later native flattening hooks change (held=%s)",
  async (held) => {
    const { budget, realm, roots } = await fixture();
    const release = held ? budget.deferReconciliation() : undefined;
    roots[0]!.payload = "x".repeat(50001);
    const flatten = Array.prototype.flatMap;
    let exposed = false;
    const hook = vi.spyOn(Array.prototype, "flatMap").mockImplementation(function (
      this: unknown[],
      callback,
      thisArg
    ) {
      if (callback.name === "hostObjectGuestRoots") {
        exposed = true;
        return [];
      }
      return flatten.call(this, callback, thisArg);
    });
    let error: unknown;
    try {
      reconcileCompiledValues(budget, []);
    } catch (failure) {
      error = failure;
    } finally {
      hook.mockRestore();
      release?.();
      await realm.close();
    }
    expect({ exposed, error }).toEqual({
      exposed: false,
      error: expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    });
    expect(budget.currentDataSize).toBe(0);
  }
);

it("keeps private root buffers away from later native append and prototype hooks", async () => {
  const { budget, realm, roots } = await fixture();
  const push = Array.prototype.push;
  const setPrototype = Object.setPrototypeOf;
  let exposed = false;
  Array.prototype.push = function (this: unknown[], ...values: unknown[]) {
    if (values[0] === roots[0]) exposed = true;
    return Reflect.apply(push, this, values);
  };
  Object.setPrototypeOf = function (object, prototype) {
    if (Array.isArray(object)) exposed = true;
    return setPrototype(object, prototype);
  };
  let retained: unknown[];
  try {
    retained = [...budget.retainedValues()];
  } finally {
    Array.prototype.push = push;
    Object.setPrototypeOf = setPrototype;
    await realm.close();
  }
  expect(exposed).toBe(false);
  expect(retained).toEqual(roots);
});

it("keeps roots ordered and live across native writes, aliasing, deletion and cleanup", async () => {
  const { budget, realm, roots } = await fixture();
  try {
    expect([...budget.retainedValues()]).toEqual(roots);
    const payload = { text: "small" };
    roots[0]!.payload = payload;
    roots[1]!.alias = payload;
    const before = measureSandboxData(budget.retainedValues());
    payload.text = "longer";
    expect(measureSandboxData(budget.retainedValues())).toBe(before + 1);
    roots[0]!.payload = "replacement";
    expect([...budget.retainedValues()]).toEqual(roots);
    delete roots[1]!.alias;
    expect(measureSandboxData(budget.retainedValues())).toBe(21);
  } finally {
    await realm.close();
  }
  expect([...budget.retainedValues()]).toEqual([]);
  expect(budget.currentDataSize).toBe(0);
});
