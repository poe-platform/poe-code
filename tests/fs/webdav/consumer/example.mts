import { WebDavFileSystem } from "virtual-bash";
import type { FileStat, FileSystem, FsOptions, WebDavFetch } from "virtual-bash";

export interface BackingLocation {
  readonly filesystem: FileSystem;
  readonly path: string;
}

export type BackingResolver = (filesystem: FileSystem, path: string, options: FsOptions)
  => Promise<BackingLocation | undefined>;

function identity(stat: FileStat) {
  const scope = stat.identityScope;
  if (!(typeof scope === "symbol" || (typeof scope === "object" && scope !== null))
    || typeof stat.dev !== "number" || !Number.isSafeInteger(stat.dev) || stat.dev < 0
    || typeof stat.ino !== "number" || !Number.isSafeInteger(stat.ino) || stat.ino < 0) return undefined;
  return { scope, dev: stat.dev, ino: stat.ino };
}

export function applicationWebDav(baseUrl: string, fetch: WebDavFetch, resolveBacking: BackingResolver): WebDavFileSystem {
  return new WebDavFileSystem({ baseUrl, fetch, overwritePolicy: "etag", compareEntry: async function(path, peer, peerPath, options = {}) {
    options.signal?.throwIfAborted();
    const own = await resolveBacking(this, path, options);
    options.signal?.throwIfAborted();
    const other = await resolveBacking(peer, peerPath, options);
    options.signal?.throwIfAborted();
    if (!own || !other) return "unknown";
    const left = identity(await own.filesystem.stat(own.path, options));
    options.signal?.throwIfAborted();
    const right = identity(await other.filesystem.stat(other.path, options));
    options.signal?.throwIfAborted();
    if (!left || !right) return "unknown";
    return left.scope === right.scope && left.dev === right.dev && left.ino === right.ino ? "same" : "distinct";
  } });
}
