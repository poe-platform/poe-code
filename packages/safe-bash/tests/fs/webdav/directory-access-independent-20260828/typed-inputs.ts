import type {
  FileSystem, FsOptions, ReadOnlyFileSystem, WebDavFetch,
  WebDavFileSystem, WebDavFileSystemOptions,
} from "virtual-bash";

type Assert<Condition extends true> = Condition;
type Fits<Actual, Expected> = [Actual] extends [Expected] ? true : false;
type Not<Condition extends boolean> = Condition extends true ? false : true;
type Mode = Parameters<WebDavFileSystem["access"]>[1];
type Path = Parameters<WebDavFileSystem["access"]>[0];
type Result = ReturnType<WebDavFileSystem["access"]>;

export type PositiveControls = [
  Assert<Fits<WebDavFileSystem, FileSystem>>,
  Assert<Fits<ReadOnlyFileSystem, FileSystem>>,
  Assert<Fits<1 | 5 | undefined, Mode>>,
  Assert<Fits<{}, FsOptions>>,
  Assert<Fits<{ signal: AbortSignal }, FsOptions>>,
  Assert<Fits<Result, Promise<void>>>,
  Assert<Fits<WebDavFileSystem["capabilities"]["permissions"], false>>,
  Assert<Fits<(url: string, init: RequestInit) => Promise<Response>, WebDavFetch>>,
];

export type NegativeControls = [
  Assert<Not<Fits<"1", Mode>>>,
  Assert<Not<Fits<null, Mode>>>,
  Assert<Not<Fits<Uint8Array, Path>>>,
  Assert<Not<Fits<{ signal: undefined }, FsOptions>>>,
  Assert<Not<Fits<{ signal: { aborted: boolean } }, FsOptions>>>,
  Assert<Not<Fits<{ baseUrl: string }, WebDavFileSystemOptions>>>,
  Assert<Not<Fits<(url: string, init: RequestInit) => Response, WebDavFetch>>>,
  Assert<Not<Fits<"directoryAccess", keyof WebDavFileSystemOptions>>>,
  Assert<Not<Fits<"maxAccessPathBytes", keyof WebDavFileSystemOptions>>>,
  Assert<Not<Fits<"directoryNavigation", keyof WebDavFileSystem["capabilities"]>>>,
];

export const optionsForInjectedTransport = (fetch: WebDavFetch, signal: AbortSignal): {
  provider: WebDavFileSystemOptions; invocation: FsOptions;
} => ({
  provider: {
    baseUrl: "https://independent.invalid/dav/", fetch,
    headers: { Authorization: "Bearer independent-synthetic-only" },
    timeoutMs: 500, maxXmlBytes: 2097152, maxEntries: 10000, maxResponseBytes: 16777216,
  },
  invocation: { signal },
});

export const positiveCalls = (filesystem: WebDavFileSystem, readonly: ReadOnlyFileSystem, signal: AbortSignal): readonly Promise<void>[] => [
  filesystem.access("/docs", 1), filesystem.access("/docs", 5, { signal }),
  readonly.access("/docs", 1), readonly.access("/docs", 5, { signal }),
  filesystem.access("/docs", undefined, {}),
];
