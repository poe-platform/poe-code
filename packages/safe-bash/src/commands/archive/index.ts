import { readBytes, writeBytes, type ByteSource, type CommandContext, type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { escapeText } from "../../escaping.js";
import { createArchive, manifest } from "./create.js";
import { readArchive } from "./extract.js";
import { Budget, bounded, display, fail, fileSource, maybeStat, operation, publish, sameIdentity, settings, vfsPath, type ArchiveCommandsOptions } from "./internal.js";
import { parseOptions } from "./options.js";
import { compressed } from "./stream.js";

export { DEFAULT_ARCHIVE_LIMITS } from "./internal.js";
export type { ArchiveCommandsOptions, ArchiveLimits } from "./internal.js";

export function createTarCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "tar", description: "Stream USTAR/PAX archives through the virtual filesystem", async execute(original) {
    original.signal.throwIfAborted();
    const controller = new AbortController();
    const signal = AbortSignal.any([original.signal, controller.signal]);
    const context: CommandContext = { ...original, signal };
    try {
      const parsed = await parseOptions(context, limits);
      const budget = new Budget(context, limits);
      if (parsed.mode === "c") {
        const prepared = await manifest(context, parsed, budget);
        let source: ByteSource = bounded(createArchive(context, prepared.entries, parsed, budget), limits.maxArchiveBytes, signal, limits.chunkSize);
        if (parsed.gzip) source = compressed(source, false, signal, limits);
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
        if (parsed.gzip) source = compressed(source, true, signal, limits);
        await readArchive(context, source, parsed, budget);
      }
      return { exitCode: 0 };
    } catch (error) {
      controller.abort(error);
      original.signal.throwIfAborted();
      const message = escapeText(display((error instanceof Error ? error.message : String(error)).slice(0, 1024)), "diagnostic");
      await writeBytes(original.stderr, Buffer.from(`tar: ${message}\n`).subarray(0, limits.maxDiagnosticBytes), original.signal);
      return { exitCode: 2 };
    } finally { controller.abort(new Error("tar command finished")); }
  } };
}

export function createArchiveCommands(options: ArchiveCommandsOptions = {}): readonly CommandDefinition[] {
  return [createTarCommand(options)];
}

export function archiveCommands(options: ArchiveCommandsOptions = {}): VirtualShellPlugin {
  const commands = createArchiveCommands(options);
  return { name: "archive-commands", setup(host) {
    if (!options.replace && host.commands.has("tar")) throw new Error("Command already registered: tar");
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
