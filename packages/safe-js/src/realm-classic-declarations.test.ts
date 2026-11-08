import { describe, expect, it } from "vitest";
import { Budget, createRealm } from "./core.js";

describe("public classic Script declaration history", () => {
  it.each(["var Object;", '"use strict"; var Object;'])(
    "remembers a var declaration of a configurable builtin: %s",
    async (source) => {
      const realm = createRealm({ classicScripts: true });
      try {
        expect(await realm.evaluate(source)).toMatchObject({ ok: true });
        expect(
          await realm.evaluate('Object.getOwnPropertyDescriptor(globalThis, "Object").configurable')
        ).toMatchObject({ ok: true, returnValue: true });
        await expect(realm.evaluate("let Object = 1;")).rejects.toMatchObject({
          name: "SyntaxError"
        });
      } finally {
        await realm.close();
      }
    }
  );

  it.each(["let remembered = 2;", "const remembered = 2;", "class remembered {}"])(
    "rejects a later lexical declaration after repeated global var: %s",
    async (source) => {
      let effects = 0;
      const realm = createRealm({
        classicScripts: true,
        bindings: {
          effect: () => {
            effects++;
          }
        }
      });
      try {
        expect(await realm.evaluate("globalThis.remembered = 1; void 0;")).toMatchObject({
          ok: true
        });
        expect(await realm.evaluate("var remembered; var remembered;")).toMatchObject({ ok: true });
        expect(
          await realm.evaluate(
            'var remembered; [remembered, Object.getOwnPropertyDescriptor(globalThis, "remembered").configurable]'
          )
        ).toMatchObject({ ok: true, returnValue: [1, true] });
        await expect(realm.evaluate(`effect(); ${source}`)).rejects.toMatchObject({
          name: "SyntaxError"
        });
        expect(effects).toBe(0);
      } finally {
        await realm.close();
      }
    }
  );

  it("does not treat a configurable property alone as a var declaration", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(await realm.evaluate("globalThis.undeclaredProperty = 1; void 0;")).toMatchObject({
        ok: true
      });
      expect(
        await realm.evaluate(
          "let undeclaredProperty = 2; [undeclaredProperty, globalThis.undeclaredProperty]"
        )
      ).toMatchObject({ ok: true, returnValue: [2, 1] });
    } finally {
      await realm.close();
    }
  });

  it("preserves global accessor reads, writes and receiver identity after var declaration", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(
        await realm.evaluate(`
        let storedValue = 1;
        Object.defineProperty(globalThis, "observed", {
          configurable: true,
          get() { return this === globalThis ? storedValue : -1; },
          set(value) { storedValue = this === globalThis ? value : -1; }
        });
        void 0;
      `)
      ).toMatchObject({ ok: true });
      expect(
        await realm.evaluate(
          'var observed; observed = 7; [observed, storedValue, Object.getOwnPropertyDescriptor(globalThis, "observed").configurable]'
        )
      ).toMatchObject({ ok: true, returnValue: [7, 7, true] });
    } finally {
      await realm.close();
    }
  });

  it.each([
    'eval("var declared = 1;");',
    '(0, eval)("var declared = 1;");',
    'eval("function declared() { return 1; }");',
    '(0, eval)("function declared() { return 1; }");'
  ])("retains declaration history for global eval declarations: %s", async (source) => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(await realm.evaluate(source)).toMatchObject({ ok: true });
      expect(
        await realm.evaluate('Object.getOwnPropertyDescriptor(globalThis, "declared").configurable')
      ).toMatchObject({ ok: true, returnValue: true });
      await expect(realm.evaluate("let declared = 2;")).rejects.toMatchObject({
        name: "SyntaxError"
      });
    } finally {
      await realm.close();
    }
  });

  it.each(["var declared = 1;", "function declared() { return 1; }"])(
    "clears history when global DeleteBinding succeeds: %s",
    async (source) => {
      const realm = createRealm({ classicScripts: true });
      try {
        expect(await realm.evaluate(`eval(${JSON.stringify(source)});`)).toMatchObject({
          ok: true
        });
        expect(await realm.evaluate("delete declared")).toMatchObject({
          ok: true,
          returnValue: true
        });
        expect(
          await realm.evaluate(
            "let declared = 2; [declared, Object.hasOwn(globalThis, 'declared')]"
          )
        ).toMatchObject({ ok: true, returnValue: [2, false] });
      } finally {
        await realm.close();
      }
    }
  );

  it.each(["var declared = 1;", "function declared() { return 1; }"])(
    "keeps history when deletion targets the global object directly: %s",
    async (source) => {
      const realm = createRealm({ classicScripts: true });
      try {
        expect(await realm.evaluate(`eval(${JSON.stringify(source)});`)).toMatchObject({
          ok: true
        });
        expect(await realm.evaluate("delete globalThis.declared")).toMatchObject({
          ok: true,
          returnValue: true
        });
        await expect(realm.evaluate("let declared = 2;")).rejects.toMatchObject({
          name: "SyntaxError"
        });
      } finally {
        await realm.close();
      }
    }
  );

  it("does not clear global declaration history for a with-environment deletion", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(await realm.evaluate('eval("var declared = 1;");')).toMatchObject({ ok: true });
      expect(await realm.evaluate("with (globalThis) { delete declared; }")).toMatchObject({
        ok: true,
        returnValue: true
      });
      await expect(realm.evaluate("let declared = 2;")).rejects.toMatchObject({
        name: "SyntaxError"
      });
    } finally {
      await realm.close();
    }
  });

  it("does not clear history when DeleteBinding finds no own global property", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(await realm.evaluate('eval("var declared = 1;");')).toMatchObject({ ok: true });
      expect(await realm.evaluate("delete globalThis.declared")).toMatchObject({
        ok: true,
        returnValue: true
      });
      expect(
        await realm.evaluate("Object.setPrototypeOf(globalThis, { declared: 9 }); void 0;")
      ).toMatchObject({ ok: true });
      expect(await realm.evaluate("[delete declared, declared]")).toMatchObject({
        ok: true,
        returnValue: [true, 9]
      });
      await expect(realm.evaluate("let declared = 2;")).rejects.toMatchObject({
        name: "SyntaxError"
      });
    } finally {
      await realm.close();
    }
  });

  it("does not clear history when an already missing identifier is deleted", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(await realm.evaluate('eval("var declared = 1;");')).toMatchObject({ ok: true });
      expect(await realm.evaluate("delete globalThis.declared")).toMatchObject({
        ok: true,
        returnValue: true
      });
      expect(await realm.evaluate("delete declared")).toMatchObject({
        ok: true,
        returnValue: true
      });
      await expect(realm.evaluate("let declared = 2;")).rejects.toMatchObject({
        name: "SyntaxError"
      });
    } finally {
      await realm.close();
    }
  });

  it.each(["var fixed = 1;", "function fixed() { return 1; }"])(
    "retains history when a nondeletable Script binding cannot be deleted: %s",
    async (source) => {
      const realm = createRealm({ classicScripts: true });
      try {
        expect(await realm.evaluate(source)).toMatchObject({ ok: true });
        expect(await realm.evaluate("delete fixed")).toMatchObject({
          ok: true,
          returnValue: false
        });
        await expect(realm.evaluate("let fixed = 2;")).rejects.toMatchObject({
          name: "SyntaxError"
        });
      } finally {
        await realm.close();
      }
    }
  );

  it("does not record strict eval locals as global declarations", async () => {
    const realm = createRealm({ classicScripts: true });
    try {
      expect(
        await realm.evaluate(
          "eval('\"use strict\"; var evalLocal = 1; function evalFunction() {}');"
        )
      ).toMatchObject({ ok: true });
      expect(
        await realm.evaluate("let evalLocal = 2; let evalFunction = 3; [evalLocal, evalFunction]")
      ).toMatchObject({ ok: true, returnValue: [2, 3] });
    } finally {
      await realm.close();
    }
  });

  it("charges retained declaration names even after direct property deletion", async () => {
    const budget = new Budget({ dataSize: 100_000 });
    const realm = createRealm({ classicScripts: true, budget });
    const names = ["first", "second", "third"].map(
      (prefix) => `${prefix}_${"remembered".repeat(32)}`
    );
    try {
      expect(await realm.evaluate("void 0;")).toMatchObject({ ok: true });
      const before = budget.currentDataSize;
      for (const name of names) {
        expect(
          await realm.evaluate(`eval("var ${name};"); delete globalThis.${name}; void 0;`)
        ).toMatchObject({ ok: true });
      }
      expect(budget.currentDataSize).toBeGreaterThanOrEqual(
        before + names.reduce((total, name) => total + name.length, 0)
      );
    } finally {
      await realm.close();
    }
    expect(budget.currentDataSize).toBe(0);
  });

  it("deduplicates name charges and releases them after global DeleteBinding", async () => {
    const budget = new Budget({ dataSize: 100_000 });
    const realm = createRealm({ classicScripts: true, budget });
    const name = `accounted_${"remembered".repeat(32)}`;
    try {
      expect(await realm.evaluate(`globalThis.${name} = 1; void 0;`)).toMatchObject({ ok: true });
      const propertyOnly = budget.currentDataSize;
      expect(await realm.evaluate(`var ${name};`)).toMatchObject({ ok: true });
      const declared = budget.currentDataSize;
      expect(declared).toBeGreaterThanOrEqual(propertyOnly + name.length);
      expect(await realm.evaluate(`var ${name}; var ${name};`)).toMatchObject({ ok: true });
      expect(budget.currentDataSize).toBe(declared);
      expect(await realm.evaluate(`delete ${name}`)).toMatchObject({ ok: true, returnValue: true });
      expect(budget.currentDataSize).toBeLessThanOrEqual(declared - name.length);
    } finally {
      await realm.close();
    }
    expect(budget.currentDataSize).toBe(0);
  });

  it("enforces the data budget on accumulated declaration history", async () => {
    const budget = new Budget({ dataSize: 8_000 });
    const realm = createRealm({ classicScripts: true, budget });
    try {
      expect(await realm.evaluate("void 0;")).toMatchObject({ ok: true });
      const accumulate = async () => {
        for (let index = 0; index < 96; index++) {
          const name = `history_${index}_${"retained".repeat(16)}`;
          expect(
            await realm.evaluate(`eval("var ${name};"); delete globalThis.${name}; void 0;`)
          ).toMatchObject({ ok: true });
        }
      };
      await expect(accumulate()).rejects.toMatchObject({
        code: "budgetExceeded",
        budget: "dataSize"
      });
    } finally {
      await realm.close();
    }
    expect(budget.currentDataSize).toBe(0);
  });

  it.each([{}, { classicScripts: false }])(
    "preserves legacy var storage for %j",
    async (options) => {
      const realm = createRealm(options);
      try {
        expect(await realm.evaluate("globalThis.remembered = 1;")).toMatchObject({ ok: true });
        expect(
          await realm.evaluate("var remembered = 2; return [remembered, globalThis.remembered];")
        ).toMatchObject({ ok: true, returnValue: [2, 1] });
        expect(
          await realm.evaluate("var remembered; return [remembered, globalThis.remembered];")
        ).toMatchObject({ ok: true, returnValue: [2, 1] });
      } finally {
        await realm.close();
      }
    }
  );
});
