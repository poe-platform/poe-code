import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import * as util from "node:util";
import { constants } from "node:os";
import type { FsOptions } from "../contracts/filesystem.js";

export type PlatformErrno = number;
export type PlatformComparisonCallback<Callback> = Callback;

const systemErrnos = typeof util.getSystemErrorMap === "function"
  ? new Map([...util.getSystemErrorMap()].map(([errno, [name]]) => [name, errno]))
  : new Map(Object.entries(constants.errno).map(([name, errno]) => [name, -Math.abs(errno)]));
const negotiating = new AsyncLocalStorage<boolean>();

export const platform = Object.freeze({
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
