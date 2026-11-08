import { expect, it } from "vitest";
import { createRealm } from "./realm.js";
import { Budget } from "./interp/budget.js";

it.each([undefined, "after-prefix"] as const)(
  "resolves classic imports with stable closure referrers in %s mode",
  async (callbackScheduling) => {
    const requested: Array<[string, string]> = [];
    let finish!: () => void;
    let done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const realm = createRealm({
      classicScripts: true,
      callbackScheduling,
      bindings: { finish: () => finish() },
      sourceResolver: (specifier, referrer) => {
        requested.push([specifier, referrer]);
        return {
          id: new URL(specifier, referrer).href,
          source: "export const answer=42;"
        };
      }
    });
    try {
      expect(
        await realm.evaluate(
          `var answer; var failed=false;
      function later(){ import('./dep.js').then(function(m){answer=m.answer;finish()},function(){failed=true;finish()}) }
    `,
          { filename: "https://fixture.example/first/entry.js" }
        )
      ).toMatchObject({ ok: true });
      expect(
        await realm.evaluate("later()", {
          filename: "https://fixture.example/second/entry.js"
        })
      ).toMatchObject({ ok: true });
      await done;
      expect(requested).toEqual([["./dep.js", "https://fixture.example/first/entry.js"]]);
      expect(await realm.evaluate("[answer,failed]")).toMatchObject({
        ok: true,
        returnValue: [42, false]
      });
      done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      expect(
        await realm.evaluate(
          "import('./next.js').then(function(){finish()},function(){failed=true;finish()})",
          {
            filename: "https://fixture.example/third/entry.js",
            discardResult: true
          }
        )
      ).toMatchObject({ ok: true });
      await done;
      expect(requested[1]).toEqual(["./next.js", "https://fixture.example/third/entry.js"]);
      expect(await realm.evaluate("failed")).toMatchObject({
        ok: true,
        returnValue: false
      });
    } finally {
      await realm.close();
    }
  }
);

it("charges a shared original referrer once and releases it with its closures", async () => {
  const sizes: number[] = [];
  const cleared: number[] = [];
  for (const length of [40, 20040]) {
    const budget = new Budget({ dataSize: 100000 });
    const realm = createRealm({
      classicScripts: true,
      budget,
      sourceResolver: () => undefined
    });
    try {
      expect(
        await realm.evaluate("var first=()=>0; var second=()=>0;", {
          filename: "x".repeat(length)
        })
      ).toMatchObject({ ok: true });
      sizes.push(budget.currentDataSize);
      expect(await realm.evaluate("first=null; second=null;", { filename: "clear" })).toMatchObject(
        { ok: true }
      );
      cleared.push(budget.currentDataSize);
    } finally {
      await realm.close();
    }
    expect(budget.currentDataSize).toBe(0);
  }
  expect(sizes[1]! - sizes[0]!).toBe(20000);
  expect(cleared[1]).toBe(cleared[0]);
});

it("keeps one canonical module instance across classic imports and module evaluation", async () => {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const realm = createRealm({
    classicScripts: true,
    callbackScheduling: "after-prefix",
    bindings: { finish },
    sourceResolver: () => ({
      id: "canonical",
      source: "export const token={};"
    })
  });
  try {
    expect(
      await realm.evaluate("var first; import('dep').then(m=>{first=m; finish()});", {
        filename: "classic",
        discardResult: true
      })
    ).toMatchObject({ ok: true });
    await done;
    expect(
      await realm.evaluate("import * as next from 'dep'; export const same=next===first;", {
        filename: "module",
        sourceType: "module"
      })
    ).toMatchObject({ ok: true, returnValue: { same: true } });
  } finally {
    await realm.close();
  }
});

it("prefers explicitly registered modules to the source resolver", async () => {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const realm = createRealm({
    classicScripts: true,
    modules: { dep: { answer: 7 } },
    bindings: { finish },
    sourceResolver: () => {
      calls++;
      return { id: "wrong", source: "export const answer=0;" };
    }
  });
  try {
    expect(
      await realm.evaluate("var answer; import('dep').then(m=>{answer=m.answer; finish()});", {
        filename: "classic",
        discardResult: true
      })
    ).toMatchObject({ ok: true });
    await done;
    expect(calls).toBe(0);
    expect(await realm.evaluate("answer")).toMatchObject({
      ok: true,
      returnValue: 7
    });
  } finally {
    await realm.close();
  }
});

it("still denies unconfigured imports without adding source authority", async () => {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const realm = createRealm({ classicScripts: true, bindings: { finish } });
  try {
    expect(
      await realm.evaluate(
        "var denied=false; import('node:fs').catch(()=>{denied=true; finish()});",
        { filename: "classic", discardResult: true }
      )
    ).toMatchObject({ ok: true });
    await done;
    expect(await realm.evaluate("denied")).toMatchObject({
      ok: true,
      returnValue: true
    });
  } finally {
    await realm.close();
  }
});

it("keeps a suspended generator's original referrer after clearing its function", async () => {
  const requested: string[] = [];
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const realm = createRealm({
    classicScripts: true,
    callbackScheduling: "after-prefix",
    bindings: { finish },
    sourceResolver: (specifier, referrer) => {
      requested.push(referrer);
      return {
        id: new URL(specifier, referrer).href,
        source: "export const answer=42;"
      };
    }
  });
  try {
    expect(
      await realm.evaluate(
        "var producer=function*(){yield 1; return import('./dep.js')}; var held=producer(); held.next(); producer=null;",
        {
          filename: "https://fixture.example/original/entry.js",
          discardResult: true
        }
      )
    ).toMatchObject({ ok: true });
    expect(
      await realm.evaluate("held.next().value.then(()=>finish());", {
        filename: "https://fixture.example/later/entry.js",
        discardResult: true
      })
    ).toMatchObject({ ok: true });
    await done;
    expect(requested).toEqual(["https://fixture.example/original/entry.js"]);
  } finally {
    await realm.close();
  }
});

