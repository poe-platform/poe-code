import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { listIntrinsicIdentities, registerBuiltinIdentities, releaseIntrinsicIdentities, resolveIntrinsicIdentity } from "./intrinsics.js";
import { wellKnownSymbols } from "./symbols.js";

it("does not repeat closure-brand inspection of an installed object", () => {
  const has = vi.fn(Reflect.has);
  const root = new Proxy({}, { has });
  const budget = new Budget();
  try {
    registerBuiltinIdentities(budget, { root });
    expect(has).toHaveBeenCalledTimes(1);
    expect(resolveIntrinsicIdentity(budget, '["root"]')).toBe(root);
  } finally {
    releaseIntrinsicIdentities(budget);
  }
});

it("bounds frozen symbol-catalog enumeration independently of the installed graph size", () => {
  const symbols = Object.entries(wellKnownSymbols);
  const bindings = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [
    `root${index}`, Object.fromEntries(symbols.map(([, symbol]) => [symbol, {}]))
  ]));
  const budget = new Budget();
  const entries = vi.spyOn(Object, "entries");
  try {
    registerBuiltinIdentities(budget, bindings);
    const catalogScans = entries.mock.calls.filter(([value]) => value === wellKnownSymbols).length;
    expect(catalogScans).toBeLessThanOrEqual(1);
    expect(listIntrinsicIdentities(budget)).toHaveLength(Object.keys(bindings).length * (1 + symbols.length));
    for (const [root, value] of Object.entries(bindings)) {
      for (const [name, symbol] of symbols) {
        expect(resolveIntrinsicIdentity(budget, JSON.stringify([root, { symbol: name }]))).toBe(Reflect.get(value, symbol));
      }
    }
  } finally {
    entries.mockRestore();
    releaseIntrinsicIdentities(budget);
  }
});
