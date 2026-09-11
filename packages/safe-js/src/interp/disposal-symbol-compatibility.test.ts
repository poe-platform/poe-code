import { expect, it, vi } from "vitest";

it("provides disposal identities when the host has no disposal symbols", async () => {
  const nativeSymbol = Symbol;
  const replacement = (description?: string | number) => nativeSymbol(description);
  const descriptors = Object.getOwnPropertyDescriptors(nativeSymbol);
  delete descriptors.dispose;
  delete descriptors.asyncDispose;
  Object.defineProperties(replacement, descriptors);
  vi.stubGlobal("Symbol", replacement);
  try {
    vi.resetModules();
    const { wellKnownSymbols } = await import("./symbols.js");
    expect(wellKnownSymbols.dispose).toBe(nativeSymbol.for("nodejs.dispose"));
    expect(wellKnownSymbols.asyncDispose).toBe(nativeSymbol.for("nodejs.asyncDispose"));
    expect(wellKnownSymbols.dispose).not.toBe(wellKnownSymbols.asyncDispose);
    expect(Object.hasOwn(replacement, "dispose")).toBe(false);
    expect(Object.hasOwn(replacement, "asyncDispose")).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
