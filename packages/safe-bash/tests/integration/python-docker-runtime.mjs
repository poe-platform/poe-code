import { runDockerPythonExecutor } from '@poe-platform/safe-bash/commands/python/docker';

await runDockerPythonExecutor({ isolatedContainer: true,
  runtimeModuleURL: new URL('./node_modules/pyodide/pyodide.mjs', import.meta.url).href,
});
