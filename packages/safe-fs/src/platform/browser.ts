import { FsError } from "../contracts/errors.js";
import type { FsOptions } from "../contracts/filesystem.js";

export type PlatformErrno = number | undefined;
export type PlatformComparisonCallback<Callback> = Callback & never;

export const platform = Object.freeze({
  errno(_code: string): PlatformErrno {
    return undefined;
  },
  callbackAuthorities: false,
  randomUUID(): string {
    const crypto = globalThis.crypto;
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto?.getRandomValues !== "function") {
      throw new FsError("ENOTSUP", { message: "secure crypto is required for overlay staging" });
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
});

const operationKey = Symbol("filesystem-comparison");
const contexts = new WeakSet<object>();
type OperationOptions = FsOptions & { readonly [operationKey]?: object };

export const comparisonContext = Object.freeze({
  active(options: FsOptions): boolean {
    const context = (options as OperationOptions)[operationKey];
    return context !== undefined && contexts.has(context);
  },
  async run<Result>(options: FsOptions, action: (nested: FsOptions) => Promise<Result>): Promise<Result> {
    const context = Object.freeze({});
    contexts.add(context);
    const nested: OperationOptions = { ...options, [operationKey]: context };
    try {
      return await action(nested);
    } finally {
      contexts.delete(context);
    }
  }
});
