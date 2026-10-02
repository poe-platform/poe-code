import { Shell, type CommandDefinition } from '@poe-platform/safe-bash';
import { pythonCommands, type PythonCommandsOptions } from '@poe-platform/safe-bash/commands/python';
import { createPythonExecutorCommands, type PythonExecutorStart } from '@poe-platform/safe-bash/commands/python/executor';
import { createNodePythonWorker } from '@poe-platform/safe-bash/commands/python/node';
import { createDockerPythonExecutorPool } from '@poe-platform/safe-bash/commands/python/docker';
import { runPythonWorker } from '@poe-platform/safe-bash/commands/python/worker';

const options: PythonCommandsOptions = { createExecutor: () => ({
  async run(start: PythonExecutorStart) { start.onReady(); return 0; },
  terminate() {},
}) };
const commands: readonly CommandDefinition[] = createPythonExecutorCommands(options);
declare const shell: Shell;
shell.use(pythonCommands(options));
void [commands, createNodePythonWorker, createDockerPythonExecutorPool, runPythonWorker];
