import { Shell, MemoryFileSystem } from '@poe-platform/safe-bash';
import { nodeCommands, createNodeCommand, type NodeLimits, type NodeRuntimeProvider } from '@poe-platform/safe-bash/commands/node';
import { createNodeWorkerProvider } from '@poe-platform/safe-bash/commands/node/host';
const provider: NodeRuntimeProvider = createNodeWorkerProvider({ entry: 'file:///adapter.mjs', identity: 'adapter' });
const limits: Partial<NodeLimits> = { outputBytes: 1024 };
new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ provider, limits }));
createNodeCommand();
