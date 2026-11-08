import { Shell, MemoryFileSystem } from '@poe-platform/safe-bash';
import { nodeCommands, type NodeSafeJsCommandOptions } from '@poe-platform/safe-bash/commands/node';
const options: NodeSafeJsCommandOptions<object> = {
  runtime: {
    createBudget: value => ({ ...value }),
    makeFsModule: () => ({}),
    declareHostOperation: operation => operation,
    async run(_source, options) {
      options.signal.throwIfAborted();
      return { ok: true };
    },
  },
  limits: { maxSourceBytes: 1024, maxOutputBytes: 1024 },
};
new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands(options));
