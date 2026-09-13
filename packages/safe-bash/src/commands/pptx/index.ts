import { collectBytes, FsError, getCommandArguments, writeBytes, type CommandDefinition, type FileStat, type VirtualShellPlugin } from "../../contracts/index.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { compareObservedEntries } from "../copy-identity.js";
import { pathOf } from "../internal.js";
import { inputRequirements } from "../portable-requirements.js";

export interface PptxCommandEngine {
  execute(request: {
    readonly args: readonly Uint8Array[];
    readonly signal: AbortSignal;
    readonly readInput: (path: string, maxBytes: number) => Promise<Uint8Array>;
    readonly publishOutput?: (publication: {
      readonly inputPath: string;
      readonly outputPath: string;
      readonly bytes: Uint8Array;
      readonly originalBytes: Uint8Array;
      readonly inPlace: boolean;
      readonly force: boolean;
      readonly dryRun: boolean;
    }) => Promise<void>;
  }): Promise<{
    readonly exitCode: number;
    readonly stdout: Uint8Array;
    readonly stderr: Uint8Array;
  }>;
}

export interface PptxCommandsOptions {
  readonly engine: PptxCommandEngine;
  readonly replace?: boolean;
}

export function createPptxCommands(options: PptxCommandsOptions): readonly CommandDefinition[] {
  if (!options?.engine || typeof options.engine.execute !== "function") throw new TypeError("An explicit pptx command engine is required.");
  if (options.replace !== undefined && typeof options.replace !== "boolean") throw new TypeError("pptx replace must be boolean");
  const engine = options.engine;
  return [{ name: "pptx", filesystemRequirements: inputRequirements, async execute(context) {
    const arguments_ = getCommandArguments(context);
    const snapshots = new Map<string, FileStat>();
    const result = await engine.execute({
      args: arguments_.args.map((_, index) => arguments_.bytes(index)!),
      signal: context.signal,
      async readInput(path, maxBytes) {
        try {
          context.signal.throwIfAborted();
          if (path === "-") return await collectBytes(context.stdin, { maxBytes, signal: context.signal });
          const resolved = pathOf(context, path);
          if (!snapshots.has(resolved)) {
            try { snapshots.set(resolved, await context.fs.lstat(resolved, { signal: context.signal })); }
            catch { context.signal.throwIfAborted(); }
          }
          const capabilities = await context.fs.capabilitiesFor?.(resolved, { signal: context.signal }) ?? context.fs.capabilities;
          context.signal.throwIfAborted();
          if (context.fs.readStream && capabilities.streamingRead !== false) {
            let emitted = false;
            try {
              const stream = context.fs.readStream(resolved, { signal: context.signal });
              return await collectBytes((async function* () {
                for await (const chunk of stream) {
                  if (chunk.byteLength) emitted = true;
                  yield chunk;
                }
              })(), { maxBytes, signal: context.signal });
            } catch (error) {
              context.signal.throwIfAborted();
              if (emitted || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
            }
          }
          if (capabilities.read === false) throw new FsError("ENOTSUP");
          const bytes = await context.fs.readFile(resolved, { maxBytes, signal: context.signal });
          context.signal.throwIfAborted();
          if (bytes.byteLength > maxBytes) throw new FsError("EFBIG");
          return bytes;
        } catch (error) {
          context.signal.throwIfAborted();
          throw Object.assign(new Error("Input could not be read."), { code: error instanceof FsError && error.code === "EFBIG" ? "resource-limit" : "io-failure" });
        }
      },
      async publishOutput(publication) {
        try {
          const { fs, signal } = context;
          signal.throwIfAborted();
          const input = publication.inputPath === "-" ? undefined : pathOf(context, publication.inputPath);
          const output = pathOf(context, publication.outputPath);
          if (publication.inPlace ? !input || input !== output : input === output) throw new FsError("EINVAL");
          const capabilities = await fs.capabilitiesFor?.(output, { signal }) ?? fs.capabilities;
          signal.throwIfAborted();
          if (capabilities.readOnly === true || capabilities.write === false || !capabilities.atomicFileMutation || !fs.writeFileConditional) throw new FsError("ENOTSUP");
          let destination: FileStat | null;
          try { destination = await fs.lstat(output, { signal }); }
          catch (error) {
            signal.throwIfAborted();
            if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;
            destination = null;
          }
          if (destination && destination.type !== "file") throw new FsError("EINVAL");
          if (destination && !publication.inPlace) {
            if (!publication.force) throw new FsError("EEXIST");
            if (input && await compareObservedEntries(fs, input, await fs.stat(input, { signal }), fs, output, destination, { signal }) !== "distinct") throw new FsError("EINVAL");
          }
          const parentPath = output.slice(0, output.lastIndexOf("/")) || "/";
          const parent = await fs.stat(parentPath, { signal });
          if (parent.type !== "directory") throw new FsError("ENOTDIR");
          if (publication.inPlace) {
            const original = snapshots.get(input!);
            if (!original || original.type !== "file" || !destination || original.revision === undefined
              || original.revision !== destination.revision || original.size !== destination.size
              || original.mode !== destination.mode || original.nlink !== destination.nlink
              || original.mtimeMs !== destination.mtimeMs || original.ctimeMs !== destination.ctimeMs
              || await compareObservedEntries(fs, input!, original, fs, output, destination, { signal }) !== "same") throw new FsError("EAGAIN");
            const current = await fs.readFile(input!, { maxBytes: publication.originalBytes.length, signal });
            if (current.length !== publication.originalBytes.length || current.some((byte, index) => byte !== publication.originalBytes[index])) throw new FsError("EAGAIN");
            destination = original;
          }
          signal.throwIfAborted();
          if (!publication.dryRun) await writeFileOutput(context, publication.bytes, async bytes => {
            await fs.writeFileConditional!(output, bytes, { parent, expected: destination, signal });
          });
        } catch (error) {
          context.signal.throwIfAborted();
          const code = error instanceof FsError && error.code === "EAGAIN" ? "stale-input"
            : error instanceof FsError && error.code === "ENOTSUP" ? "publication-unsupported" : "io-failure";
          throw Object.assign(new Error("Output could not be published."), { code });
        }
      }
    });
    if (result.stdout.length) await writeBytes(context.stdout, result.stdout, context.signal);
    if (result.stderr.length) await writeBytes(context.stderr, result.stderr, context.signal);
    return { exitCode: result.exitCode };
  } }];
}

export function pptxCommands(options: PptxCommandsOptions): VirtualShellPlugin {
  const commands = createPptxCommands(options);
  const replace = options.replace ?? false;
  return { name: "pptx-commands", setup(host) {
    if (!replace && host.commands.has("pptx")) throw new Error("Command already registered: pptx");
    for (const command of commands) host.commands.register(command, { replace });
  } };
}
