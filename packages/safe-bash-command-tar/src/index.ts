import { withInputByteBudget } from "safe-bash-contracts";

import { ungzip as gunzipSync } from "pako";
import { createArchive,manifest } from "./create.js";
import { extractionInput,readArchive } from "./extract.js";
import { applyPax,parseHeader,parsePax,type ReadEntry } from "./format.js";
import { quoteName } from "./listing.js";
import { compareArchive,mutateArchive } from "./modes.js";
import { parseOptions } from "./options.js";
import { autodetected,compressed,recorded } from "./stream.js";
import { readBytes,writeBytes,type ByteSource,type CommandContext,type CommandDefinition,type VirtualShellPlugin } from "safe-bash-contracts";
import { publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { escapeText } from "safe-bash-contracts/escaping";
import { encodeBytes } from "safe-bash-io-engine/byte-encoding";
import { Budget,bounded,display,fail,invocationLimits,maybeStat,operation,publish,sameIdentity,settings,vfsPath,type ArchiveCommandsOptions } from "safe-bash-io-engine/commands/archive/internal";
import { builtInDirectContextExecutors } from "safe-bash-io-engine/internal";

export { DEFAULT_ARCHIVE_LIMITS } from "safe-bash-io-engine/commands/archive/internal";
export type { ArchiveCommandsOptions,ArchiveLimits,ArchiveCommandsOptions as TarCommandsOptions,ArchiveLimits as TarLimits,ZipEncryptionProfile,ZipHost } from "safe-bash-io-engine/commands/archive/internal";

export function createTarCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
  const configured = settings(options);
  const def: CommandDefinition = { name: "tar", description: "Stream USTAR/PAX archives through the virtual filesystem", execute: withInputByteBudget(async (original) => {
    const limits = invocationLimits(configured, original);
    original.signal.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([original.signal, controller.signal]);
    const context: CommandContext = { ...original, signal };
    try {
      const parsed = await parseOptions(context, limits);
      if (parsed === "help") {
        await writeBytes(context.stdout, encodeBytes(`Usage: tar [OPTION]... [FILE]...
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
      await writeBytes(original.stderr, encodeBytes(`tar: ${message}\n`).subarray(0, limits.maxDiagnosticBytes), original.signal);
      return { exitCode: 2 };
    } finally { controller.abort(new Error("tar command finished")); }
  }) };
  if (options.limits === undefined && options.zipHost === undefined) builtInDirectContextExecutors.add(def.execute);
  return def;
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
    const extractActions: { isDir: boolean; path: string; bytes: Uint8Array; mode: number }[] = [];
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
export function createTarCommands(options: ArchiveCommandsOptions = {}): readonly CommandDefinition[] { return [createTarCommand(options)]; }
export function tarCommands(options: ArchiveCommandsOptions = {}): VirtualShellPlugin {
  const commands = createTarCommands(options);
  return { name: "tar-commands", setup(host) {
    if (!options.replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}

import { syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
syncCommandEvaluators.evalSyncTar = evalSyncTar;
