import './matchers.js';

export { detectEngine } from './engine.js';
export { runInContainer, setWorkspaceDir } from './container.js';
export { createContainer } from './persistent-container.js';
export { rotateLogs } from './log-rotation.js';
export { getApiKey } from './credentials.js';
export { ensureImage, getSourceHash, IMAGE_NAME } from './image.js';
export { runPreflight, formatPreflightResults } from './preflight.js';
export { setResolvedContext, getResolvedContext, buildContextArgs } from './context.js';
export { useContainer } from './use-container.js';
export { CapturedRequests } from './proxy-requests.js';
export { shellQuote } from './shell-quote.js';
export type { UseContainerOptions } from './use-container.js';
export type { RunResult } from './container.js';
export type { Container, ContainerOptions, ExecResult } from './types.js';
export type { CapturedExchange, SnapshotMode, SnapshotMissBehavior } from './proxy-types.js';
