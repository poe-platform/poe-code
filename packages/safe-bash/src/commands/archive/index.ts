import { ungzip as gunzipSync, inflateRaw as inflateRawSync } from "pako";
import { publicDiagnosticMessage } from "../../diagnostics.js";
import { builtInDirectContextExecutors } from "../internal.js";
import { readBytes, writeBytes, type ByteSource, type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { escapeText } from "../../escaping.js";
import { createArchive, manifest } from "./create.js";
import { extractionInput, readArchive } from "./extract.js";
import { Budget, bounded, display, fail, invocationLimits, maybeStat, operation, publish, sameIdentity, settings, vfsPath, type ArchiveCommandsOptions } from "./internal.js";
import { parseOptions } from "./options.js";
import { compareArchive, mutateArchive } from "./modes.js";
import { autodetected, compressed, recorded } from "./stream.js";
import { createZipCommand as createBaseZipCommand } from "./zip.js";
import { createUnzipCommand as createBaseUnzipCommand } from "./unzip.js";
import { zipHelp, zipExtendedHelp, zipVersion, zipLicense } from "./zip/help.js";
import { parseHeader, parsePax, applyPax, type ReadEntry } from "./format.js";
import { quoteName } from "./listing.js";
import { crc32 } from "./zip-format.js";

export { DEFAULT_ARCHIVE_LIMITS } from "./internal.js";
export function createZipCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
  const def = createBaseZipCommand(options);
  if (options.limits === undefined && options.zipHost === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}
export function createUnzipCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
  const def = createBaseUnzipCommand(options);
  if (options.limits === undefined && options.zipHost === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}
export type { ArchiveCommandsOptions, ArchiveLimits, ZipHost, ZipEncryptionProfile } from "./internal.js";

export function createTarCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
  const configured = settings(options);
  const def: CommandDefinition = { name: "tar", description: "Stream USTAR/PAX archives through the virtual filesystem", async execute(original) {
    const limits = invocationLimits(configured, original);
    original.signal.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([original.signal, controller.signal]);
    const context: CommandContext = { ...original, signal };
    try {
      const parsed = await parseOptions(context, limits);
      if (parsed === "help") {
        await writeBytes(context.stdout, Buffer.from(`Usage: tar [OPTION]... [FILE]...
Create, read or modify USTAR/PAX archives in the virtual filesystem.

  -c, --create             Create an archive
  -t, --list               List archive members
  -x, --extract, --get      Extract archive members
  -O, --to-stdout          Extract file contents to standard output
  -r, --append             Append files to an uncompressed archive
  -u, --update             Append files newer than archived members
  -d, --compare, --diff    Compare archive members with filesystem entries
      --delete            Delete selected archive members
  -A, --catenate, --concatenate Append archives to an uncompressed archive
  -f, --file=ARCHIVE        Use ARCHIVE (default - for standard input/output)
  -z, --gzip               Use gzip compression
  -j, --bzip2              Use bzip2 compression
  -J, --xz                 Use xz compression
  -a, --auto-compress      Select output compression by archive suffix
  -b, --blocking-factor=N  Use N 512-byte blocks per output record
      --record-size=SIZE  Set output record bytes (multiple of 512; K/M/G suffixes)
  -B, --read-full-records  Join short reads (always enabled for VFS streams)
  -i, --ignore-zeros       Read past zero blocks, including concatenated archives
  -n, --seek               Accept seekable input; VFS reads remain sequential
      --no-seek           Read sequentially
      --force-local       Treat archive names as local VFS paths (always enabled)
      --utc               Show UTC timestamps; implies verbose listing
      --quoting-style=STYLE Display literal, escape (default), or c filenames
      --totals            Report archive bytes read or written to stderr
  -v, --verbose            List processed members
  -C, --directory=DIR      Change directory for subsequent operands
  -T, --files-from=FILE    Read filenames from FILE (- for standard input)
      --null              Read NUL-delimited filenames; implies verbatim names
      --no-null           Read newline-delimited filenames
      --verbatim-files-from Treat file-list entries as literal filenames
      --no-verbatim-files-from Enable supported file-list directory options
      --exclude=PATTERN   Exclude paths (place before source operands)
      --exclude-caches    Keep cache directories and tags, omit other contents
      --sort=ORDER        Order directory children by name or none (default)
  -h, --dereference       Archive symbolic-link targets during creation
  -X, --exclude-from=FILE Read newline-delimited exclusion patterns
      --wildcards         Select archive members with anchored glob patterns
      --no-wildcards      Select literal member names (default)
      --occurrence[=NUM]  Select only occurrence NUM of each operand (default 1)
      --strip-components=NUM Remove leading components when reading archives
      --transform=EXPR    Substitute member names when listing (s/old/new/[gix])
      --show-transformed-names Display transformed names in archive listings
      --format=FORMAT     Create pax (default), posix or ustar archives
      --mtime=DATE        Override creation mtime (@seconds or ISO/RFC date)
      --owner=ID          Override numeric creation owner
      --group=ID          Override numeric creation group
      --mode=OCTAL        Override creation permission bits
      --numeric-owner     Use numeric ownership IDs
      --full-time         Show full UTC timestamps in verbose listings
  -m, --touch              Retain current extraction timestamps
  -p, --same-permissions   Restore ordinary archive permission bits
      --no-same-permissions Apply virtual 022 mask to ordinary permissions
      --no-same-owner     Retain filesystem-assigned ownership
      --atime-preserve[=replace] Restore source access times after creation
      --delay-directory-restore Restore directory metadata at archive end
      --no-delay-directory-restore Restore after leaving each directory subtree
  -k, --keep-old-files     Keep existing files and report conflicts as errors
      --skip-old-files    Skip existing files without reporting errors
      --overwrite         Replace existing entries using safe extraction checks
      --help              Display this help and exit
      --                  End options; remaining arguments are filenames

Exactly one of -c, -t, -x, -r, -u, -d, --delete or -A is required.
When reading, gzip, bzip2 and xz compression is detected from archive bytes.
Examples: tar cf archive.tar file; tar tf archive.tar; tar xf archive.tar -C directory
`), signal);
        return { exitCode: 0 };
      }
      const budget = new Budget(context, limits);
      if (parsed.mode === "d") return { exitCode: await compareArchive(context, parsed, budget) };
      if (parsed.mode === "r" || parsed.mode === "u" || parsed.mode === "delete" || parsed.mode === "A") {
        await mutateArchive(context, parsed, budget);
        return { exitCode: 0 };
      }
      if (parsed.mode === "c") {
        const prepared = await manifest(context, parsed, budget);
        let source: ByteSource = bounded(recorded(createArchive(context, prepared.entries, parsed, budget), parsed, budget), limits.maxArchiveBytes, signal, limits.chunkSize);
        if (parsed.compression) source = compressed(source, false, signal, limits, parsed.compression);
        if (prepared.output) {
          const existing = await maybeStat(context, prepared.output);
          if (existing && existing.type !== "file") fail("output archive changed to a non-file");
          if (existing && (!prepared.outputStat || !sameIdentity(existing, prepared.outputStat))) fail("output archive backing entry changed during preparation");
          if (existing) await operation(context, () => context.fs.rm(prepared.output!, { signal }));
          await publish(context, prepared.output, source);
        } else {
          for await (const chunk of readBytes(source, signal)) await writeBytes(context.stdout, chunk, signal);
        }
      } else {
        let source = bounded(parsed.archive === "-" ? context.stdin : extractionInput(context, vfsPath(context.cwd, parsed.archive), limits), limits.maxArchiveBytes, signal, limits.chunkSize);
        source = parsed.compression ? compressed(source, true, signal, limits, parsed.compression) : autodetected(source, signal, limits);
        await readArchive(context, source, parsed, budget);
      }
      return { exitCode: 0 };
    } catch (error) {
      controller.abort(error);
      original.signal.throwIfAborted();
      const message = escapeText(display((publicDiagnosticMessage(error, original.onInternalError)).slice(0, 1024)), "diagnostic");
      await writeBytes(original.stderr, Buffer.from(`tar: ${message}\n`).subarray(0, limits.maxDiagnosticBytes), original.signal);
      return { exitCode: 2 };
    } finally { controller.abort(new Error("tar command finished")); }
  } };
  if (options.limits === undefined && options.zipHost === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createArchiveCommands(options: ArchiveCommandsOptions = {}): readonly CommandDefinition[] {
  return [createTarCommand(options), createZipCommand(options), createUnzipCommand(options)];
}

export function archiveCommands(options: ArchiveCommandsOptions = {}): VirtualShellPlugin {
  const commands = createArchiveCommands(options);
  return { name: "archive-commands", setup(host) {
    if (!options.replace) {
      for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}

const TAR_HELP_TEXT = `Usage: tar [OPTION...] [FILE...]
Create, list, compare, mutate or extract tar archives inside the virtual filesystem.

  -c, --create             Create a new archive
  -t, --list               List the contents of an archive
  -x, --extract, --get     Extract files from an archive
  -r, --append             Append files to the end of an archive
  -u, --update             Only append files newer than copy in archive
  -d, --diff, --compare    Find differences between archive and file system
      --delete             Delete from the archive
  -A, --catenate, --concatenate Append tar files to an archive
  -f, --file=ARCHIVE       Use archive file or - for stdio (default -)
  -C, --directory=DIR      Change to DIR before subsequent operations
  -v, --verbose            Verbosely list files processed
  -z, --gzip, --gunzip     Filter the archive through gzip
  -j, --bzip2              Filter the archive through bzip2
  -J, --xz                 Filter the archive through xz
  -O, --to-stdout          Extract files to standard output
      --exclude=PATTERN    Exclude files matching PATTERN
  -T, --files-from=FILE    Get names to extract or create from FILE
  -X, --exclude-from=FILE  Exclude patterns listed in FILE
      --null               -T reads NUL-terminated verbatim names
      --no-null            Undo a previous --null option
      --recursion          Recurse into directories (default)
      --no-recursion       Avoid descending automatically in directories
      --wildcards          Select archive members with anchored glob patterns
      --no-wildcards       Select literal member names (default)
      --occurrence[=NUM]   Select only occurrence NUM of each operand (default 1)
      --strip-components=NUM Remove leading components when reading archives
      --transform=EXPR     Substitute member names when listing (s/old/new/[gix])
      --show-transformed-names Display transformed names in archive listings
      --format=FORMAT      Create pax (default), posix or ustar archives
      --mtime=DATE         Override creation mtime (@seconds or ISO/RFC date)
      --owner=ID           Override numeric creation owner
      --group=ID           Override numeric creation group
      --mode=OCTAL         Override creation permission bits
      --numeric-owner      Use numeric ownership IDs
      --full-time          Show full UTC timestamps in verbose listings
  -m, --touch              Retain current extraction timestamps
  -p, --same-permissions   Restore ordinary archive permission bits
      --no-same-permissions Apply virtual 022 mask to ordinary permissions
      --no-same-owner      Retain filesystem-assigned ownership
      --atime-preserve[=replace] Restore source access times after creation
      --delay-directory-restore Restore directory metadata at archive end
      --no-delay-directory-restore Restore after leaving each directory subtree
  -k, --keep-old-files     Keep existing files and report conflicts as errors
      --skip-old-files     Skip existing files without reporting errors
      --overwrite          Replace existing entries using safe extraction checks
      --help               Display this help and exit
      --                   End options; remaining arguments are filenames

Exactly one of -c, -t, -x, -r, -u, -d, --delete or -A is required.
When reading, gzip, bzip2 and xz compression is detected from archive bytes.
Examples: tar cf archive.tar file; tar tf archive.tar; tar xf archive.tar -C directory
`;

const syncTextDecoder = new TextDecoder();

export function evalSyncZip(args: readonly string[]): string | undefined {
  if (args.length === 1) {
    const a = args[0]!;
    if (a === "-h" || a === "--help" || a === "-?") return zipHelp;
    if (a === "-h2" || a === "--more-help") return zipExtendedHelp;
    if (a === "-v" || a === "--version") return zipVersion;
    if (a === "-L" || a === "--license") return zipLicense;
  }
  return undefined;
}

export function evalSyncTar(
  stdinBytes: Uint8Array | undefined,
  args: readonly string[],
  readFile?: (path: string) => Uint8Array | undefined,
  writeFile?: (path: string, bytes: Uint8Array, mode?: number) => boolean,
  mkdir?: (path: string, mode?: number) => boolean,
): string | undefined {
  if (args.length === 1 && args[0] === "--help") {
    return TAR_HELP_TEXT;
  }
  if (args.length === 0) return undefined;
  let mode: "t" | "x" | undefined;
  let toStdout = false;
  let verbose = false;
  let gzip = false;
  let wildcards = false;
  let stripComponents = 0;
  let targetDir = "";
  let archive = "-";
  const excludes: string[] = [];
  const operands: string[] = [];
  const globToRe = (pat: string): RegExp => {
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
    return new RegExp(re + "$", "u");
  };
  let i = 0;
  let bundledHandled = false;
  while (i < args.length) {
    const a = args[i]!;
    if (i === 0 && !a.startsWith("-") && a.length > 0) {
      bundledHandled = true;
      for (let c = 0; c < a.length; c++) {
        const ch = a[c]!;
        if (ch === "t") { if (mode) return undefined; mode = "t"; }
        else if (ch === "x") { if (mode) return undefined; mode = "x"; }
        else if (ch === "O") toStdout = true;
        else if (ch === "v") verbose = true;
        else if (ch === "z") gzip = true;
        else if (ch === "C") {
          const next = args[++i];
          if (!next) return undefined;
          targetDir = next;
        } else if (ch === "f") {
          const next = args[++i];
          if (!next) return undefined;
          archive = next;
        } else return undefined;
      }
      i++;
      continue;
    }
    if (a === "--") {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a === "--list") { if (mode) return undefined; mode = "t"; i++; continue; }
    if (a === "--extract" || a === "--get") { if (mode) return undefined; mode = "x"; i++; continue; }
    if (a === "--to-stdout") { toStdout = true; i++; continue; }
    if (a === "--verbose") { verbose = true; i++; continue; }
    if (a === "--directory" || a.startsWith("--directory=")) {
      const d = a === "--directory" ? args[++i] : a.slice(12);
      if (!d) return undefined;
      targetDir = d;
      i++;
      continue;
    }
    if (a === "--gzip" || a === "--gunzip") { gzip = true; i++; continue; }
    if (a === "--wildcards") { wildcards = true; i++; continue; }
    if (a === "--exclude" || a.startsWith("--exclude=")) {
      const ex = a === "--exclude" ? args[++i] : a.slice(10);
      if (!ex) return undefined;
      excludes.push(ex);
      i++;
      continue;
    }
    if (a === "--strip-components" || a.startsWith("--strip-components=") || a.startsWith("--strip=")) {
      const raw = a === "--strip-components" ? args[++i] : a.slice(a.indexOf("=") + 1);
      const v = Number(raw);
      if (!raw || !Number.isSafeInteger(v) || v < 0) return undefined;
      stripComponents = v;
      i++;
      continue;
    }
    if (a.startsWith("--file=")) { archive = a.slice(7); i++; continue; }
    if (a.startsWith("-") && a !== "-") {
      if (a.startsWith("--")) return undefined;
      for (let c = 1; c < a.length; c++) {
        const ch = a[c]!;
        if (ch === "t") { if (mode) return undefined; mode = "t"; }
        else if (ch === "x") { if (mode) return undefined; mode = "x"; }
        else if (ch === "O") toStdout = true;
        else if (ch === "v") verbose = true;
        else if (ch === "z") gzip = true;
        else if (ch === "C") {
          const rest = a.slice(c + 1);
          if (rest) { targetDir = rest; break; }
          const next = args[++i];
          if (!next) return undefined;
          targetDir = next;
          break;
        } else if (ch === "f") {
          const rest = a.slice(c + 1);
          if (rest) { archive = rest; break; }
          const next = args[++i];
          if (!next) return undefined;
          archive = next;
          break;
        } else return undefined;
      }
      i++;
      continue;
    }
    operands.push(a);
    i++;
  }
  void bundledHandled;
  if (!mode) return undefined;
  if (mode === "t" && verbose) return undefined;
  if (mode === "x" && !toStdout && (!writeFile || !mkdir)) return undefined;

  let raw: Uint8Array | undefined;
  if (archive === "-") {
    raw = stdinBytes;
  } else {
    if (!readFile) return undefined;
    raw = readFile(archive);
  }
  if (!raw || raw.byteLength === 0) return undefined;

  try {
    let tarBytes = raw;
    const isGzipMagic = raw.byteLength >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    if (gzip || isGzipMagic) {
      tarBytes = new Uint8Array(gunzipSync(raw));
    } else if (
      (raw.byteLength >= 3 && raw[0] === 0x42 && raw[1] === 0x5a && raw[2] === 0x68) ||
      (raw.byteLength >= 6 && raw[0] === 0xfd && raw[1] === 0x37 && raw[2] === 0x7a && raw[3] === 0x58 && raw[4] === 0x5a && raw[5] === 0x00)
    ) {
      return undefined;
    }

    const globalPax = new Map<string, string>();
    let localPax = new Map<string, string>();
    let longName: string | undefined;
    let longLink: string | undefined;
    const matchedOperands = new Set<number>();
    let out = "";
    let offset = 0;

    while (offset + 512 <= tarBytes.byteLength) {
      const headerSlice = tarBytes.subarray(offset, offset + 512);
      offset += 512;
      let allZero = true;
      for (let k = 0; k < 512; k++) {
        if (headerSlice[k] !== 0) { allZero = false; break; }
      }
      if (allZero) break;

      const header = parseHeader(headerSlice);
      const tempEntry = applyPax(header, new Map(), new Map());
      const payloadEnd = offset + tempEntry.size;
      if (payloadEnd > tarBytes.byteLength) return undefined;
      const payload = tarBytes.subarray(offset, payloadEnd);
      offset += Math.ceil(tempEntry.size / 512) * 512;

      if (header.type === "g") {
        for (const [k, v] of parsePax(payload)) globalPax.set(k, v);
        continue;
      }
      if (header.type === "x") {
        localPax = parsePax(payload);
        continue;
      }
      if (header.type === "L") {
        const nul = payload.indexOf(0);
        longName = syncTextDecoder.decode(nul === -1 ? payload : payload.subarray(0, nul));
        continue;
      }
      if (header.type === "K") {
        const nul = payload.indexOf(0);
        longLink = syncTextDecoder.decode(nul === -1 ? payload : payload.subarray(0, nul));
        continue;
      }

      const entry: ReadEntry = applyPax(header, globalPax, localPax, longName, longLink);
      localPax = new Map();
      longName = undefined;
      longLink = undefined;

      if (entry.name.startsWith("/")) return undefined;

      const cleanEntry = entry.name.replace(/\/+$/u, "");
      if (excludes.length > 0) {
        const baseName = cleanEntry.slice(cleanEntry.lastIndexOf("/") + 1);
        let isExcluded = false;
        for (const ex of excludes) {
          const exRe = globToRe(ex.replace(/\/+$/u, ""));
          if (exRe.test(cleanEntry) || exRe.test(baseName)) { isExcluded = true; break; }
        }
        if (isExcluded) continue;
      }

      let selected = operands.length === 0;
      if (!selected) {
        for (let opIdx = 0; opIdx < operands.length; opIdx++) {
          const cleanOp = operands[opIdx]!.replace(/\/+$/u, "");
          if (wildcards && (cleanOp.includes("*") || cleanOp.includes("?") || cleanOp.includes("["))) {
            const opRe = globToRe(cleanOp);
            if (opRe.test(cleanEntry) || opRe.test(cleanEntry.slice(cleanEntry.lastIndexOf("/") + 1))) {
              selected = true;
              matchedOperands.add(opIdx);
            }
          } else if (cleanEntry === cleanOp || cleanEntry.startsWith(cleanOp + "/")) {
            selected = true;
            matchedOperands.add(opIdx);
          }
        }
      }
      if (!selected) continue;

      let displayEntryName = entry.name;
      if (stripComponents > 0) {
        const hasTrailingSlash = displayEntryName.endsWith("/");
        const segs = cleanEntry.split("/").filter(Boolean);
        if (segs.length <= stripComponents) continue;
        displayEntryName = segs.slice(stripComponents).join("/") + (hasTrailingSlash ? "/" : "");
      }

      if (mode === "t") {
        out += `${quoteName(displayEntryName, "escape")}\n`;
      } else if (mode === "x" && toStdout) {
        if (entry.type === "0") {
          out += syncTextDecoder.decode(payload);
        }
      } else if (mode === "x") {
        const relClean = displayEntryName.replace(/\/+$/u, "");
        if (!relClean || relClean.split("/").includes("..")) return undefined;
        const destPath = targetDir ? `${targetDir.replace(/\/+$/u, "")}/${relClean}` : relClean;
        if (entry.type === "5") {
          extractActions.push({ isDir: true, path: destPath, bytes: new Uint8Array(0), mode: entry.mode || 0o755 });
        } else if (entry.type === "0") {
          extractActions.push({ isDir: false, path: destPath, bytes: payload.slice(), mode: entry.mode || 0o644 });
        } else {
          return undefined;
        }
        if (verbose) out += `${quoteName(displayEntryName, "escape")}\n`;
      }
    }

    if (operands.length > 0 && matchedOperands.size !== operands.length) {
      return undefined;
    }
    if (mode === "x" && !toStdout) {
      for (const act of extractActions) {
        if (act.isDir) {
          if (!mkdir!(act.path, act.mode)) return undefined;
        } else {
          const slash = act.path.lastIndexOf("/");
          if (slash > 0 && !mkdir!(act.path.slice(0, slash), 0o755)) return undefined;
          if (!writeFile!(act.path, act.bytes, act.mode)) return undefined;
        }
      }
    }
    return out;
  } catch {
    return undefined;
  }
}

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
  void overwrite;
  if (!archive) return undefined;
  const modeCount = (zipinfoNames ? 1 : 0) + (pipe ? 1 : 0) + (list ? 1 : 0) + (testMode ? 1 : 0);
  if (modeCount > 1) return undefined;
  const extractMode = modeCount === 0;
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
      const name = syncTextDecoder.decode(nameBytes);
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
          if (!clean || clean.startsWith("/") || clean.split("/").includes("..")) return undefined;
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
        out += syncTextDecoder.decode(decoded);
      }
      return out;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
