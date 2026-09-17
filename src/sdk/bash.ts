import type { FileSystem, ShellExecOptions, ShellResult, PythonCommandsOptions } from 'poe-code/safe-bash';
import type { PandocCommandsOptions } from 'poe-code/safe-bash/commands/pandoc';
import type { NodePythonWorkerOptions } from 'poe-code/safe-bash/commands/python/node';

export type BashPythonOptions = Omit<PythonCommandsOptions, 'createWorker' | 'replace'> & (
  | (NodePythonWorkerOptions & { readonly createWorker?: never })
  | (Partial<NodePythonWorkerOptions> & { readonly createWorker: PythonCommandsOptions['createWorker'] })
);
export interface RunBashOptions extends ShellExecOptions {
  readonly source: string;
  readonly fs?: FileSystem;
  /** Explicit host directory exposed at the virtual root; ignored when fs is supplied. */
  readonly root?: string;
  readonly python?: BashPythonOptions;
  /** Explicit bounded TypeScript converter plugin; absent by default. */
  readonly pandoc?: Omit<PandocCommandsOptions, 'replace'>;
}

export async function runBash(options: RunBashOptions): Promise<ShellResult> {
  if (!options.fs && !options.root) throw new TypeError('Bash requires an explicit filesystem or root');
  const { Shell, RealFileSystem, agentCommands, pythonCommands } = await import('poe-code/safe-bash');
  const fs = options.fs ?? new RealFileSystem({ root: options.root! });
  const shell = new Shell({ fs, cwd: options.cwd, env: options.env }).use(agentCommands());
  try {
    if (options.pandoc) {
      const { pandocCommands } = await import('poe-code/safe-bash/commands/pandoc');
      shell.use(pandocCommands(options.pandoc));
    }
    if (options.python) {
      const { runtimeModuleURL, indexURL, trustedPython, createWorker, ...configuration } = options.python;
      const runtime = createWorker ? undefined : await import('poe-code/safe-bash/commands/python/node');
      shell.use(pythonCommands({ ...configuration, createWorker: createWorker ?? (() => runtime!.createNodePythonWorker({ runtimeModuleURL: runtimeModuleURL!, trustedPython: trustedPython!, ...(indexURL === undefined ? {} : { indexURL }) })) }));
    }
    return await shell.exec(options.source, options);
  } finally { await shell.dispose(); }
}
