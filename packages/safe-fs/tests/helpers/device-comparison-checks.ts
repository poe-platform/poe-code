import type { FileSystem } from "../../src/contracts/filesystem.js";
import { createDeviceFileSystem } from "../../src/fs/devices/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { compareEntries } from "../../src/fs/mount/comparison.js";

export async function deviceComparisonChecks() {
  const memory = new MemoryFileSystem();
  await memory.symlink("/dev", "/devices");
  await memory.symlink("/dev/null", "/null-alias");
  // Injected backends need not provide optional identity metadata or authorities.
  const backing: FileSystem = new Proxy(memory, {
    get(target, key) {
      if (key === "compareEntry") return undefined;
      if (key === "stat" || key === "lstat") return async (...args: Parameters<FileSystem["stat"]>) => {
        const stat = { ...await target[key](...args) };
        delete stat.identityScope;
        delete stat.ino;
        delete stat.dev;
        return stat;
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const devices = createDeviceFileSystem(backing);
  const results = [];
  for (const path of ["/dev", "/dev/null"]) {
    results.push(await compareEntries(devices, path, devices, "/"));
    results.push(await compareEntries(devices, "/", devices, path));
  }
  results.push(await compareEntries(devices, "/devices", devices, "/dev"));
  results.push(await compareEntries(devices, "/null-alias", devices, "/dev/null"));
  results.push(await compareEntries(devices, "/dev", devices, "/dev/null"));
  const controller = new AbortController();
  const reason = new Error("cancel comparison");
  controller.abort(reason);
  try {
    await compareEntries(devices, "/dev", devices, "/", { signal: controller.signal });
    throw new Error("comparison ignored cancellation");
  } catch (error) {
    if (error !== reason) throw error;
  }
  return results;
}
