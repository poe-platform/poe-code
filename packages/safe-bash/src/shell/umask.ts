import type { CommandContext } from "../contracts/command.js";
import { writeText } from "../contracts/io.js";
import { writeDiagnostic } from "../escaping.js";
import { creationUmask } from "../fs/creation-mask.js";

import { dirname, FsError, type FileSystem, type FsOptions } from "../contracts/index.js";
import { registerEntryView, type OpenFileOptions, type StagedFileContent, type WriteFileOptions } from "@poe-code/safe-fs/core";

const creationFileSystems = new WeakMap<FileSystem, Map<number, FileSystem>>();
const creationKeys = new Set(["writeFile", "appendFile", "writeStream", "mkdir", "open", "createStagedFile"]);

/** Supply creation modes through the adapter; never change the process mask or chmod existing entries. */
export function creationFileSystem(fs: FileSystem, mask: number): FileSystem {
  let byMask = creationFileSystems.get(fs);
  if (!byMask) {
    byMask = new Map();
    creationFileSystems.set(fs, byMask);
  }
  const cached = byMask.get(mask);
  if (cached) return cached;
  const methods = new Map<PropertyKey, { raw: unknown; wrapped: unknown }>();
  const view = new Proxy(fs, {
    get(target, key) {
      if (key === creationUmask) return mask;
      const method: unknown = Reflect.get(target, key, target);
      if (typeof method !== "function") return method;
      const existing = methods.get(key);
      if (existing?.raw === method) return existing.wrapped;
      const creation = typeof key === "string" && creationKeys.has(key);
      const wrapped = !creation
        ? method.bind(target)
        : async (...args: unknown[]) => {
            const index = key === "createStagedFile" ? 3 : key === "writeFile" || key === "appendFile" || key === "writeStream" ? 2 : 1;
            const options = (args[index] ?? {}) as FsOptions & Partial<OpenFileOptions & WriteFileOptions> & { recursive?: boolean };
            options.signal?.throwIfAborted();
            if (key === "createStagedFile" && (args[2] as StagedFileContent).type === "symlink") return Reflect.apply(method, target, args);
            if (key === "open" && options.creation !== "ifMissing" && options.creation !== "exclusive") return Reflect.apply(method, target, args);
            if (options.mode === undefined) {
              let path = args[0] as string;
              if (key === "mkdir" && options.recursive === true) {
                let statExisting;
                try { statExisting = await target.stat(path, options.signal === undefined ? {} : { signal: options.signal }); }
                catch (error) {
                  options.signal?.throwIfAborted();
                  if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;
                }
                options.signal?.throwIfAborted();
                if (statExisting?.type === "directory") return Reflect.apply(method, target, args);
              }
              let capabilities = target.capabilities;
              // Atomic final-symlink admission must precede any following path query.
              while (target.capabilitiesFor && !(key === "open" && options.noFollow)) {
                try {
                  capabilities = await target.capabilitiesFor(path, key === "mkdir" ? { ...options, create: true }
                    : (key === "writeFile" || key === "writeStream") && (options.flag === "wx" || options.flag === "ax") ? { ...options, creation: "exclusive" } : options);
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
      methods.set(key, { raw: method, wrapped });
      return wrapped;
    },
  });
  registerEntryView(view, async (path, options) => {
    options.signal?.throwIfAborted();
    return { filesystem: fs, path };
  });
  byMask.set(mask, view);
  return view;
}

function parseMask(value: string, previous: number): number | undefined {
  if (value.length && value[0]! >= "0" && value[0]! <= "9") {
    let mode = 0;
    for (const digit of value) {
      if (digit < "0" || digit > "7") return undefined;
      mode = mode * 8 + Number(digit);
      if (mode > 0o777) return undefined;
    }
    return mode;
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

function symbolicMask(mask: number): string {
  return ["u", "g", "o"].map((who, index) => {
    const bits = (~mask >> (6 - index * 3)) & 7;
    return `${who}=${bits & 4 ? "r" : ""}${bits & 2 ? "w" : ""}${bits & 1 ? "x" : ""}`;
  }).join(",");
}

export async function umaskBuiltin(context: CommandContext, state: { umask?: number }): Promise<number> {
  let symbolic = false;
  let printable = false;
  let index = 0;
  while (index < context.args.length && context.args[index]!.startsWith("-") && context.args[index] !== "-") {
    const option = context.args[index++]!;
    if (option === "--") break;
    for (const flag of option.slice(1)) {
      if (flag === "S") symbolic = true;
      else if (flag === "p") printable = true;
      else { await writeDiagnostic(context.stderr, `umask: ${option}: invalid option\n`); return 2; }
    }
  }
  const operand = context.args[index];
  if (operand !== undefined) {
    const mask = parseMask(operand, state.umask ?? 0o022);
    if (mask === undefined) {
      const reason = operand.length && operand[0]! >= "0" && operand[0]! <= "9" ? "octal number out of range" : "invalid mode";
      await writeDiagnostic(context.stderr, `umask: ${operand}: ${reason}\n`);
      return 1;
    }
    state.umask = mask;
    if (!symbolic) return 0;
    printable = false;
  }
  const mask = state.umask ?? 0o022;
  const value = symbolic ? symbolicMask(mask) : mask.toString(8).padStart(4, "0");
  await writeText(context.stdout, `${printable ? symbolic ? "umask -S " : "umask " : ""}${value}\n`);
  return 0;
}
