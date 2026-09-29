export * from "safe-bash-command-pathchk";

const PORTABLE_CHAR_RE = /^[A-Za-z0-9._-]+$/;
const sharedUtf8Encoder = new TextEncoder();

function resolveVfsPath(cwd: string, target: string): string {
  const raw = target.startsWith("/") ? target : (cwd.endsWith("/") ? cwd + target : `${cwd}/${target}`);
  const parts = raw.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return "/" + stack.join("/");
}

export function evalSyncPathchk(
  opArgs: readonly string[],
  cwd = "/",
  statTypeSync?: (path: string) => "file" | "directory" | "symlink" | "missing" | undefined,
): string | undefined {
  let checkBasicPosix = false;
  let checkExtraPosix = false;
  const operands: string[] = [];
  let endOfOptions = false;

  for (let i = 0; i < opArgs.length; i++) {
    const arg = opArgs[i]!;
    if (!endOfOptions && arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && (arg === "--help" || arg === "--version")) return undefined;
    if (!endOfOptions && arg === "--portability") {
      checkBasicPosix = true;
      checkExtraPosix = true;
      continue;
    }
    if (!endOfOptions && arg.startsWith("--") && arg.length > 2) return undefined;
    if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        const ch = arg[j]!;
        if (ch === "p") checkBasicPosix = true;
        else if (ch === "P") checkExtraPosix = true;
        else return undefined;
      }
      continue;
    }
    operands.push(arg);
  }

  if (operands.length === 0) return undefined;

  const pathMax = checkBasicPosix ? 256 : 4096;
  const nameMax = checkBasicPosix ? 14 : 255;

  for (const name of operands) {
    if (name.length === 0) return undefined;
    const bytes = sharedUtf8Encoder.encode(name);
    if (bytes.byteLength >= pathMax) return undefined;

    const components = name.split("/").filter(Boolean);
    let byteOffset = 0;
    for (const comp of components) {
      while (bytes[byteOffset] === 47) byteOffset++;
      const componentStart = byteOffset;
      while (byteOffset < bytes.length && bytes[byteOffset] !== 47) byteOffset++;
      const compBytes = byteOffset - componentStart;
      if (checkExtraPosix && comp.startsWith("-")) return undefined;
      if (checkBasicPosix && !PORTABLE_CHAR_RE.test(comp)) return undefined;
      if (compBytes > nameMax) return undefined;
    }

    if (!checkBasicPosix) {
      if (!statTypeSync) return undefined;
      const full = resolveVfsPath(cwd, name);
      const parts = full.split("/").filter(Boolean);
      let current = "";
      for (let k = 0; k < parts.length - 1; k++) {
        current += "/" + parts[k]!;
        const st = statTypeSync(current);
        if (st === undefined) return undefined;
        if (st === "missing") break;
        if (st !== "directory") return undefined;
      }
    }
  }

  return "";
}
