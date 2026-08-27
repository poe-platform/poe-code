import { FsError } from "virtual-bash";
import type { WebDavAtomicEmptyDirectoryBinding, WebDavAtomicEmptyDirectoryRequest } from "virtual-bash/fs/webdav";

export interface PublicMockBacking {
  readonly files: Pick<Map<string, Uint8Array | null>, "get" | "has" | "keys" | "delete">;
  readonly locks: ReadonlyMap<string, { readonly expires: number }>;
}

export function atomicMockBinding(backing: PublicMockBacking, namespaceUrl: string): WebDavAtomicEmptyDirectoryBinding {
  const namespace = new URL(namespaceUrl);
  if (!["http:", "https:"].includes(namespace.protocol) || namespace.pathname !== "/dav/"
    || namespace.href !== namespaceUrl || namespace.username || namespace.password || namespace.search || namespace.hash) {
    throw new FsError("EINVAL", { message: "MockDav binding requires its canonical /dav/ namespace" });
  }
  return Object.freeze({
    namespaceUrl,
    async removeEmptyDirectory(request: WebDavAtomicEmptyDirectoryRequest) {
      const { path, signal } = request;
      const fail = (code: "EINVAL" | "EBUSY" | "ENOENT" | "ENOTDIR" | "ENOTEMPTY"): never => {
        throw new FsError(code, { syscall: "rmdir", path });
      };
      signal?.throwIfAborted();
      if (request.operation !== "atomic-empty-rmdir/v1" || request.namespaceUrl !== namespaceUrl
        || !path.startsWith("/") || path.includes("\0") || path.includes("\\")
        || (path !== "/" && path.split("/").slice(1).some(segment => !segment || segment === "." || segment === ".."))) fail("EINVAL");
      if (path === "/") fail("EBUSY");
      if (!backing.files.has(path)) fail("ENOENT");
      if (backing.files.get(path) !== null) fail("ENOTDIR");
      for (const [locked, lock] of backing.locks) {
        if (lock.expires > Date.now() && (locked === "/" || locked === path
          || locked.startsWith(`${path}/`) || path.startsWith(`${locked}/`))) fail("EBUSY");
      }
      for (const entry of backing.files.keys()) if (entry.startsWith(`${path}/`)) fail("ENOTEMPTY");
      if (!backing.files.delete(path)) fail("ENOENT");
      return { operation: "atomic-empty-rmdir/v1", namespaceUrl, path, outcome: "removed" } as const;
    },
  });
}
