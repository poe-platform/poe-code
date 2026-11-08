import { FsError } from "../contracts/errors.js";
import type { FileStat } from "../contracts/filesystem.js";

export type PythonWireStat = Omit<FileStat, "identityScope">;

/** Invocation-local device numbers qualify canonical scope/dev without serializing opaque authority. */
export class PythonStatTranslator {
  readonly #devices = new Map<object | symbol, Map<number, number>>();
  readonly #maxDevices: number;
  #next = 1;
  constructor(maxDevices = Infinity) {
    if (maxDevices !== Infinity && (!Number.isSafeInteger(maxDevices) || maxDevices < 1)) throw new FsError("EINVAL");
    this.#maxDevices = maxDevices;
  }
  translate(stat: FileStat): PythonWireStat {
    const { identityScope, dev, ino, ...rest } = stat;
    if (!(typeof identityScope === "symbol" || typeof identityScope === "object" && identityScope !== null)
      || !Number.isSafeInteger(dev) || dev! < 0 || !Number.isSafeInteger(ino) || ino! < 0) return rest;
    let devices = this.#devices.get(identityScope);
    let guestDevice = devices?.get(dev!);
    if (guestDevice === undefined) {
      if (this.#next > this.#maxDevices) throw new FsError("EFBIG", { syscall: "stat", message: "Python device identity limit exceeded" });
      // The upper half of the uint32 guest ABI is reserved for runtime devices.
      if (this.#next >= 0x80000000) throw new FsError("EFBIG", { syscall: "stat", message: "Python device identity exceeds guest ABI range" });
      if (!devices) { devices = new Map(); this.#devices.set(identityScope, devices); }
      guestDevice = this.#next++;
      devices.set(dev!, guestDevice);
    }
    return { ...rest, dev: guestDevice, ino: ino! };
  }
}
