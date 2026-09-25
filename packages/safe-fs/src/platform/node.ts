import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import * as util from "node:util";
import { constants } from "node:os";
import type { FsOptions } from "../contracts/filesystem.js";
import type { ScopedTransportBudgetFrame } from "./transport-budget.js";

export type PlatformErrno = number;
export type PlatformComparisonCallback<Callback> = Callback;

const systemErrnos = (() => {
  const fallback = new Map(Object.entries(constants.errno).map(([name, errno]) => [name, -Math.abs(errno)]));
  if (typeof util.getSystemErrorMap !== "function") return fallback;
  try {
    return new Map([...util.getSystemErrorMap()].map(([errno, [name]]) => [name, errno]));
  } catch {
    return fallback;
  }
})();
const negotiating = new AsyncLocalStorage<boolean>();

export const platform = Object.freeze({
  maxCollectionBytes: Infinity,
  errno(code: string): PlatformErrno {
    const errno = systemErrnos.get(code === "EOPNOTSUPP" ? "ENOTSUP" : code);
    if (errno === undefined) throw new TypeError(`Unsupported platform errno code: ${code}`);
    return errno;
  },
  callbackAuthorities: true,
  randomUUID
});

export const comparisonContext = Object.freeze({
  active(_options: FsOptions): boolean {
    return negotiating.getStore() === true;
  },
  run<Result>(options: FsOptions, action: (nested: FsOptions) => Promise<Result>): Promise<Result> {
    return negotiating.run(true, () => action(options));
  }
});

const transportBudgets = new AsyncLocalStorage<readonly ScopedTransportBudgetFrame[]>();

export function getScopedTransportBudget(): readonly ScopedTransportBudgetFrame[] | undefined {
  return transportBudgets.getStore();
}

export function withScopedTransportBudget<Result>(
  frames: readonly ScopedTransportBudgetFrame[] | undefined,
  action: () => Result,
): Result {
  return frames ? transportBudgets.run(frames, action) : action();
}

export function runScopedTransportBudget<Result>(
  admit: (options?: FsOptions) => void,
  action: () => Result,
  credit = 1,
): Result {
  const parent = transportBudgets.getStore() ?? [];
  const frame: ScopedTransportBudgetFrame = { credit, admit };
  return transportBudgets.run([...parent, frame], action);
}

export function chargeScopedTransportCall(options?: FsOptions): void {
  const frames = transportBudgets.getStore();
  if (!frames) return;
  for (const frame of frames) {
    if (frame.credit > 0) frame.credit--;
    else frame.admit(options);
  }
}