it("retains generator referrer charge independently of its creating function", async () => {
  const sizes: number[] = [];
  for (const length of [40, 20040]) {
    const budget = new Budget({ dataSize: 100000 });
    const realm = createRealm({
      classicScripts: true,
      budget,
      sourceResolver: () => undefined
    });
    try {
      expect(
        await realm.evaluate(
          "var producer=function*(){yield 1;yield 2}; var held=producer(); held.next(); producer=null;",
          {
            filename: "x".repeat(length),
            discardResult: true
          }
        )
      ).toMatchObject({ ok: true });
      sizes.push(budget.currentDataSize);
    } finally {
      await realm.close();
    }
    expect(budget.currentDataSize).toBe(0);
  }
  expect(sizes[1]! - sizes[0]!).toBe(20000);
});

it.each([undefined, "after-prefix"] as const)(
  "cancels pending classic imports on close in %s mode",
  async (callbackScheduling) => {
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let signal: AbortSignal | undefined;
    let resumed = false;
    const budget = new Budget({ dataSize: 100000 });
    const realm = createRealm({
      classicScripts: true,
      callbackScheduling,
      budget,
      bindings: {
        resumed: () => {
          resumed = true;
        }
      },
      sourceResolver: (_specifier, _referrer, context) => {
        signal = context.signal;
        ready();
        return new Promise(() => {});
      }
    });
    try {
      expect(
        await realm.evaluate("import('pending').then(()=>resumed(),()=>{});", {
          filename: "original",
          discardResult: true
        })
      ).toMatchObject({ ok: true });
      await started;
      expect(signal?.aborted).toBe(false);
      await realm.close();
      expect(signal?.aborted).toBe(true);
      expect(resumed).toBe(false);
      expect(budget.currentDataSize).toBe(0);
    } finally {
      await realm.close();
    }
  }
);

it("keeps a resolver denial catchable without granting another source", async () => {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const requested: string[] = [];
  const realm = createRealm({
    classicScripts: true,
    callbackScheduling: "after-prefix",
    bindings: { finish },
    sourceResolver: (specifier) => {
      requested.push(specifier);
      return undefined;
    }
  });
  try {
    expect(
      await realm.evaluate(
        "var denied=false; import('denied').catch(()=>{denied=true;finish()});",
        {
          filename: "classic",
          discardResult: true
        }
      )
    ).toMatchObject({ ok: true });
    await done;
    expect(requested).toEqual(["denied"]);
    expect(await realm.evaluate("denied")).toMatchObject({
      ok: true,
      returnValue: true
    });
  } finally {
    await realm.close();
  }
});

it("charges original source identities before retaining classic closures", async () => {
  const budget = new Budget({ dataSize: 5000 });
  const realm = createRealm({
    classicScripts: true,
    budget,
    sourceResolver: () => undefined
  });
  try {
    await expect(
      realm.evaluate("var held=()=>0", { filename: "x".repeat(10000) })
    ).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "dataSize"
    });
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});

it("rejects resolver reentry during a classic import", async () => {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let denied = false;
  const realm = createRealm({
    classicScripts: true,
    bindings: { finish },
    sourceResolver: async () => {
      try {
        await realm.evaluate("var entered=true");
      } catch (error) {
        denied = (error as { code?: string }).code === "reentry";
      }
      return undefined;
    }
  });
  try {
    expect(
      await realm.evaluate("import('dep').catch(()=>finish());", {
        filename: "classic",
        discardResult: true
      })
    ).toMatchObject({ ok: true });
    await done;
    expect(denied).toBe(true);
  } finally {
    await realm.close();
  }
});

it("preserves async host callback referrers after later source evaluation", async () => {
  let callback: unknown;
  const requested: string[] = [];
  const realm = createRealm({
    classicScripts: true,
    callbackScheduling: "after-prefix",
    bindings: {
      save: (value: unknown) => {
        callback = value;
      }
    },
    sourceResolver: (_specifier, referrer) => {
      requested.push(referrer);
      return { id: "dep", source: "export const answer=42;" };
    }
  });
  try {
    expect(
      await realm.evaluate("save(async()=>{const m=await import('dep');return m.answer});", {
        filename: "original"
      })
    ).toMatchObject({ ok: true });
    expect(await realm.evaluate("var later=1", { filename: "later" })).toMatchObject({ ok: true });
    expect(await realm.invokeCallback(callback)).toBe(42);
    expect(requested).toEqual(["original"]);
  } finally {
    await realm.close();
  }
});

it("enforces imported source quotas through a classic callback", async () => {
  let callback: unknown;
  const budget = new Budget({ dataSize: 5000 });
  const realm = createRealm({
    classicScripts: true,
    callbackScheduling: "after-prefix",
    budget,
    bindings: {
      save: (value: unknown) => {
        callback = value;
      }
    },
    sourceResolver: () => ({
      id: "dep",
      source: `/*${"x".repeat(10000)}*/export const answer=42;`
    })
  });
  try {
    expect(
      await realm.evaluate("save(async()=>await import('dep'));", {
        filename: "original"
      })
    ).toMatchObject({ ok: true });
    await expect(realm.invokeCallback(callback)).rejects.toMatchObject({
      code: "budgetExceeded",
      budget: "dataSize"
    });
  } finally {
    await realm.close();
  }
  expect(budget.currentDataSize).toBe(0);
});
