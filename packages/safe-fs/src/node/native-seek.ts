import { getSystemErrorName } from "node:util";
import { FsError, isErrnoCode } from "../contracts/errors.js";
import type { NativeSeekBinding } from "#safe-fs-native-seek";

export async function loadNativeSeekBinding(signal?: AbortSignal): Promise<NativeSeekBinding> {
  signal?.throwIfAborted();
  const initialization = (async () => {
    const module = await import("#safe-fs-native-seek");
    signal?.throwIfAborted();
    const load = module.loadBinding;
    signal?.throwIfAborted();
    if (typeof load !== "function") throw new FsError("EIO");
    const binding = await Reflect.apply(load, module, []);
    signal?.throwIfAborted();
    if (binding === null || typeof binding !== "object" || Array.isArray(binding)) throw new FsError("EIO");
    return binding;
  })();
  if (!signal) return initialization;
  return new Promise<NativeSeekBinding>((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    initialization.then(
      binding => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(signal.reason);
        else resolve(binding);
      },
      error => {
        signal.removeEventListener("abort", abort);
        reject(signal.aborted ? signal.reason : error);
      },
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function callNativeSeekEnd(
  binding: NativeSeekBinding, seek: NativeSeekBinding["seekEnd"], descriptor: number,
): Promise<bigint> {
  const result: unknown = await Reflect.apply(seek, binding, [descriptor]);
  if (result === null || typeof result !== "object" || Array.isArray(result)) throw new FsError("EIO");
  const { offset, errno } = result as { offset?: unknown; errno?: unknown };
  if (typeof offset !== "bigint" || typeof errno !== "number" || !Number.isSafeInteger(errno)
    || errno < 0 || errno > 2147483647) throw new FsError("EIO");
  if (errno !== 0) {
    if (offset !== -1n) throw new FsError("EIO");
    const code = getSystemErrorName(-errno);
    throw new FsError(isErrnoCode(code) ? code : "EIO");
  }
  if (offset < 0n || offset > 9223372036854775807n) throw new FsError("EIO");
  return offset;
}
