import {afterEach, expect, it, vi} from "vitest";
import {run} from "../run.js";
import {Scope} from "../interp/scope.js";
import {Budget} from "../interp/budget.js";

afterEach(() => {vi.restoreAllMocks();});

it("rejects cancellation delivered during binding installation before evaluating the graph", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel during linking");
  const budget = new Budget();
  const mark = vi.fn();
  const declareImport = Scope.prototype.declareImport;
  const installed: string[] = [];
  vi.spyOn(Scope.prototype, "declareImport").mockImplementation(function (this: Scope, ...args) {
    declareImport.apply(this, args);
    installed.push(args[0]);
    controller.abort(reason);
  });
  await expect(run("import {value} from 'dep';export {value}", {
    sourceType: "module", signal: controller.signal, budget, modules: {cap: {mark}},
    sourceResolver: id => ({id, source: "import {mark} from 'cap';mark();export const value=1"})
  })).rejects.toBe(reason);
  expect(installed).toContain("value");
  expect(mark).not.toHaveBeenCalled();
  expect(budget.currentCallDepth).toBe(0);
});

it("settles a cooperative top-level await and prevents dependent evaluation on revocation", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel during module evaluation");
  const budget = new Budget();
  let ready!: () => void;
  const started = new Promise<void>(resolve => {ready = resolve;});
  let signal: AbortSignal;
  let active = 0;
  const mark = vi.fn();
  const execution = run("import 'dep';import {mark} from 'cap';mark()", {
    sourceType: "module", signal: controller.signal, budget,
    sourceResolver: (id, _referrer, context) => {
      signal = context.signal!;
      return {id, source: "import {wait,mark} from 'cap';await wait();mark()"};
    },
    modules: {cap: {mark, wait: () => {
      active++;
      const pending = new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => {active--; reject(signal.reason);}, {once: true});
      });
      ready();
      return pending;
    }}}
  });
  void execution.catch(() => undefined);
  try {
    await started;
    expect(active).toBe(1);
  } finally {controller.abort(reason);}
  await expect(execution).rejects.toBe(reason);
  expect(active).toBe(0);
  expect(mark).not.toHaveBeenCalled();
  expect(budget.currentCallDepth).toBe(0);
});
