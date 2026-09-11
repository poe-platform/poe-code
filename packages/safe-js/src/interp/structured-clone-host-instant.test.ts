import { expect, it } from "vitest";
import { Temporal } from "temporal-polyfill/full/implementation";
import { cloneSandboxValue, deepCopyToSandbox } from "./values.js";
import { temporalInstantEpoch } from "./temporal-instant.js";

const NativeInstant = (Object.getOwnPropertyDescriptor(globalThis, "Temporal")?.value as
  { Instant?: typeof Temporal.Instant } | undefined)?.Instant;

for (const [name, Instant] of [["polyfill", Temporal.Instant], ["native", NativeInstant]] as const) {
  it.runIf(Instant !== undefined).each(["direct", "record", "array", "map", "set"])(
    `rejects ${name} host Instant in structured cloning: %s`, position => {
      if (Instant === undefined) throw new Error("Native Temporal required");
      const instant = new Instant(-1n);
      const value = position === "record" ? { instant }
        : position === "array" ? [instant]
          : position === "map" ? new Map([[instant, 1]])
            : position === "set" ? new Set([instant]) : instant;
      expect(() => cloneSandboxValue(value, { structuredClone: true }))
        .toThrow(expect.objectContaining({ name: "DataCloneError" }));
      if (name === "native") {
        expect(() => structuredClone(value))
          .toThrow(expect.objectContaining({ name: "DataCloneError" }));
      }
    }
  );

  it.runIf(Instant !== undefined)(`preserves ordinary ${name} Instant imports and aliases`, () => {
    if (Instant === undefined) throw new Error("Native Temporal required");
    const instant = new Instant(-1n);
    const copy = deepCopyToSandbox([instant, instant]);
    if (!Array.isArray(copy)) throw new Error("Expected copied array");
    expect(copy[0]).toBe(copy[1]);
    expect(copy[0]).not.toBe(instant);
    expect(temporalInstantEpoch(copy[0])).toBe(-1n);
  });

  it.runIf(Instant !== undefined)(`rejects ${name} Instant without reading own accessors`, () => {
    if (Instant === undefined) throw new Error("Native Temporal required");
    const instant = new Instant(0n);
    let reads = 0;
    Object.defineProperty(instant, "label", { enumerable: true, get() { reads++; return "label"; } });
    expect(() => cloneSandboxValue(instant, { structuredClone: true }))
      .toThrow(expect.objectContaining({ name: "DataCloneError" }));
    expect(reads).toBe(0);
  });
}
