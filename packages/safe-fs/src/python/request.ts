import { FsError } from "../contracts/errors.js";
import type { PythonFsRequest } from "./filesystem.js";

const argumentKinds = {
  open: ["string", "object"], read: ["number", "number", "position"], write: ["number", "bytes", "position"],
  descriptorCapabilities: ["number"], fstat: ["number"], close: ["number"], position: ["number"], ftruncate: ["number", "number"], sync: ["number", "boolean"],
  stat: ["string"], lstat: ["string"], readdir: ["string"], realpath: ["string"], readlink: ["string"], rm: ["string"], rmdir: ["string"],
  rename: ["string", "string"], symlink: ["string", "string"], link: ["string", "string"], mkdir: ["string", "optionalObject"],
  chmod: ["string", "number"], truncate: ["string", "number"], access: ["string", "number"], utimes: ["string", "number", "number"],
} as const;

export function parsePythonFsRequest(value: unknown, maxTransferBytes: number): PythonFsRequest {
  if (!value || typeof value !== "object" || Reflect.ownKeys(value).some(key => key !== "op" && key !== "args")) throw new FsError("EINVAL");
  const op = Object.getOwnPropertyDescriptor(value, "op")?.value as unknown;
  const args = Object.getOwnPropertyDescriptor(value, "args")?.value as unknown;
  if (typeof op !== "string" || !Object.hasOwn(argumentKinds, op)) throw new FsError("ENOTSUP");
  const kinds = argumentKinds[op as keyof typeof argumentKinds] as readonly string[];
  if (!Array.isArray(args) || args.length > kinds.length || args.length < kinds.length - (kinds.at(-1) === "optionalObject" ? 1 : 0)) throw new FsError("EINVAL", { syscall: op });
  const selected: unknown[] = [];
  for (let index = 0; index < kinds.length; index++) {
    const kind = kinds[index];
    const descriptor = Object.getOwnPropertyDescriptor(args, String(index));
    if (descriptor && !Object.hasOwn(descriptor, "value")) throw new FsError("EINVAL", { syscall: op });
    const argument: unknown = descriptor?.value;
    if (kind === "bytes") {
      if (!(argument instanceof Uint8Array) && !Array.isArray(argument)) throw new FsError("EINVAL", { syscall: op });
      if (argument.length > maxTransferBytes) throw new FsError("EFBIG", { syscall: op });
      const owned = new Uint8Array(argument.length);
      for (let byteIndex = 0; byteIndex < argument.length; byteIndex++) {
        const entry = Object.getOwnPropertyDescriptor(argument, String(byteIndex));
        const byte: unknown = entry?.value;
        if (!entry || !Object.hasOwn(entry, "value") || typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) throw new FsError("EINVAL", { syscall: op });
        owned[byteIndex] = byte;
      }
      selected.push(owned);
      continue;
    }
    if (kind === "position" ? argument !== null && typeof argument !== "number"
      : kind === "optionalObject" ? argument !== undefined && (typeof argument !== "object" || argument === null || Array.isArray(argument))
      : kind === "object" ? typeof argument !== "object" || argument === null || Array.isArray(argument)
      : typeof argument !== kind) throw new FsError("EINVAL", { syscall: op });
    if (argument !== null && typeof argument === "object") {
      const snapshot: Record<string, unknown> = {};
      for (const key of Reflect.ownKeys(argument)) {
        const field = Object.getOwnPropertyDescriptor(argument, key);
        if (typeof key !== "string" || !field || !Object.hasOwn(field, "value")) throw new FsError("EINVAL", { syscall: op });
        Object.defineProperty(snapshot, key, { value: field.value, enumerable: true });
      }
      selected.push(snapshot);
    } else selected.push(argument);
  }
  return { op, args: selected } as unknown as PythonFsRequest;
}
