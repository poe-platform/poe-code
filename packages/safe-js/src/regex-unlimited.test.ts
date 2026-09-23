import { expect, it } from "vitest";
import { Budget, createRealm } from "./core.js";

it.each([{}, { regexSourceLength: 20000 }, { regexCompileAllocations: 100000 }])(
  "does not enable omitted regex quotas with %j", async options => {
    const realm = createRealm({ budget: new Budget(options) });
    try {
      expect(await realm.evaluate('return new RegExp("a".repeat(5000)).source.length;'))
        .toMatchObject({ ok: true, returnValue: 5000 });
      expect(await realm.evaluate('return /a+/.test("a".repeat(3000));'))
        .toMatchObject({ ok: true, returnValue: true });
      expect(await realm.evaluate('return new RegExp("(".repeat(70) + "a" + ")".repeat(70)).test("a");'))
        .toMatchObject({ ok: true, returnValue: true });
    } finally { await realm.close(); }
  }
);
