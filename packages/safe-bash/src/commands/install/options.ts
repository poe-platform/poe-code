import type { CommandContext } from "../../contracts/index.js";

export interface InstallContextRequest {
  readonly path: string;
  readonly source?: string;
  readonly label?: string;
  readonly mode: "default" | "preserve" | "explicit";
}

export interface InstallModeRequest {
  readonly path: string;
  readonly mode: number;
  readonly kind: "file" | "new-directory" | "existing-directory";
}

export interface InstallCommandsOptions {
  readonly replace?: boolean;
  readonly identity?: { readonly uid: number; readonly gid: number };
  readonly resolveUser?: (name: string, context: CommandContext) => number | undefined | Promise<number | undefined>;
  readonly resolveGroup?: (name: string, context: CommandContext) => number | undefined | Promise<number | undefined>;
  readonly chown?: (path: string, uid: number | undefined, gid: number | undefined, context: CommandContext) => void | Promise<void>;
  readonly setMode?: (request: InstallModeRequest, context: CommandContext) => void | Promise<void>;
  readonly strip?: (path: string, program: string, context: CommandContext) => number | Promise<number>;
  readonly renameExclusive?: (source: string, destination: string, context: CommandContext) => void | Promise<void>;
  readonly maxFileBytes?: number;
  readonly securityContext?: {
    readonly enabled: boolean;
    readonly apply?: (request: InstallContextRequest, context: CommandContext) => void | Promise<void>;
    readonly matches?: (source: string, destination: string, context: CommandContext) => boolean | Promise<boolean>;
  };
}

export class InstallError extends Error {
  constructor(message: string, readonly usage = false) { super(message); }
}

export function quote(value: string, numeric = false, rawBytes?: Uint8Array): string {
  const escapes = new Map([[7, "a"], [8, "b"], [9, "t"], [10, "n"], [11, "v"], [12, "f"], [13, "r"]]);
  const bytes = rawBytes ?? new TextEncoder().encode(value);
  if (!numeric && bytes.every(byte => byte >= 32 && byte < 127)) {
    return value.includes("'") && !["\"", "$", "`", "\\"].some(character => value.includes(character))
      ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`;
  }
  let result = "'", escaped = false;
  for (const byte of bytes) {
    const special = byte < 32 || byte >= 127;
    if (!numeric && special !== escaped) { result += special ? "'$'" : "''"; escaped = special; }
    result += special ? `\\${escapes.get(byte) ?? byte.toString(8).padStart(3, "0")}`
      : numeric && (byte === 39 || byte === 92) ? `\\${String.fromCharCode(byte)}`
      : byte === 39 ? "'\\''" : String.fromCharCode(byte);
  }
  return `${result}'`;
}
