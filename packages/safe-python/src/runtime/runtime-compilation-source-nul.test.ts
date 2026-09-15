import {expect, it, vi} from "vitest";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {runtimeCompilationSource} from "./runtime-compilation-source.js";
import {RuntimeValues} from "./runtime-values.js";

it.each(["compile", "eval", "exec"] as const)("rejects NUL in %s buffer copies and releases their lease", mode => {
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000});
  const values = new RuntimeValues(meter);
  const source = values.cell({});
  const bytes = values.bytes(new Uint8Array([32, 9, 0, 255])).value;
  const copy = vi.fn(() => bytes), release = vi.fn();
  const acquireSimple = vi.fn(() => ({byteLength: 4, copy, release}));
  expect(() => runtimeCompilationSource(source, meter, {buffers: {acquireSimple}}, mode)).toThrow(
    new PythonRuntimeError("SyntaxError", "source code string cannot contain null bytes")
  );
  expect(acquireSimple).toHaveBeenCalledExactlyOnceWith(source);
  expect(copy).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});

it.each([false, true])("keeps copy cancellation terminal before NUL validation (throws=%s)", throws => {
  const controller = new AbortController();
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 100000, signal: controller.signal});
  const values = new RuntimeValues(meter), source = values.cell({});
  const bytes = values.bytes(new Uint8Array([0])).value;
  const copy = vi.fn(() => {
    controller.abort();
    if (throws) throw new Error("copy failed");
    return bytes;
  });
  const release = vi.fn(), acquireSimple = vi.fn(() => ({byteLength: 1, copy, release}));
  const context = {buffers: {acquireSimple}};
  expect(() => runtimeCompilationSource(source, meter, context)).toThrow(ExecutionLimitError);
  expect(() => runtimeCompilationSource(source, meter, context)).toThrow(ExecutionLimitError);
  expect(acquireSimple).toHaveBeenCalledTimes(1);
  expect(copy).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});
