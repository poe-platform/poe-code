import { createDockerPythonExecutorPool, runDockerPythonExecutor, type DockerPythonExecutorOptions, type DockerPythonRunnerOptions } from '@poe-platform/safe-bash/commands/python/docker';
import { pythonCommands, type PythonExecutorPool } from '@poe-platform/safe-bash/commands/python';

export async function publicDockerHost(options: DockerPythonExecutorOptions) {
  const pool: PythonExecutorPool = await createDockerPythonExecutorPool(options);
  return { pool, plugin: pythonCommands({ createExecutor: pool.createExecutor }) };
}

export const isolatedRunner: (options: DockerPythonRunnerOptions) => Promise<void> = runDockerPythonExecutor;
