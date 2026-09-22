import { getCommandArguments } from 'safe-bash-contracts/command';
import type { CommandContext, CommandDefinition } from 'safe-bash-contracts/command';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { createFFmpegShims, type NativeBinding } from '@poe-code/media-cli';
import { createImageMagickShims, type ImageMagickBinding } from '@poe-code/media-cli';
import { imageMagickReference, imageMagickGrammarRevision } from '@poe-code/media-cli';
import { nativeReference, grammarRevision } from '@poe-code/media-cli';
import type { MediaEngineRequest } from '@poe-code/media-cli';

export interface MediaCommandsOptions {
  readonly engine?: { execute(request: MediaEngineRequest): Promise<{ exitCode: number }> };
  readonly ffmpeg?: NativeBinding<CommandContext>;
  readonly imageMagick?: ImageMagickBinding<CommandContext>;
  readonly replace?: boolean;
}

/** Explicit host bindings own authenticated remote execution and native streams.
 * Configuration never enters native argv. Discovery remains advisory. */
export function mediaCommands(options: MediaCommandsOptions): VirtualShellPlugin {
  if (options.replace !== undefined && typeof options.replace !== 'boolean') throw new TypeError('Media replacement policy must be a boolean');
  const replace = options.replace ?? false;
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
            async read(bytes) {
              try { return await context.fs.readFile(path(bytes), { signal: context.signal }); }
              catch { return undefined; }
            },
          };
        },
      },
    };
  }
  if (!options.ffmpeg && !options.imageMagick) throw new TypeError('Explicit remote media bindings required');
  const shims = {
    ...(options.ffmpeg ? createFFmpegShims(options.ffmpeg) : {}),
    ...(options.imageMagick ? createImageMagickShims(options.imageMagick) : {}),
  };
  const definitions: CommandDefinition[] = Object.entries(shims)
    .filter(([name]) => !Object.hasOwn(imageMagickReference.executables, name)
      || imageMagickReference.executables[name as keyof typeof imageMagickReference.executables].kind === 'media')
    .map(([name, run]) => ({ name, async execute(context) {
      const arguments_ = getCommandArguments(context);
      const argv = arguments_.args.map((_, index) => arguments_.bytes(index)!);
      return run(argv, context);
    } }));
  return { name: 'media-commands', setup(host) {
    if (!replace) for (const definition of definitions) {
      if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
    }
    for (const definition of definitions) host.commands.register(definition, { replace });
  } };
}
