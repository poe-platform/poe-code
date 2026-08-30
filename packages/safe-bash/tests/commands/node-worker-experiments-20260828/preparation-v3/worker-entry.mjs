import { installGuard, assertClosedInputs } from './load-guard.mjs';

assertClosedInputs();
installGuard('worker');
await import('./worker-body.mjs');
