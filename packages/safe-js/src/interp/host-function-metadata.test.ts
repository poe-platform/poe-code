import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { wrapCallerInjectedBindings } from "./host-bridge.js";
import { isSandboxClosure, measureSandboxData } from "./values.js";
import { encodeReplayData, decodeReplayData } from "../snapshot/replay-data.js";

it("exempts only unchanged host metadata and charges guest replacements", () => {
  const {fn} = wrapCallerInjectedBindings({fn: () => 7}, {budget: new Budget()});
  if (!isSandboxClosure(fn) || fn.properties === undefined) throw new Error("missing function");
  expect(measureSandboxData([fn])).toBe(2);
  Object.defineProperty(fn.properties, "name", {value: "x".repeat(100)});
  expect(measureSandboxData([fn])).toBe(107);
  Object.defineProperty(fn.properties, "length", {enumerable: true});
  expect(measureSandboxData([fn])).toBe(114);
});

it("does not treat restored guest metadata as a trusted default", () => {
  const {fn} = wrapCallerInjectedBindings({fn: () => 7}, {budget: new Budget()});
  if (!isSandboxClosure(fn) || fn.properties === undefined) throw new Error("missing function");
  Object.defineProperty(fn.properties, "name", {value: "x".repeat(100)});
  const saved = encodeReplayData(fn, {identifyCapability: () => "fn", captureCapabilityProperties: true});
  const restored = decodeReplayData(saved, {resolveCapability: () => fn});
  // Both the replay wrapper and its original capability retain the changed name.
  expect(measureSandboxData([restored])).toBe(214);
});
