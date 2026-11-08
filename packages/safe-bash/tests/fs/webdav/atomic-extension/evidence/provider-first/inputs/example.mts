import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { FsError, Shell, standardCommands, createMemoryFileSystem, createMountFileSystem } from "virtual-bash";
import type { ErrnoCode, WebDavAtomicEmptyDirectoryBinding as RootBinding } from "virtual-bash";
import { WebDavFileSystem } from "virtual-bash/fs/webdav";
import type { WebDavAtomicEmptyDirectoryBinding, WebDavAtomicEmptyDirectoryResult, WebDavFetch } from "virtual-bash/fs/webdav";
import { createHttpsFetch, type WireObservation } from "./https.mjs";

export interface LiteralConfiguration {
  readonly namespaceUrl: string;
  readonly stockUrl: string;
  readonly caFile: string;
  readonly authorization: string;
  readonly serverRoot: string;
  readonly controlRoot: string;
}

export const operation = "atomic-empty-rmdir/v1";

function responseError(response: Response, path: string): FsError {
  const native = response.headers.get("X-Atomic-Error");
  const nativeStatuses: Record<string, number> = { ENOTEMPTY: 409, ENOTDIR: 409, ENOENT: 404, EACCES: 403, EBUSY: 409, ENOTSUP: 409, EINVAL: 400, EIO: 500, ETIMEDOUT: 500 };
  const statusCodes: Record<number, ErrnoCode> = { 400: "EINVAL", 401: "EACCES", 403: "EACCES", 404: "ENOENT", 405: "ENOTSUP", 409: "EAGAIN", 412: "EAGAIN", 423: "EBUSY", 501: "ENOTSUP" };
  const code = native && nativeStatuses[native] === response.status ? native as ErrnoCode : statusCodes[response.status] ?? "EIO";
  return new FsError(code, { syscall: "rmdir", path, message: `atomic provider HTTP ${response.status}; no retry` });
}

export function createAtomicBinding(namespaceUrl: string, fetch: WebDavFetch, authorization: string): WebDavAtomicEmptyDirectoryBinding {
  const base = new URL(namespaceUrl);
  if (base.protocol !== "https:" || base.hostname !== "127.0.0.1" || base.username || base.password
    || base.search || base.hash || !base.pathname.endsWith("/") || base.href !== namespaceUrl) throw new Error("explicit canonical loopback HTTPS namespace required");
  const binding: RootBinding = Object.freeze({
    namespaceUrl,
    async removeEmptyDirectory(input): Promise<WebDavAtomicEmptyDirectoryResult> {
      if (input.namespaceUrl !== namespaceUrl || input.operation !== operation) throw new FsError("EINVAL", { syscall: "rmdir", path: input.path });
      input.signal?.throwIfAborted();
      const parts = input.path.slice(1).split("/");
      if (!input.path.startsWith("/") || input.path === "/" || input.path.includes("\\") || input.path.includes("\0")
        || parts.some((part) => !part || part === "." || part === "..")) throw new FsError("EINVAL", { syscall: "rmdir", path: input.path });
      const headers = { Authorization: authorization, "X-Atomic-Namespace": namespaceUrl };
      const settings = { redirect: "manual", credentials: "omit", ...(input.signal ? { signal: input.signal } : {}) } as const;
      const probe = await fetch(namespaceUrl, { ...settings, method: "OPTIONS", headers: { ...headers, "X-Atomic-Empty-Probe": operation } });
      try {
        if (probe.status !== 200 || probe.headers.get("X-Atomic-Capability") !== operation || probe.headers.get("X-Atomic-Namespace") !== namespaceUrl) {
          if (probe.status === 401 || probe.status === 403) throw responseError(probe, input.path);
          throw new FsError("ENOTSUP", { syscall: "rmdir", path: input.path, message: "server did not confirm bound atomic extension; no DELETE issued" });
        }
      } finally { await probe.body?.cancel(); }
      input.signal?.throwIfAborted();
      const url = `${namespaceUrl}${parts.map(encodeURIComponent).join("/")}/`;
      const response = await fetch(url, { ...settings, method: "DELETE", headers: { ...headers, Depth: "infinity",
        "X-Atomic-Empty-Directory": operation, "X-Atomic-Path": Buffer.from(input.path).toString("base64url") } });
      try {
        if (response.status !== 204) throw responseError(response, input.path);
        const encoded = response.headers.get("X-Atomic-Receipt");
        if (!encoded || encoded.length > 4096 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new FsError("EIO", { message: "missing atomic receipt; outcome uncertain" });
        const receipt: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        if (!receipt || typeof receipt !== "object" || !("operation" in receipt) || receipt.operation !== operation
          || !("namespaceUrl" in receipt) || receipt.namespaceUrl !== namespaceUrl || !("path" in receipt) || receipt.path !== input.path
          || !("outcome" in receipt) || receipt.outcome !== "removed") throw new FsError("EIO", { message: "mismatched atomic receipt; outcome uncertain" });
        return { operation, namespaceUrl, path: input.path, outcome: "removed" };
      } finally { await response.body?.cancel(); }
    },
  });
  return binding;
}

export async function createApplication(config: LiteralConfiguration, events: WireObservation[] = []) {
  const fetch = createHttpsFetch(new URL(config.namespaceUrl).origin, await readFile(config.caFile), events);
  const common = { fetch, headers: { Authorization: config.authorization }, timeoutMs: 5000 };
  const dav = new WebDavFileSystem({ ...common, baseUrl: config.namespaceUrl,
    atomicEmptyDirectory: createAtomicBinding(config.namespaceUrl, fetch, config.authorization) });
  const stock = new WebDavFileSystem({ ...common, baseUrl: config.stockUrl });
  const mounted = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dav": dav, "/stock": stock } });
  const shell = new Shell({ fs: mounted }).use(standardCommands());
  return { dav, stock, fetch, mounted, shell };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("literal configuration JSON path required");
  const config: LiteralConfiguration = JSON.parse(await readFile(process.argv[2], "utf8"));
  const { shell } = await createApplication(config);
  const result = await shell.exec("mkdir /dav/public-example-empty && rmdir /dav/public-example-empty && printf 'atomic cleanup complete\\n'");
  process.stdout.write(JSON.stringify(result));
  if (result.exitCode !== 0 || result.stdout !== "atomic cleanup complete\n") process.exitCode = 1;
}
