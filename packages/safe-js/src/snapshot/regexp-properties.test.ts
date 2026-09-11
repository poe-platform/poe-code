import { describe, expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { cloneSandboxValue, createSandboxRegex, deepCopyFromSandbox, getRegexProperties, measureSandboxData, type SandboxObject, type SandboxRegex } from "../interp/values.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { serializeSafeJSSnapshot } from "./dump-format.js";
import { validateRegexProperties, type RegexPropertyData } from "./regexp-properties.js";
import { assertSnapshotGraphDepth, MAX_DATA_DEPTH } from "../graph-depth.js";

function roundTrip(graph: SandboxObject, format: "snapshot" | "replay" | "clone" | "host"): SandboxObject {
  if (format === "clone") return cloneSandboxValue(graph) as SandboxObject;
  if (format === "host") return deepCopyFromSandbox(graph) as SandboxObject;
  if (format === "replay") return decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(graph)))) as SandboxObject;
  const source = "await task()";
  const snapshot = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { graph } }], callStack: [], pendingPromises: [], moduleBindings: {} });
  const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source, budget: new Budget() }).currentScope.lookup("graph");
  if (!binding.found) throw new Error("Missing restored graph");
  return binding.value as SandboxObject;
}

describe.each(["snapshot", "replay", "clone", "host"] as const)("RegExp properties through %s", format => {
  it("preserves data descriptors, extensibility, aliases and cycles", () => {
    const regex = createSandboxRegex("t", "g");
    const shared = { count: 7, owner: regex };
    const properties = getRegexProperties(regex);
    Object.defineProperty(properties, "extra", { value: shared, enumerable: true });
    Object.preventExtensions(properties);
    const result = roundTrip({ regex, shared, alias: regex }, format);
    const restoredProperties = format === "host" ? result.regex as SandboxObject : getRegexProperties(result.regex as SandboxRegex);
    expect(result.regex).not.toBe(regex);
    expect(result.regex).toBe(result.alias);
    expect(restoredProperties.extra).toBe(result.shared);
    expect((result.shared as SandboxObject).owner).toBe(result.regex);
    expect(Object.isExtensible(restoredProperties)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(restoredProperties, "extra")).toMatchObject({ enumerable: true, configurable: false, writable: false });
  });

  it("preserves a well-known symbol property without exposing internal symbols", () => {
    const regex = createSandboxRegex("t");
    Object.defineProperty(getRegexProperties(regex), Symbol.toStringTag, { value: "Custom", enumerable: true });
    const result = roundTrip({ regex }, format);
    const properties = format === "host" ? result.regex as SandboxObject : getRegexProperties(result.regex as SandboxRegex);
    expect(Object.getOwnPropertySymbols(properties)).toEqual([Symbol.toStringTag]);
    expect(Object.getOwnPropertyDescriptor(properties, Symbol.toStringTag)?.value).toBe("Custom");
  });

  it("preserves aliases reachable through symbol properties", () => {
    const regex = createSandboxRegex("t");
    const shared = { owner: regex };
    Object.defineProperty(getRegexProperties(regex), Symbol.toStringTag, { value: shared });
    const result = roundTrip({ regex, shared }, format);
    const properties = format === "host" ? result.regex as SandboxObject : getRegexProperties(result.regex as SandboxRegex);
    expect(Object.getOwnPropertyDescriptor(properties, Symbol.toStringTag)?.value).toBe(result.shared);
  });
});

it("includes guest properties in public dump heap data", () => {
  const regex = createSandboxRegex("t");
  getRegexProperties(regex).extra = 7;
  const data = JSON.parse(serializeSafeJSSnapshot({ sourceHash: "regex", bindings: { regex } }));
  expect(data.heap[data.bindings.regex.id]).toMatchObject({ kind: "regex-object", source: "t", properties: { extra: { value: 7, writable: true, enumerable: true, configurable: true } } });
});

it.each([
  { extensible: "false" },
  { properties: [] },
  { properties: { x: { value: 7, writable: true, configurable: true } } },
  { symbolEntries: [[7, { value: 7 }]] }
])("rejects malformed RegExp property metadata %j", data => {
  expect(() => validateRegexProperties(data as RegexPropertyData<unknown>)).toThrow(TypeError);
});

it("accounts for data reachable only through a RegExp guest property", () => {
  const regex = createSandboxRegex("t");
  const before = measureSandboxData([regex]);
  getRegexProperties(regex).extra = "x".repeat(4000);
  expect(measureSandboxData([regex]) - before).toBeGreaterThanOrEqual(4000);
});

it("enforces graph depth across RegExp guest properties", () => {
  const regex = createSandboxRegex("t");
  let nested: SandboxObject = {};
  for (let index = 0; index <= MAX_DATA_DEPTH; index++) nested = { nested };
  getRegexProperties(regex).extra = nested;
  expect(() => assertSnapshotGraphDepth(regex)).toThrow(expect.objectContaining({ budget: "dataDepth" }));
});
