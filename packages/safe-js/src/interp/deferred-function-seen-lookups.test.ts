import { expect, it, vi } from "vitest";
import { DeferredFunction } from "./deferred-function.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";

const { marked } = vi.hoisted(() => ({ marked: new Set<object>() }));

vi.mock("./measurement-seen.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./measurement-seen.js")>();
  return {
    ...original,
    withMeasurementSeen<T>(
      measure: (seen: import("./measurement-seen.js").MeasurementSeen) => T
    ): T {
      return original.withMeasurementSeen((seen) => measure({
        has: value => seen.has(value),
        add(value) {
          marked.add(value);
          seen.add(value);
        }
      }));
    }
  };
});

it("uses one visited identity per pending function while collecting every fresh capture", () => {
  let collections = 0;
  let text = "old";
  const functions = Array.from({ length: 100 }, () => new DeferredFunction(
    () => createSandboxClosure({ call: () => undefined }),
    append => { collections++; append(text); }
  ));
  const roots = functions.map(value => value.root);
  for (const current of ["old", "longer"]) {
    text = current;
    marked.clear();
    expect(measureSandboxData(roots)).toBe(100 * (1 + text.length));
    expect(marked.size).toBe(roots.length);
    for (const root of roots) expect(marked.has(root)).toBe(true);
  }
  expect(collections).toBe(200);
});

it.each([false, true])("keeps root and materialized function aliases charged once (root first=%s)", rootFirst => {
  const payload = { text: "retained" };
  const pending = new DeferredFunction(
    () => createSandboxClosure({ call: () => undefined, retainedValues: () => [payload] }),
    append => append(payload)
  );
  const before = measureSandboxData([pending.root]);
  const closure = pending.resolve();
  const roots = rootFirst ? [pending.root, closure] : [closure, pending.root];
  expect(measureSandboxData(roots)).toBe(before);
  payload.text += "grown";
  expect(measureSandboxData(roots)).toBe(before + 5);
  expect(measureSandboxData(roots, { ignoreClosures: true })).toBe(1);
  expect(measureSandboxData(roots, { ignoreClosureCaptures: true })).toBe(1);
});
