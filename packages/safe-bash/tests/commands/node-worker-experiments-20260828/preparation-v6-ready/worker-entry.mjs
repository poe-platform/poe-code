import { assertWorkerPermissions } from './worker-permissions.mjs';
import { installGuard, assertClosedInputs } from './load-guard.mjs';
assertWorkerPermissions();
assertClosedInputs();
const loads = installGuard('worker');
globalThis.__wrqTrustedLoads = loads;
await import('./worker-body.mjs');
