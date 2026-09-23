import { publicDiagnosticMessage } from "../../diagnostics.js";
import { readBytes, writeBytes, type ByteSource, type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { escapeText } from "../../escaping.js";
import { createArchive, manifest } from "./create.js";
import { readArchive } from "./extract.js";
import { Budget, bounded, display, fail, fileSource, maybeStat, operation, publish, sameIdentity, settings, vfsPath, type ArchiveCommandsOptions } from "./internal.js";
import { parseOptions } from "./options.js";
import { autodetected, compressed } from "./stream.js";
import { createZipCommand } from "./zip.js";
import { createUnzipCommand } from "./unzip.js";

export { DEFAULT_ARCHIVE_LIMITS } from "./internal.js";
export { createZipCommand } from "./zip.js";
export { createUnzipCommand } from "./unzip.js";
export type { ArchiveCommandsOptions, ArchiveLimits, ZipHost, ZipEncryptionProfile } from "./internal.js";

export function createTarCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "tar", description: "Stream USTAR/PAX archives through the virtual filesystem", async execute(original) {
    original.signal.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([original.signal, controller.signal]);
    const context: CommandContext = { ...original, signal };
    try {
      const parsed = await parseOptions(context, limits);
      if (parsed === "help") {
        await writeBytes(context.stdout, Buffer.from(`Usage: tar [OPTION]... [FILE]...
Create, list or extract USTAR/PAX archives in the virtual filesystem.

  -c, --create             Create an archive
  -t, --list               List archive members
  -x, --extract, --get      Extract archive members
  -f, --file=ARCHIVE        Use ARCHIVE (default - for standard input/output)
  -z, --gzip               Use gzip compression
  -j, --bzip2              Use bzip2 compression
  -J, --xz                 Use xz compression
  -a, --auto-compress      Select output compression by archive suffix
  -v, --verbose            List processed members
  -C, --directory=DIR      Change directory for subsequent operands
  -T, --files-from=FILE    Read filenames from FILE (- for standard input)
      --null              Read NUL-delimited filenames; implies verbatim names
      --no-null           Read newline-delimited filenames
      --verbatim-files-from Treat file-list entries as literal filenames
      --no-verbatim-files-from Enable supported file-list directory options
      --exclude=PATTERN   Exclude paths (place before source operands)
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
      --help              Display this help and exit
      --                  End options; remaining arguments are filenames

Exactly one of -c, -t or -x is required for archive operations.
When reading, gzip, bzip2 and xz compression is detected from archive bytes.
Examples: tar cf archive.tar file; tar tf archive.tar; tar xf archive.tar -C directory
`), signal);
        return { exitCode: 0 };
      }
      const budget = new Budget(context, limits);
      if (parsed.mode === "c") {
        const prepared = await manifest(context, parsed, budget);
        let source: ByteSource = bounded(createArchive(context, prepared.entries, parsed, budget), limits.maxArchiveBytes, signal, limits.chunkSize);
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
        let source = bounded(parsed.archive === "-" ? context.stdin : fileSource(context, vfsPath(context.cwd, parsed.archive), limits), limits.maxArchiveBytes, signal, limits.chunkSize);
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
