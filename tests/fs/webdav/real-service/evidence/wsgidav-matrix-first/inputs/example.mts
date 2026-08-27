import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { RealFileSystem, Shell, standardCommands, createMemoryFileSystem, createMountFileSystem } from "virtual-bash";
import type { FileStat, FileSystem, FsOptions, EntryComparison } from "virtual-bash";
import { WebDavFileSystem } from "virtual-bash/fs/webdav";
import type { WebDavFileSystemOptions } from "virtual-bash/fs/webdav";
import { createHttpsFetch, type WireObservation } from "./https.mjs";

export interface LiteralConfiguration {
  readonly baseUrl: string;
  readonly aliasUrl: string;
  readonly serverRoot: string;
  readonly caFile: string;
  readonly authorization: string;
}

export interface BackingLocation {
  readonly filesystem: RealFileSystem;
  readonly path: string;
}

function compareNative(left: FileStat, right: FileStat): EntryComparison {
  const valid = (stat: FileStat) => (typeof stat.identityScope === "symbol"
    || typeof stat.identityScope === "object" && stat.identityScope !== null)
    && Number.isSafeInteger(stat.dev) && stat.dev! >= 0
    && Number.isSafeInteger(stat.ino) && stat.ino! >= 0;
  if (!valid(left) || !valid(right) || left.identityScope !== right.identityScope) return "unknown";
  return left.dev === right.dev && left.ino === right.ino ? "same" : "distinct";
}

export async function createApplication(config: LiteralConfiguration, events: WireObservation[] = []) {
  const native = new RealFileSystem({ root: config.serverRoot });
  const mappings = new Map<FileSystem, RealFileSystem>([[native, native]]);
  const resolveBacking = async (filesystem: FileSystem, path: string, options: FsOptions): Promise<BackingLocation | undefined> => {
    options.signal?.throwIfAborted();
    const backing = mappings.get(filesystem);
    return backing ? { filesystem: backing, path } : undefined;
  };
  const compareEntry: NonNullable<WebDavFileSystemOptions["compareEntry"]> = async function(path, peer, peerPath, options = {}) {
    const own = await resolveBacking(this, path, options);
    const other = await resolveBacking(peer, peerPath, options);
    options.signal?.throwIfAborted();
    if (!own || !other) return "unknown";
    const left = await own.filesystem.stat(own.path, options);
    const right = await other.filesystem.stat(other.path, options);
    options.signal?.throwIfAborted();
    return compareNative(left, right);
  };
  const fetch = createHttpsFetch(new URL(config.baseUrl).origin, await readFile(config.caFile), events);
  const common = { fetch, headers: { Authorization: config.authorization }, timeoutMs: 5000, compareEntry };
  const dav = new WebDavFileSystem({ ...common, baseUrl: config.baseUrl });
  const alias = new WebDavFileSystem({ ...common, baseUrl: config.aliasUrl });
  const etag = new WebDavFileSystem({ ...common, baseUrl: config.baseUrl, overwritePolicy: "etag" });
  for (const filesystem of [dav, alias, etag]) mappings.set(filesystem, native);
  const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dav": dav, "/native": native, "/alias": alias } });
  const shell = new Shell({ fs: mounted }).use(standardCommands());
  return { dav, alias, etag, native, mounted, shell, fetch, resolveBacking };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config: LiteralConfiguration = JSON.parse(await readFile(process.argv[2]!, "utf8"));
  const { shell } = await createApplication(config);
  const result = await shell.exec("printf 'hello WebDAV\\n' | cat > /dav/public-example.txt; cp /dav/public-example.txt /native/public-copy.txt; cat /dav/public-copy.txt");
  process.stdout.write(JSON.stringify(result));
  if (result.exitCode !== 0 || result.stdout !== "hello WebDAV\n") process.exitCode = 1;
}
