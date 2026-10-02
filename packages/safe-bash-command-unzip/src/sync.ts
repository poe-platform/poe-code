
import { inflateRaw as inflateRawSync } from "pako";
import { crc32 } from "safe-bash-zip-engine/zip-format";

export { DEFAULT_ARCHIVE_LIMITS } from "safe-bash-io-engine/commands/archive/internal";
export type { ArchiveCommandsOptions,ArchiveLimits,ZipEncryptionProfile,ZipHost } from "safe-bash-io-engine/commands/archive/internal";

const syncTextDecoder = new TextDecoder();
const fatalSyncTextDecoder = new TextDecoder("utf-8", { fatal: true });

function filteredZipName(name: string): string {
  let output = "";
  for (const character of name) {
    const code = character.charCodeAt(0);
    output += code < 32 ? `^${String.fromCharCode(code + 64)}` : character;
  }
  return output;
}

export function evalSyncUnzip(
  args: readonly string[],
  readFile?: (path: string) => Uint8Array | undefined,
  writeFile?: (path: string, bytes: Uint8Array, mode?: number) => boolean,
  mkdir?: (path: string, mode?: number) => boolean,
): string | undefined {
  if (!readFile || args.length === 0) return undefined;
  let zipinfoNames = false;
  let pipe = false;
  let list = false;
  let testMode = false;
  let caseInsensitive = false;
  let overwrite = false;
  let destDir: string | undefined;
  let quiet = 0;
  let archive: string | undefined;
  const patterns: string[] = [];
  const excludePatterns: string[] = [];
  let inExclude = false;
  let ended = false;
  const zipGlobToRe = (pat: string): RegExp => {
    let re = "^";
    for (let idx = 0; idx < pat.length; idx++) {
      const ch = pat[idx]!;
      if (ch === "*") re += ".*";
      else if (ch === "?") re += ".";
      else if (ch === "[") {
        const close = pat.indexOf("]", idx + 1);
        if (close > idx + 1) {
          re += pat.slice(idx, close + 1);
          idx = close;
        } else re += "\\[";
      } else re += ch.replace(/[.+^$(){}|\\]/g, "\\$&");
    }
    return new RegExp(re + "$", caseInsensitive ? "iu" : "u");
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!ended && a === "--") { ended = true; continue; }
    if (!ended && archive !== undefined && a === "-x") { inExclude = true; continue; }
    if (!ended && (a === "-d" || a.startsWith("-d"))) {
      if (destDir !== undefined) return undefined;
      const d = a === "-d" ? args[++i] : a.slice(2);
      if (!d) return undefined;
      destDir = d;
      continue;
    }
    if (!ended && archive === undefined && a.startsWith("-") && a !== "-") {
      if (a === "-Z1" && i === 0) { zipinfoNames = true; continue; }
      for (let c = 1; c < a.length; c++) {
        const ch = a[c]!;
        if (ch === "p") pipe = true;
        else if (ch === "l") list = true;
        else if (ch === "t") testMode = true;
        else if (ch === "C") caseInsensitive = true;
        else if (ch === "o") overwrite = true;
        else if (ch === "q") quiet++;
        else return undefined;
      }
    } else if (archive === undefined) {
      archive = a;
    } else if (inExclude) {
      excludePatterns.push(a);
    } else {
      patterns.push(a);
    }
  }
  if (!archive) return undefined;
  if (inExclude && excludePatterns.length === 0) return undefined;
  if (zipinfoNames && overwrite) return undefined;
  const modeCount = (zipinfoNames ? 1 : 0) + (pipe ? 1 : 0) + (list ? 1 : 0) + (testMode ? 1 : 0);
  if (modeCount > 1) return undefined;
  const extractMode = modeCount === 0;
  if (destDir !== undefined && (!extractMode || destDir.endsWith("/.") || destDir.includes("/./") || /(?:^|\/)\.\.(?:\/|$)/u.test(destDir))) return undefined;
  if (extractMode && (!writeFile || !mkdir)) return undefined;

  let chosenArchive = archive;
  let bytes = readFile(archive);
  if (!bytes) {
    bytes = readFile(archive + ".zip");
    if (bytes) chosenArchive = archive + ".zip";
  }
  if (!bytes) {
    bytes = readFile(archive + ".ZIP");
    if (bytes) chosenArchive = archive + ".ZIP";
  }
  if (!bytes || bytes.byteLength < 22) return undefined;

  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocdOffset = -1;
    const lower = Math.max(0, bytes.byteLength - 22 - 65535);
    for (let off = bytes.byteLength - 22; off >= lower; off--) {
      if (view.getUint32(off, true) === 0x06054b50 && off + 22 + view.getUint16(off + 20, true) === bytes.byteLength) {
        eocdOffset = off;
        break;
      }
    }
    if (eocdOffset === -1) return undefined;
    const diskNum = view.getUint16(eocdOffset + 4, true);
    const cdDisk = view.getUint16(eocdOffset + 6, true);
    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdSize = view.getUint32(eocdOffset + 12, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const commentLen = view.getUint16(eocdOffset + 20, true);
    if (diskNum !== 0 || cdDisk !== 0 || totalEntries === 0 || totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff || commentLen !== 0) {
      return undefined;
    }
    if (cdOffset + cdSize > eocdOffset) return undefined;

    interface ParsedZipMember {
      name: string;
      method: number;
      flags: number;
      crc: number;
      compSize: number;
      uncompSize: number;
      dosTime: number;
      dosDate: number;
      localOffset: number;
      extraLen: number;
    }

    const members: ParsedZipMember[] = [];
    let ptr = cdOffset;
    for (let idx = 0; idx < totalEntries; idx++) {
      if (ptr + 46 > eocdOffset || view.getUint32(ptr, true) !== 0x02014b50) return undefined;
      const flags = view.getUint16(ptr + 8, true);
      if (flags & 1) return undefined;
      const method = view.getUint16(ptr + 10, true);
      const dosTime = view.getUint16(ptr + 12, true);
      const dosDate = view.getUint16(ptr + 14, true);
      const crc = view.getUint32(ptr + 16, true);
      const compSize = view.getUint32(ptr + 20, true);
      const uncompSize = view.getUint32(ptr + 24, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const entryCommentLen = view.getUint16(ptr + 32, true);
      const localOffset = view.getUint32(ptr + 42, true);
      if (entryCommentLen !== 0 || compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) return undefined;
      if (ptr + 46 + nameLen + extraLen > eocdOffset) return undefined;
      const nameBytes = bytes.subarray(ptr + 46, ptr + 46 + nameLen);
      if (nameBytes.includes(0) || ((flags & 0x800) === 0 && nameBytes.some(b => b >= 0x80))) return undefined;
      const name = fatalSyncTextDecoder.decode(nameBytes);
      members.push({ name, method, flags, crc, compSize, uncompSize, dosTime, dosDate, localOffset, extraLen });
      ptr += 46 + nameLen + extraLen + entryCommentLen;
    }

    const matchedPatterns = new Set<number>();
    const patRegexes = patterns.map(zipGlobToRe);
    const exRegexes = excludePatterns.map(zipGlobToRe);
    const selectedMembers: ParsedZipMember[] = [];
    for (const m of members) {
      if (exRegexes.some(re => re.test(m.name))) continue;
      if (patterns.length === 0) {
        selectedMembers.push(m);
      } else {
        let hit = false;
        for (let pIdx = 0; pIdx < patRegexes.length; pIdx++) {
          if (patRegexes[pIdx]!.test(m.name)) {
            hit = true;
            matchedPatterns.add(pIdx);
          }
        }
        if (hit) selectedMembers.push(m);
      }
    }

    if (selectedMembers.length === 0 || (patterns.length > 0 && matchedPatterns.size !== patterns.length)) {
      return undefined;
    }

    if (zipinfoNames) {
      let out = "";
      for (const m of selectedMembers) {
        out += `${filteredZipName(m.name)}\n`;
      }
      return out;
    }

    if (list) {
      for (const m of selectedMembers) {
        if (m.extraLen !== 0) return undefined;
      }
      let out = quiet === 0 ? `Archive:  ${filteredZipName(chosenArchive)}\n` : "";
      out += "  Length      Date    Time    Name\n---------  ---------- -----   ----\n";
      let totalSize = 0;
      const pad2 = (v: number) => String(v).padStart(2, "0");
      for (const m of selectedMembers) {
        totalSize += m.uncompSize;
        const year = ((m.dosDate >> 9) & 0x7f) + 1980;
        const month = (m.dosDate >> 5) & 0x0f;
        const day = m.dosDate & 0x1f;
        const hour = (m.dosTime >> 11) & 0x1f;
        const minute = (m.dosTime >> 5) & 0x3f;
        const dStr = `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`;
        out += `${String(m.uncompSize).padStart(9)}  ${dStr}   ${filteredZipName(m.name)}\n`;
      }
      out += `---------                     -------\n${String(totalSize).padStart(9)}                     ${selectedMembers.length} file${selectedMembers.length === 1 ? "" : "s"}\n`;
      return out;
    }

    if (testMode || extractMode) {
      let out = quiet === 0 ? `Archive:  ${filteredZipName(chosenArchive)}\n` : "";
      const staged: { isDir: boolean; path: string; shown: string; method: number; bytes: Uint8Array }[] = [];
      for (const m of selectedMembers) {
        if (m.localOffset + 30 > bytes.byteLength || view.getUint32(m.localOffset, true) !== 0x04034b50) return undefined;
        const lNameLen = view.getUint16(m.localOffset + 26, true);
        const lExtraLen = view.getUint16(m.localOffset + 28, true);
        const dataStart = m.localOffset + 30 + lNameLen + lExtraLen;
        const dataEnd = dataStart + m.compSize;
        if (dataEnd > bytes.byteLength) return undefined;
        const compSlice = bytes.subarray(dataStart, dataEnd);
        let decoded: Uint8Array;
        if (m.method === 0) {
          decoded = compSlice;
        } else if (m.method === 8) {
          decoded = inflateRawSync(compSlice);
        } else {
          return undefined;
        }
        if (decoded.byteLength !== m.uncompSize || crc32(decoded) !== m.crc) return undefined;
        if (testMode) {
          if (quiet === 0) {
            const fn = filteredZipName(m.name);
            const pad = fn + " ".repeat(Math.max(0, 22 - new TextEncoder().encode(fn).byteLength));
            out += `    testing: ${pad} OK\n`;
          }
        } else {
          const isDir = m.name.endsWith("/");
          const clean = m.name.replace(/\/+$/u, "");
          if (!clean || clean.startsWith("/") || clean.split("/").some(seg => !seg || seg === "." || seg === "..")) return undefined;
          const targetPath = destDir ? `${destDir.replace(/\/+$/u, "")}/${clean}` : clean;
          const shown = destDir === undefined ? m.name : `${destDir.endsWith("/") ? destDir : `${destDir}/`}${m.name}`;
          staged.push({ isDir, path: targetPath, shown, method: m.method, bytes: decoded });
        }
      }
      if (testMode) {
        if (quiet < 2) out += `No errors detected in compressed data of ${filteredZipName(chosenArchive)}.\n`;
        return out;
      }
      for (const item of staged) {
        if (!item.isDir && !overwrite && readFile(item.path) !== undefined) {
          return undefined;
        }
      }
      for (const item of staged) {
        if (item.isDir) {
          if (!mkdir!(item.path, 0o755)) return undefined;
          if (quiet === 0) out += `   creating: ${filteredZipName(item.shown)}\n`;
        } else {
          const slash = item.path.lastIndexOf("/");
          if (slash > 0 && !mkdir!(item.path.slice(0, slash), 0o755)) return undefined;
          if (!writeFile!(item.path, item.bytes, 0o644)) return undefined;
          if (quiet === 0) {
            const fn = filteredZipName(item.shown);
            const pad = fn + " ".repeat(Math.max(0, 22 - new TextEncoder().encode(fn).byteLength));
            out += `${item.method === 0 ? " extracting" : "  inflating"}: ${pad}  \n`;
          }
        }
      }
      return out;
    }

    if (pipe) {
      let out = "";
      for (const m of selectedMembers) {
        if (m.localOffset + 30 > bytes.byteLength || view.getUint32(m.localOffset, true) !== 0x04034b50) return undefined;
        const lNameLen = view.getUint16(m.localOffset + 26, true);
        const lExtraLen = view.getUint16(m.localOffset + 28, true);
        const dataStart = m.localOffset + 30 + lNameLen + lExtraLen;
        const dataEnd = dataStart + m.compSize;
        if (dataEnd > bytes.byteLength) return undefined;
        const compSlice = bytes.subarray(dataStart, dataEnd);
        let decoded: Uint8Array;
        if (m.method === 0) {
          decoded = compSlice;
        } else if (m.method === 8) {
          decoded = new Uint8Array(inflateRawSync(compSlice));
        } else {
          return undefined;
        }
        if (decoded.byteLength !== m.uncompSize || crc32(decoded) !== m.crc) return undefined;
        if (decoded.includes(0)) return undefined;
        out += fatalSyncTextDecoder.decode(decoded);
      }
      return out;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
