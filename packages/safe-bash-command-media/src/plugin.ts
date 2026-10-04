import { readFileStream } from '@poe-code/safe-fs';
import { getCommandArguments } from 'safe-bash-contracts/command';
import type { CommandContext, CommandDefinition } from 'safe-bash-contracts/command';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { createFFmpegShims, type NativeBinding } from 'safe-bash-media-engine';
import { createImageMagickShims, type ImageMagickBinding } from 'safe-bash-media-engine';
import { imageMagickReference, imageMagickGrammarRevision } from 'safe-bash-media-engine';
import { nativeReference, grammarRevision } from 'safe-bash-media-engine';
import type { MediaEngineRequest } from 'safe-bash-media-engine';

export interface MediaCommandsOptions {
  readonly engine?: { execute(request: MediaEngineRequest): Promise<{ exitCode: number }> };
  readonly ffmpeg?: NativeBinding<CommandContext>;
  readonly imageMagick?: ImageMagickBinding<CommandContext>;
  readonly replace?: boolean;
}

/** Explicit host bindings own authenticated remote execution and native streams.
 * Configuration never enters native argv. Discovery remains advisory. */
function mediaShims(options: MediaCommandsOptions) {
  if (options.replace !== undefined && typeof options.replace !== 'boolean') throw new TypeError('Media replacement policy must be a boolean');
  if (options.engine) {
    if (options.ffmpeg || options.imageMagick) throw new TypeError('Choose engine or explicit media bindings');
    const execute = options.engine.execute.bind(options.engine);
    const run = ({ tool, argv, discovery, context }: { tool: string; argv: readonly Uint8Array[]; discovery: NonNullable<MediaEngineRequest['discovery']>; context: CommandContext }) =>
      execute({ ...context, command: tool, args: argv, discovery });
    options = { ...options,
      ffmpeg: { build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live', run },
      imageMagick: { build: imageMagickReference.id, grammarRevision: imageMagickGrammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live', run,
        discoveryContext(context) {
          // Preserve .. and literal colons for the invocation filesystem. Its
          // string API cannot probe arbitrary native octets losslessly; those
          // names remain unknown here and are resolved by the native bridge.
          const path = (bytes: Uint8Array) => {
            const name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
            return name.startsWith('/') ? name : context.cwd + (context.cwd.endsWith('/') ? '' : '/') + name;
          };
          return {
            async accessible(bytes) {
              try {
                const name = path(bytes);
                if ((await context.fs.stat(name, { signal: context.signal })).type !== 'file') return false;
                await context.fs.access(name, 0, { signal: context.signal });
                return true;
              } catch (cause) {
                if (cause && typeof cause === 'object' && 'code' in cause && ['ENOENT', 'ENOTDIR', 'EACCES'].includes(String(cause.code))) return false;
                return undefined;
              }
            },
            async exists(bytes) {
              try { await context.fs.stat(path(bytes), { signal: context.signal }); return true; }
              catch (cause) {
                if (cause && typeof cause === 'object' && 'code' in cause && ['ENOENT', 'ENOTDIR'].includes(String(cause.code))) return false;
                return undefined;
              }
            },
            readStream(bytes) {
              return readFileStream(context.fs, path(bytes), { signal: context.signal, chunkSize: 65536 });
            },
          };
        },
      },
    };
  }
  if (!options.ffmpeg && !options.imageMagick) {
    const run = async ({ context }: { context: CommandContext }) => {
      await context.stderr.write(new TextEncoder().encode('Explicit remote media bindings required\n'));
      return { exitCode: 2 };
    };
    options = { ...options,
      ffmpeg: { build: nativeReference.id, grammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live', run },
      imageMagick: { build: imageMagickReference.id, grammarRevision: imageMagickGrammarRevision, argv: 'bytes', lateAccess: 'complete', effects: 'live', run },
    };
  }
  const shims = {
    ...(options.ffmpeg ? createFFmpegShims(options.ffmpeg) : {}),
    ...(options.imageMagick ? createImageMagickShims(options.imageMagick) : {}),
  };
  return shims;
}

export function createMediaCommand(options: MediaCommandsOptions = {}, name = 'ffmpeg'): CommandDefinition {
  const shims = mediaShims(options);
  const run = Object.hasOwn(shims, name) ? shims[name as keyof typeof shims] : undefined;
  if (!run || (Object.hasOwn(imageMagickReference.executables, name)
    && imageMagickReference.executables[name as keyof typeof imageMagickReference.executables].kind !== 'media')) {
    throw new TypeError(`Media command not configured: ${name}`);
  }
  return mediaDefinition(name, run);
}

export function createMediaCommands(options: MediaCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.entries(mediaShims(options))
    .filter(([name]) => !Object.hasOwn(imageMagickReference.executables, name)
      || imageMagickReference.executables[name as keyof typeof imageMagickReference.executables].kind === 'media')
    .map(([name, run]) => mediaDefinition(name, run));
}

function mediaDefinition(name: string, run: (argv: readonly Uint8Array[], context: CommandContext) => Promise<{ exitCode: number }>): CommandDefinition {
  return { name, async execute(context) {
    const arguments_ = getCommandArguments(context);
    const argv = arguments_.args.map((_, index) => arguments_.bytes(index)!);
    return run(argv, context);
  } };
}

export function mediaCommands(options: MediaCommandsOptions = {}): VirtualShellPlugin {
  const definitions = createMediaCommands(options);
  const replace = options.replace ?? false;
  return { name: 'media-commands', setup(host) {
    if (!replace) for (const definition of definitions) {
      if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
    }
    for (const definition of definitions) host.commands.register(definition, { replace });
  } };
}
