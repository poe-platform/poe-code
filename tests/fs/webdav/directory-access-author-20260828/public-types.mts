import { WebDavFileSystem, ReadOnlyFileSystem } from "virtual-bash";
import type { FileSystem, FsOptions } from "virtual-bash";
import { WebDavFileSystem as SubpathWebDav } from "virtual-bash/fs/webdav";
import type { WebDavFileSystemOptions, WebDavFetch } from "virtual-bash/fs/webdav";

const fetch: WebDavFetch = async (_url, _init) => new Response(null, { status: 403 });
const options: WebDavFileSystemOptions = { baseUrl: "https://types.invalid/dav/", fetch };
const filesystem: FileSystem = new WebDavFileSystem(options);
const subpath: FileSystem = new SubpathWebDav(options);
const readonly: FileSystem = new ReadOnlyFileSystem(filesystem);
const signalOptions: FsOptions = { signal: new AbortController().signal };
const modeOne: Promise<void> = filesystem.access("/folder", 1, signalOptions);
const modeFive: Promise<void> = readonly.access("/folder", 5);
const omitted: Promise<void> = subpath.access("/folder");
void [modeOne, modeFive, omitted];

// @ts-expect-error No public navigation option is added.
const invented: WebDavFileSystemOptions = { ...options, virtualTraversal: true };
// @ts-expect-error No private path cap becomes a public option.
const privateLimit: WebDavFileSystemOptions = { ...options, maxDirectoryAccessPathBytes: 65536 };
// @ts-expect-error The existing FsOptions signal remains a real AbortSignal.
const badSignal: FsOptions = { signal: "abort" };
// @ts-expect-error exactOptionalPropertyTypes is unchanged.
const explicitUndefined: FsOptions = { signal: undefined };
void [invented, privateLimit, badSignal, explicitUndefined];
