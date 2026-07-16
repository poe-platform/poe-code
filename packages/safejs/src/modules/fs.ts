import { constants as nodeFsConstants } from "node:fs";
import * as nodeFsPromises from "node:fs/promises";

import { declareHostOperation } from "../interp/host-bridge.js";
import type { PendingHostCallPolicyMode } from "../snapshot/policy.js";

type FsOperationName =
  | "access"
  | "appendFile"
  | "chmod"
  | "copyFile"
  | "link"
  | "lstat"
  | "mkdir"
  | "mkdtemp"
  | "readFile"
  | "readdir"
  | "readlink"
  | "realpath"
  | "rename"
  | "rm"
  | "rmdir"
  | "stat"
  | "symlink"
  | "truncate"
  | "utimes"
  | "writeFile";

export type FsImplementation = Pick<typeof nodeFsPromises, FsOperationName>;

export type FsModuleOptions = {
  root?: string;
  fs?: FsImplementation;
};

export type FsModule = FsImplementation & {
  constants: {
    F_OK: number;
    R_OK: number;
    W_OK: number;
    X_OK: number;
    COPYFILE_EXCL: number;
  };
};

export function makeFsModule(options: FsModuleOptions = {}): FsModule {
  const fs = options.fs ?? nodeFsPromises;

  return {
    access: bind(fs, "access", "re-issue"),
    appendFile: bind(fs, "appendFile", "read-side-effect"),
    chmod: bind(fs, "chmod", "read-side-effect"),
    copyFile: bind(fs, "copyFile", "read-side-effect"),
    link: bind(fs, "link", "read-side-effect"),
    lstat: bind(fs, "lstat", "re-issue"),
    mkdir: bind(fs, "mkdir", "read-side-effect"),
    mkdtemp: bind(fs, "mkdtemp", "read-side-effect"),
    readFile: bind(fs, "readFile", "re-issue"),
    readdir: bind(fs, "readdir", "re-issue"),
    readlink: bind(fs, "readlink", "re-issue"),
    realpath: bind(fs, "realpath", "re-issue"),
    rename: bind(fs, "rename", "read-side-effect"),
    rm: bind(fs, "rm", "read-side-effect"),
    rmdir: bind(fs, "rmdir", "read-side-effect"),
    stat: bind(fs, "stat", "re-issue"),
    symlink: bind(fs, "symlink", "read-side-effect"),
    truncate: bind(fs, "truncate", "read-side-effect"),
    utimes: bind(fs, "utimes", "read-side-effect"),
    writeFile: bind(fs, "writeFile", "read-side-effect"),
    constants: {
      F_OK: nodeFsConstants.F_OK,
      R_OK: nodeFsConstants.R_OK,
      W_OK: nodeFsConstants.W_OK,
      X_OK: nodeFsConstants.X_OK,
      COPYFILE_EXCL: nodeFsConstants.COPYFILE_EXCL
    }
  };
}

function bind<Name extends FsOperationName>(
  fs: FsImplementation,
  name: Name,
  policy: PendingHostCallPolicyMode
): FsImplementation[Name] {
  const operation = (...args: readonly unknown[]) =>
    Reflect.apply(fs[name] as (...operationArgs: readonly unknown[]) => unknown, fs, args);
  Object.defineProperty(operation, "name", { value: name });
  declareHostOperation(operation, policy);
  return operation as FsImplementation[Name];
}
