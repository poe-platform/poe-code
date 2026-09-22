import type { ShellExecOptions, ShellOptions, ShellResult } from './core.js';
import type { MediaCommandsOptions, RemoteMediaOptions } from './commands/media/index.js';
import { captureMediaOptions } from './commands/media/settings.js';
export type { RemoteMediaOptions, RemoteMediaControlContext, MediaCommandsOptions, MediaProviderSettings, MediaProviderRuntime } from './commands/media/index.js';

export type BashOptions = Pick<ShellOptions, 'fs' | 'cwd' | 'env' | 'limits'>
  & Pick<ShellExecOptions, 'stdin' | 'stdout' | 'stderr' | 'signal' | 'processSignals' | 'admittedHandles'>
  & { readonly media?: RemoteMediaOptions | MediaCommandsOptions; readonly dryRun?: boolean }
  & ({ readonly source: string; readonly command?: never; readonly args?: never }
    | { readonly source?: never; readonly command: string; readonly args?: readonly (string | Uint8Array)[] });

/** The CLI and SDK share shell execution, explicit media opt-in and literal
 * argv dispatch. The shell owns expansion, redirection and pipeline state. */
export async function runBash(options: BashOptions): Promise<ShellResult> {
  if (options.dryRun) {
    options.signal?.throwIfAborted();
    return { exitCode: 0, stdout: '', stderr: '', stdoutBytes: new Uint8Array(), stderrBytes: new Uint8Array() };
  }
  const args = options.args ?? [];
  if (!Array.isArray(args)) throw new TypeError('SDK arguments must be an array');
  const values = Array.from({ length: args.length }, (_, index) => {
    if (!Object.hasOwn(args, index)) throw new TypeError('SDK argument slot is missing');
    const value = args[index];
    if (typeof value === 'string') return value;
    if (!(value instanceof Uint8Array)) throw new TypeError('SDK arguments must be strings or bytes');
    return new Uint8Array(value);
  });
  // Capture settings before loading shell/transport code; only invocation connects.
  options = { ...options, env: { ...options.env ?? {} },
    ...(options.media ? { media: captureMediaOptions(options.media) } : {}) };
  const { Shell, agentCommands, createCommandArguments } = await import('./core.js');
  const errors: unknown[] = [];
  const shell = new Shell({ fs: options.fs, env: options.env ?? {},
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
    onInternalError(error) { errors.push(error); },
  }).use(agentCommands());
  try {
    if (options.media) {
      const { createRemoteMediaCommands, mediaCommands } = await import('./commands/media/index.js');
      shell.use('service' in options.media ? createRemoteMediaCommands(options.media) : mediaCommands(options.media));
    }
    let source = options.source;
    if (source === undefined) {
      const argumentValues = createCommandArguments([]).withValues(values);
      let dispatch = 'sdk-argv';
      while (shell.commands.has(dispatch)) dispatch += '-';
      shell.commands.register({ name: dispatch, execute(context) {
        return context.invoke!(options.command!, argumentValues.args, { argumentValues });
      } });
      source = dispatch;
    }
    const result = await shell.exec(source, {
      ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
      ...(options.stdout ? { stdout: options.stdout } : {}),
      ...(options.stderr ? { stderr: options.stderr } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.processSignals === undefined ? {} : { processSignals: options.processSignals }),
      ...(options.admittedHandles === undefined ? {} : { admittedHandles: options.admittedHandles }),
    });
    if (errors.length) throw errors[0];
    return result;
  } finally { await shell.dispose(); }
}
