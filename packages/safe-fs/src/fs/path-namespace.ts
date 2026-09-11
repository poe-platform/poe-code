import { FsError } from "../contracts/errors.js";
import type { FileSystem, FsOptions } from "../contracts/filesystem.js";
import { normalizePath, validatePath } from "../contracts/virtual-path.js";

export const pathNamespace = Symbol.for("@poe-code/safe-fs/path-namespace/v1");
const captureNamespace = Symbol.for("@poe-code/safe-fs/capture-path-namespace/v1");

export function capturePathNamespace(filesystem: FileSystem, options: FsOptions): ((path: string) => string) | undefined {
  options.signal?.throwIfAborted();
  const projection: unknown = Reflect.get(filesystem, pathNamespace);
  options.signal?.throwIfAborted();
  if (projection === undefined) return undefined;
  return captureProjection(projection, options);
}

export function readOnlyPathNamespace(projection: unknown): object | undefined {
  if (projection === undefined) return undefined;
  const select = (path: string): string => captureProjection(projection, {})(path);
  Object.defineProperty(select, captureNamespace, {
    value: Object.freeze((options: FsOptions) => captureProjection(projection, options)),
  });
  return Object.freeze({ select: Object.freeze(select) });
}

function captureProjection(projection: unknown, options: FsOptions): (path: string) => string {
  options.signal?.throwIfAborted();
  if (projection === null || typeof projection !== "object") throw new FsError("EIO");
  const frozen = Object.isFrozen(projection);
  options.signal?.throwIfAborted();
  if (!frozen) throw new FsError("EIO");
  let select: unknown = Reflect.get(projection, "select");
  options.signal?.throwIfAborted();
  if (typeof select !== "function") throw new FsError("EIO");
  const capture: unknown = Reflect.get(select, captureNamespace);
  options.signal?.throwIfAborted();
  let receiver: unknown = projection;
  if (capture !== undefined) {
    if (typeof capture !== "function") throw new FsError("EIO");
    select = Reflect.apply(capture, select, [options]);
    options.signal?.throwIfAborted();
    if (typeof select !== "function") throw new FsError("EIO");
    receiver = undefined;
  }
  const selected = select;
  return path => {
    options.signal?.throwIfAborted();
    const root: unknown = Reflect.apply(selected, receiver, [path]);
    options.signal?.throwIfAborted();
    if (typeof root !== "string" || !root.startsWith("/")) throw new FsError("EIO", { path });
    try { validatePath(root); }
    catch (cause) { throw new FsError("EIO", { path, cause }); }
    if (normalizePath(root) !== root || root !== "/" && path !== root && !path.startsWith(`${root}/`)) throw new FsError("EIO", { path });
    return root;
  };
}
