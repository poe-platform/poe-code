import { createBashRunner } from './execution-runtime.js';
export type { BashOptions, RemoteMediaOptions, RemoteMediaControlContext, MediaCommandsOptions, MediaProviderSettings, MediaProviderRuntime } from './execution-runtime.js';

export const runBash = createBashRunner(async () => {
  const [core, node] = await Promise.all([import('./core.js'), import('./shell/node.js')]);
  return { ...core, Shell: node.Shell };
});
