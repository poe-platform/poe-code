import { invalidBiff } from "./biff-binary.js";
import { SsconvertError } from "../contracts.js";

/** BIFF5/7 EXTERNSHEET combines the workbook URL and an optional [file]sheet. */
export function biffLegacyExternalPath(path: string): { workbook: string; sheet?: string } | undefined {
  const decoded = biffExternalPath(path);
  if (decoded === undefined) return undefined;
  const first = decoded.indexOf("["), last = decoded.indexOf("]");
  if (first < 0) return last < 0 ? { workbook: decoded } : undefined;
  if (last <= first + 1 || decoded.indexOf("[", first + 1) >= 0 || decoded.indexOf("]", last + 1) >= 0) return undefined;
  const workbook = decoded.slice(0, first) + decoded.slice(first + 1, last), sheet = decoded.slice(last + 1);
  if (!sheet || Array.from(sheet).some(c => c.charCodeAt(0) < 32)) return undefined;
  return { workbook, sheet };
}

export function encodeBiffExternalPath(workbook: string): string {
  if (workbook.length > 254) throw new SsconvertError("unsupported-feature", "Excel BIFF external workbook path is too long");
  if (!workbook || Array.from(workbook).some(c => c.charCodeAt(0) < 32))
    throw new SsconvertError("unsupported-feature", "Excel BIFF external workbook path contains control characters");
  const raw = Array.from(workbook).some(c => "/\\:[]".includes(c));
  const path = raw ? "\u0001\u0005" + String.fromCharCode(workbook.length) + workbook : "\u0001" + workbook;
  if (path.length > 255) throw new SsconvertError("unsupported-feature", "Excel BIFF external workbook path is too long");
  return path;
}

/** MS-XLS VirtualPath. Decode identity only; never resolve a path or open a link. */
export function biffExternalPath(path: string): string | undefined {
  if (!path || path === "\0" || path[0] === "\u0002" || path[0] === "\u0003") return undefined;
  if (path.length > 255) invalidBiff("external workbook path is too long");
  if (path[0] !== "\u0001") return Array.from(path).some(c => c.charCodeAt(0) < 32) ? undefined : path;
  let result = "";
  for (let at = 1; at < path.length; at++) {
    const c = path[at]!;
    if (c === "\u0001") {
      const drive = path[++at];
      if (drive === undefined) invalidBiff("truncated external workbook drive");
      if (drive !== "@" && !(drive >= "A" && drive <= "Z" || drive >= "a" && drive <= "z")) return undefined;
      result += drive === "@" ? "\\\\" : drive + ":\\";
    } else if (c === "\u0002" || c === "\u0003") result += "\\";
    else if (c === "\u0004") result += "..\\";
    else if (c === "\u0005") {
      const length = path.charCodeAt(++at);
      if (!Number.isFinite(length) || length > path.length - at - 1) invalidBiff("truncated external workbook URL");
      result += path.slice(at + 1, at + 1 + length); at += length;
    } else if (c.charCodeAt(0) < 32) return undefined;
    else result += c;
  }
  return result || undefined;
}
