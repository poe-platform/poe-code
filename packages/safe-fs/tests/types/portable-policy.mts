import { FsError, type PlatformErrno, type WebDavFileSystemOptions } from "../../src/core.js";

type Assert<Condition extends true> = Condition;
export type BrowserErrnoIsNotAlwaysNumeric = Assert<undefined extends FsError["errno"] ? true : false>;
export type BrowserErrnoMatchesPublicAlias = Assert<PlatformErrno extends FsError["errno"] ? true : false>;
export type BrowserCodeIsRequired = Assert<undefined extends FsError["code"] ? false : true>;
export type CustomComparisonIsUnavailable = Assert<NonNullable<WebDavFileSystemOptions["compareEntry"]> extends never ? true : false>;
export type RequestInitIsNotAugmented = Assert<"duplex" extends keyof RequestInit ? false : true>;
