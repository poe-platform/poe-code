import { dirname, FsError, type FileSystem, type FsOptions } from "../contracts/index.js";
import { registerEntryView, type OpenFileOptions } from "@poe-code/safe-fs/core";

/** Supply creation modes through the adapter; never change the process mask or chmod existing entries. */
export function creationFileSystem(fs: FileSystem, mask: number): FileSystem {
  const view = new Proxy(fs, {
    get(target, key) {
      const method: unknown = Reflect.get(target, key, target);
      if (typeof method !== "function") return method;
      const creation = ["writeFile", "appendFile", "writeStream", "mkdir", "open"].includes(String(key));
      if (!creation) return method.bind(target);
      return async (...args: unknown[]) => {
        const index = key === "writeFile" || key === "appendFile" || key === "writeStream" ? 2 : 1;
        const options = (args[index] ?? {}) as FsOptions & Partial<OpenFileOptions> & { recursive?: boolean };
        options.signal?.throwIfAborted();
        if (key === "open" && options.creation !== "ifMissing" && options.creation !== "exclusive") return Reflect.apply(method, target, args);
        if (options.mode === undefined) {
          let path = args[0] as string;
          if (key === "mkdir" && options.recursive === true) {
            let existing;
            try { existing = await target.stat(path, options.signal === undefined ? {} : { signal: options.signal }); }
            catch (error) {
              options.signal?.throwIfAborted();
              if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;
            }
            options.signal?.throwIfAborted();
            if (existing?.type === "directory") return Reflect.apply(method, target, args);
          }
          let capabilities = target.capabilities;
          while (target.capabilitiesFor) {
            try {
              capabilities = await target.capabilitiesFor(path, key === "mkdir" || key === "open" ? { ...options, create: true } : options);
              break;
            } catch (error) {
              options.signal?.throwIfAborted();
              const parent = dirname(path);
              if (key !== "mkdir" || options.recursive !== true || !(error instanceof FsError) || error.code !== "ENOENT" || parent === path) throw error;
              path = parent;
            }
          }
          options.signal?.throwIfAborted();
          if (capabilities.permissions !== false) args[index] = { ...options, mode: (key === "mkdir" ? 0o777 : 0o666) & ~mask };
        }
        return Reflect.apply(method, target, args);
      };
    },
  });
  registerEntryView(view, async (path, options) => {
    options.signal?.throwIfAborted();
    return { filesystem: fs, path };
  });
  return view;
}

export function parseMask(value: string, previous: number): number | undefined {
  if (value.length && [...value].every(char => char >= "0" && char <= "7")) {
    const mode = Number.parseInt(value, 8);
    return mode <= 0o777 ? mode : undefined;
  }
  let allowed = ~previous & 0o777;
  for (const clause of value.split(",")) {
    let index = 0;
    let who = 0;
    while (index < clause.length && "ugoa".includes(clause[index]!)) {
      who |= { u: 0o700, g: 0o070, o: 0o007, a: 0o777 }[clause[index] as "u" | "g" | "o" | "a"];
      index++;
    }
    who ||= 0o777;
    let operations = 0;
    while (index < clause.length) {
      const operator = clause[index++]!;
      if (!"+-=".includes(operator)) return undefined;
      operations++;
      let bits = 0;
      while (index < clause.length && !"+-=".includes(clause[index]!)) {
        const permission = clause[index++]!;
        if (permission === "r") bits |= 0o444;
        else if (permission === "w") bits |= 0o222;
        else if (permission === "x") bits |= 0o111;
        else if ("ugo".includes(permission)) {
          const shift = permission === "u" ? 6 : permission === "g" ? 3 : 0;
          const triad = (allowed >> shift) & 7;
          bits |= triad | triad << 3 | triad << 6;
        } else return undefined;
      }
      bits &= who;
      allowed = operator === "=" ? (allowed & ~who) | bits : operator === "+" ? allowed | bits : allowed & ~bits;
    }
    if (!operations) return undefined;
  }
  return ~allowed & 0o777;
}

export function symbolicMask(mask: number): string {
  return ["u", "g", "o"].map((who, index) => {
    const bits = (~mask >> (6 - index * 3)) & 7;
    return `${who}=${bits & 4 ? "r" : ""}${bits & 2 ? "w" : ""}${bits & 1 ? "x" : ""}`;
  }).join(",");
}
