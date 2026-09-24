import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { wrapCallerInjectedBindings } from "./host-bridge.js";
import {
  createSandboxClosure,
  isSandboxClosure,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxClosure
} from "./values.js";
import { materializeFunctionProperties } from "./object-model.js";
import { hostFunctionMetadata } from "./host-function-metadata.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";

it.each([
  { copied: false, held: false },
  { copied: false, held: true },
  { copied: true, held: false },
  { copied: true, held: true }
])(
  "observes later property edits made by metadata readers (copied=$copied, held=$held)",
  ({ copied, held }) => {
    const fn = copied
      ? (wrapCallerInjectedBindings({ service() {} }, { budget: new Budget() })
          .service as SandboxClosure)
      : createSandboxClosure({ call: () => undefined, name: "service", length: 0 });
    const properties = materializeFunctionProperties(fn);
    if (!copied)
      hostFunctionMetadata.set(
        properties,
        new Map(Object.entries(Object.getOwnPropertyDescriptors(properties)))
      );
    const before = measureSandboxData([fn]);
    const metadata = hostFunctionMetadata.get(properties)!;
    const get = metadata.get.bind(metadata);
    let mutate = true;
    Object.defineProperty(metadata, "get", {
      value: (key: string) => {
        if (mutate) {
          mutate = false;
          Object.defineProperty(properties, "name", { value: "x".repeat(2000) });
        }
        return get(key);
      }
    });
    const budget = new Budget({ dataSize: before + 1000 });
    const release = held ? budget.deferReconciliation() : undefined;
    try {
      expect(() => reconcileCompiledValues(budget, [fn])).toThrowError(
        expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
      );
    } finally {
      release?.();
    }
  }
);

it("exempts only unchanged host metadata and charges guest replacements", () => {
  const { fn } = wrapCallerInjectedBindings({ fn: () => 7 }, { budget: new Budget() });
  if (!isSandboxClosure(fn) || fn.properties === undefined) throw new Error("missing function");
  expect(measureSandboxData([fn])).toBe(2);
  Object.defineProperty(fn.properties, "name", { value: "x".repeat(100) });
  expect(measureSandboxData([fn])).toBe(107);
  Object.defineProperty(fn.properties, "length", { enumerable: true });
  expect(measureSandboxData([fn])).toBe(114);
});

it("does not treat restored guest metadata as a trusted default", () => {
  const { fn } = wrapCallerInjectedBindings({ fn: () => 7 }, { budget: new Budget() });
  if (!isSandboxClosure(fn) || fn.properties === undefined) throw new Error("missing function");
  Object.defineProperty(fn.properties, "name", { value: "x".repeat(100) });
  const saved = encodeReplayData(fn, {
    identifyCapability: () => "fn",
    captureCapabilityProperties: true
  });
  const restored = decodeReplayData(saved, { resolveCapability: () => fn });
  // Both the replay wrapper and its original capability retain the changed name.
  expect(measureSandboxData([restored])).toBe(214);
});
