import { resolve } from 'node:path';
import { InvalidArgumentError, Option, type Command } from 'commander';
import { renderSpinnerFrame, renderSpinnerStopped } from 'toolcraft-design';
import { runBash } from '../../sdk/bash.js';

function resourceLimit(value: string, maximum = 1048576): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new InvalidArgumentError(`Expected an integer between 1 and ${maximum}.`);
  return number;
}

function cacheByteLimit(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new InvalidArgumentError('Expected a positive safe integer.');
  return number;
}

export function registerBashCommand(program: Command): void {
  program.command('bash')
    .description('Run a virtual shell command with an explicitly scoped filesystem.')
    .requiredOption('-c, --command <source>', 'Shell command source (noninteractive).')
    .option('--root <directory>', 'Host directory exposed as /.', process.cwd())
    .option('--cwd <directory>', 'Virtual working directory.', '/')
    .option('--pandoc', 'Enable the bounded TypeScript document converter plugin.')
    .option('--python-runtime <url>', 'Enable Python using an explicit Pyodide ES module URL.')
    .option('--python-trusted', 'Allow trusted Python code only; Node workers are not a security sandbox.')
    .option('--python-max-concurrent-workers <count>', 'Maximum active Python workers; excess commands fail immediately.', value => resourceLimit(value, 64))
    .option('--python-max-input-chunk-bytes <bytes>', 'Maximum retained Python stdin source chunk.', value => resourceLimit(value, 16777216))
    .option('--python-index-url <url>', 'Pyodide asset location.')
    .option('--python-runtime-mount <path>', 'Virtual Python standard-library mount.')
    .option('--python-max-transfer-bytes <bytes>', 'Maximum Python bridge transfer size.', value => resourceLimit(value))
    .option('--python-max-open-files <count>', 'Maximum open Python files.', value => resourceLimit(value))
    .option('--python-package <requirement>', 'Install a Python package/version or canonical wheel (repeatable).', (value: string, values: string[]) => [...values, value], [])
    .option('--python-requirements <path>', 'Canonical requirements file (repeatable).', (value: string, values: string[]) => [...values, value], [])
    .addOption(new Option('--python-package-profile <profile>', 'Opt-in pinned Python package profile.').choices(['documents']))
    .option('--python-package-max-cache-bytes <bytes>', 'Maximum bytes in the default in-memory Python package cache.', cacheByteLimit)
    .option('--python-package-cache <path>', 'Canonical persistent Python package cache directory.')
    .option('--python-package-offline', 'Use only cached Python package artifacts.')
    .option('--python-package-allow-origin <origin>', 'Permit installer downloads from this origin (repeatable).', (value: string, values: string[]) => [...values, value], [])
    .action(async (options: { command: string; root: string; cwd: string; pandoc?: boolean; pythonRuntime?: string; pythonTrusted?: boolean; pythonMaxConcurrentWorkers?: number; pythonMaxInputChunkBytes?: number; pythonIndexUrl?: string; pythonRuntimeMount?: string; pythonMaxTransferBytes?: number; pythonMaxOpenFiles?: number; pythonPackage: string[]; pythonRequirements: string[]; pythonPackageProfile?: 'documents'; pythonPackageCache?: string; pythonPackageMaxCacheBytes?: number; pythonPackageOffline?: boolean; pythonPackageAllowOrigin: string[] }, command: Command) => {
      if (command.optsWithGlobals().dryRun) throw new InvalidArgumentError('bash does not support --dry-run.');
      if (options.pythonRuntime === undefined && ([options.pythonTrusted, options.pythonMaxConcurrentWorkers, options.pythonMaxInputChunkBytes, options.pythonIndexUrl, options.pythonRuntimeMount, options.pythonMaxTransferBytes, options.pythonMaxOpenFiles, options.pythonPackageProfile, options.pythonPackageCache, options.pythonPackageMaxCacheBytes, options.pythonPackageOffline].some(value => value !== undefined) || options.pythonPackage.length > 0 || options.pythonRequirements.length > 0 || options.pythonPackageAllowOrigin.length > 0)) {
        throw new InvalidArgumentError('Python configuration requires --python-runtime.');
      }
      if (options.pythonRuntime !== undefined && options.pythonTrusted !== true) throw new InvalidArgumentError('Node Python requires --python-trusted: Python JavaScript interop is not a filesystem or network security sandbox.');
      let progress: ReturnType<typeof setInterval> | undefined;
      const stopProgress = (message: string) => {
        if (progress === undefined) return;
        clearInterval(progress); progress = undefined;
        process.stderr.write(`\r\x1b[K${renderSpinnerStopped({ message })}\n`);
      };
      const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
      const outputListeners: Array<() => void> = [];
      const reportedDownloads = new Map<string, number>();
      const sink = (stream: NodeJS.WriteStream) => {
        let failure: Error | undefined;
        const onError = (error: Error) => { failure = error; };
        stream.on('error', onError);
        outputListeners.push(() => stream.off('error', onError));
        return { write: (bytes: Uint8Array) => new Promise<void>((resolve, reject) => {
          if (failure) { reject(failure); return; }
          stream.write(bytes, error => error ? reject(error) : resolve());
        }) };
      };
      try {
        const network = options.pythonPackageAllowOrigin.length > 0 ? await import('poe-code/safe-bash') : undefined;
        const result = await runBash({
          source: options.command, root: resolve(options.root), cwd: options.cwd, env,
          pandoc: options.pandoc ? {} : undefined,
          stdin: process.stdin,
          stdout: sink(process.stdout), stderr: sink(process.stderr),
          python: options.pythonRuntime === undefined ? undefined : {
            runtimeModuleURL: options.pythonRuntime, trustedPython: true, maxConcurrentWorkers: options.pythonMaxConcurrentWorkers, maxInputChunkBytes: options.pythonMaxInputChunkBytes, indexURL: options.pythonIndexUrl,
            runtimeMount: options.pythonRuntimeMount, maxTransferBytes: options.pythonMaxTransferBytes,
            maxOpenFiles: options.pythonMaxOpenFiles,
            packages: options.pythonPackage, requirements: options.pythonRequirements, packageProfile: options.pythonPackageProfile,
            provisioning: {
              maxCacheBytes: options.pythonPackageMaxCacheBytes, offline: options.pythonPackageOffline, cacheDirectory: options.pythonPackageCache,
              ...(network ? { authorize: network.createOriginAuthorizer(options.pythonPackageAllowOrigin), transport: network.createFetchTransport() } : {}),
              onProgress(event) {
                if (event.phase === 'download' && event.url && event.bytes !== undefined) {
                  const previous = reportedDownloads.get(event.url);
                  if (previous !== undefined && event.bytes - previous < 1024 * 1024 && event.bytes !== event.totalBytes) return;
                  reportedDownloads.set(event.url, event.bytes);
                }
                stopProgress('Preparing Python packages');
                const detail = event.bytes === undefined ? '' : ` (${event.bytes}${event.totalBytes === undefined ? '' : '/' + event.totalBytes} bytes)`;
                process.stderr.write(event.phase === 'installed' ? 'Python packages installed\n' : `Python package ${event.phase}: ${event.url ?? ''}${detail}\n`);
              },
            },
            onProgress(event) {
              if (event.phase === 'initializing') {
                if (process.stderr.isTTY) {
                  if (progress !== undefined) return;
                  let frame = 0;
                  const draw = () => process.stderr.write(`\r\x1b[K${renderSpinnerFrame({ message: 'Initializing Python', frame: frame++ }).split('\n')[0]}`);
                  draw(); progress = setInterval(draw, 80);
                }
                else process.stderr.write('Initializing Python...\n');
              } else { stopProgress(event.phase === 'ready' ? 'Python ready' : 'Python initialization finished'); }
            }
          }
        });
        process.exitCode = result.exitCode;
      } finally {
        try { stopProgress('Python initialization finished'); }
        finally { for (const removeListener of outputListeners) removeListener(); }
      }
    });
}
