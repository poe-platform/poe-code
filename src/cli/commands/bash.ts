import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { type Command } from 'commander';
import { renderSpinnerFrame } from 'toolcraft-design';
import type { RemoteMediaOptions } from '@poe-platform/safe-bash/commands/media';
import { runBash } from '../../sdk/bash.js';
import { ValidationError } from '../errors.js';
import { deepMergeJson, type JsonObject } from '../../utils/json.js';

interface BashCommandOptions {
  command?: string;
  root?: string;
  cwd?: string;
  env?: string;
  mediaConfig?: string;
  mediaProgress?: string;
  mediaService?: string;
  mediaProvider?: string;
  mediaAuthToken?: string;
  mediaBuildDigest?: string;
  mediaResource?: string;
  mediaLimits?: string;
  mediaGrants?: string;
  mediaDescriptors?: string;
  mediaStdin?: string;
  mediaReplace?: boolean;
}

function parseJsonOption<T = Record<string, unknown>>(value: string, option: string, array = false): T {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new ValidationError(`${option} must be a JSON ${array ? 'array' : 'object'}.`); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) !== array) {
    throw new ValidationError(`${option} must be a JSON ${array ? 'array' : 'object'}.`);
  }
  return parsed as T;
}

export function registerBashCommand(program: Command): Command {
  return program.command('bash')
    .description('Run scripts and native media commands in safe Bash.')
    .argument('[argv...]', 'Literal command and arguments after --')
    .option('-c, --command <source>', 'Bash source to execute')
    .option('--root <directory>', 'Explicit host filesystem root (otherwise memory only)')
    .option('--cwd <path>', 'Logical working directory')
    .option('--env <json>', 'Explicit exported environment map')
    .option('--media-config <json>', 'Complete SDK remote media settings')
    .option('--media-service <origin>', 'Authenticated remote HTTPS service')
    .option('--media-provider <json>', 'Explicit provider module and options')
    .option('--media-auth-token <token>', 'Explicit remote authentication token')
    .option('--media-build-digest <digest>', 'Pinned remote build digest')
    .option('--media-resource <json>', 'Admitted remote namespace binding')
    .option('--media-limits <json>', 'Native resource limits')
    .option('--media-grants <json>', 'Explicit native resource grants')
    .option('--media-descriptors <json>', 'Explicit remote descriptor bindings')
    .option('--media-stdin <json>', 'Explicit remote stdin binding')
    .option('--media-replace', 'Explicitly replace colliding safe Bash media commands')
    .option('--media-progress <path>', 'Separate host UI destination for transfer events, e.g. /dev/tty')
    .action(async (argv: string[], flags: BashCommandOptions, command: Command) => {
      if ((flags.command === undefined) === (argv.length === 0)) throw new ValidationError('Supply -c <source> or a command after --.');
      let media: RemoteMediaOptions | undefined;
      const configuredMedia = deepMergeJson(
        flags.mediaConfig !== undefined ? parseJsonOption<JsonObject>(flags.mediaConfig, '--media-config') : {}, {
        ...(flags.mediaService !== undefined ? { service: flags.mediaService } : {}),
        ...(flags.mediaProvider !== undefined ? { provider: parseJsonOption<JsonObject>(flags.mediaProvider, '--media-provider') } : {}),
        ...(flags.mediaAuthToken !== undefined ? { authToken: flags.mediaAuthToken } : {}),
        ...(flags.mediaBuildDigest !== undefined ? { buildDigest: flags.mediaBuildDigest } : {}),
        ...(flags.mediaResource !== undefined ? { resource: parseJsonOption<JsonObject>(flags.mediaResource, '--media-resource') } : {}),
        ...(flags.mediaLimits !== undefined ? { limits: parseJsonOption<JsonObject>(flags.mediaLimits, '--media-limits') } : {}),
        ...(flags.mediaGrants !== undefined ? { grants: parseJsonOption<JsonObject[]>(flags.mediaGrants, '--media-grants', true) } : {}),
        ...(flags.mediaDescriptors !== undefined ? { descriptors: parseJsonOption<JsonObject[]>(flags.mediaDescriptors, '--media-descriptors', true) } : {}),
        ...(flags.mediaStdin !== undefined ? { stdin: parseJsonOption<JsonObject>(flags.mediaStdin, '--media-stdin') } : {}),
        ...(flags.mediaReplace !== undefined ? { replace: flags.mediaReplace } : {}),
      });
      if (flags.mediaConfig !== undefined || flags.mediaProgress !== undefined || Object.keys(configuredMedia).length > 0) {
        media = configuredMedia as unknown as RemoteMediaOptions;
        if (!media?.service || !media.authToken || !media.buildDigest || !media.resource) throw new ValidationError('Explicit media service/auth/build/resource configuration required.');
      }
      const dryRun = command.optsWithGlobals().dryRun === true;
      const ui = flags.mediaProgress && !dryRun ? createWriteStream(flags.mediaProgress) : undefined;
      let uiError: unknown;
      ui?.on('error', error => { uiError = error; });
      try {
        if (ui) await once(ui, 'open');
        const { MemoryFileSystem, RealFileSystem } = await import('@poe-platform/safe-bash');
        const totals = { upload: 0, download: 0 };
        const result = await runBash({
          ...(dryRun ? { dryRun: true } : {}),
          fs: flags.root ? new RealFileSystem({ root: flags.root }) : new MemoryFileSystem(),
          ...(flags.command !== undefined ? { source: flags.command } : { command: argv[0]!, args: argv.slice(1) }),
          ...(flags.cwd !== undefined ? { cwd: flags.cwd } : {}),
          env: flags.env === undefined ? {} : parseJsonOption(flags.env, '--env') as Record<string, string>,
          stdin: { [Symbol.asyncIterator]() {
            const iterator = process.stdin[Symbol.asyncIterator]();
            return { next: iterator.next.bind(iterator), async return() {
              process.stdin.destroy();
              return await iterator.return?.() ?? { done: true as const, value: undefined };
            } };
          } },
          ...(media ? { media: { ...media, ...(ui ? { async onProgress(event) {
            if (uiError) throw uiError;
            totals[event.direction] += event.bytes;
            if (!ui.write(`${renderSpinnerFrame({ message: `Media ${event.direction}: ${totals[event.direction]} bytes` })}\n`)) await once(ui, 'drain');
          } } : {}) } } : {}),
          stdout: { async write(bytes) { if (!process.stdout.write(bytes)) await once(process.stdout, 'drain'); } },
          stderr: { async write(bytes) { if (!process.stderr.write(bytes)) await once(process.stderr, 'drain'); } },
        });
        if (uiError) throw uiError;
        process.exitCode = result.exitCode;
      } finally {
        if (ui && !ui.destroyed) { ui.end(); await once(ui, 'finish'); }
      }
    });
}
