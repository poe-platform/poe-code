import { FsError, type PlatformErrno } from "../../src/core.js";
import { FsError as HostError } from "../../src/node-host.js";

type Assert<Condition extends true> = Condition;
export type NodeErrnoIsRequiredNumber = Assert<FsError["errno"] extends number ? true : false>;
export type NodeAliasIsRequiredNumber = Assert<PlatformErrno extends number ? true : false>;
export type NodeHostAndCoreShareType = Assert<HostError extends FsError ? true : false>;
