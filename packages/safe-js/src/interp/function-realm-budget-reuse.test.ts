import { expect, it } from "vitest";
import { createRealm } from "../realm.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { getFunctionRealmPrototype } from "./function-realm.js";
import { getSandboxDataProperty, releaseObjectPrototype } from "./object-model.js";

it("uses fresh function prototypes when a closed realm's budget is reused", async () => {
  const budget = new Budget();
  for (let index=0;index<3;index++) {
    const realm = createRealm({budget});
    try {
      expect(await realm.evaluate("return [Object.getPrototypeOf(Number)===Function.prototype,Object.getPrototypeOf(function(){})===Function.prototype]"))
        .toMatchObject({ok:true,returnValue:[true,true]});
    } finally {await realm.close();}
  }
});

it("keeps old exported constructor defaults separate from a reused budget", () => {
  const budget = new Budget();
  const first = createBuiltinBindings({budget});
  const firstPrototype = getSandboxDataProperty(first.Function,"prototype",budget);
  releaseObjectPrototype(budget);
  const second = createBuiltinBindings({budget});
  const secondPrototype = getSandboxDataProperty(second.Function,"prototype",budget);
  expect(secondPrototype === firstPrototype).toBe(false);
  expect(getFunctionRealmPrototype(first.Number,"Function",{}) === firstPrototype).toBe(true);
  expect(getFunctionRealmPrototype(second.Number,"Function",{}) === secondPrototype).toBe(true);
  releaseObjectPrototype(budget);
  expect(getFunctionRealmPrototype(first.Number,"Function",{}) === firstPrototype).toBe(true);
  expect(getFunctionRealmPrototype(second.Number,"Function",{}) === secondPrototype).toBe(true);
});
