import { createBashRunner } from './execution-runtime.js';
export type { BashOptions, RemoteMediaOptions, RemoteMediaControlContext, MediaCommandsOptions, MediaProviderSettings, MediaProviderRuntime } from './execution-runtime.js';

export const runBash = createBashRunner(() => import('./core.js'));
