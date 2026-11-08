import { assertWorkerPermissions } from './worker-permissions.mjs';
import { parentPort, workerData } from 'node:worker_threads';
assertWorkerPermissions();
if (!parentPort || workerData.role !== 'wrq-static-worker-v3' || workerData.fixture !== 'L08') throw new Error('heap-only role');
const retained = [];
for (let index = 0; index < 32; index += 1) retained.push(new Array(262144).fill(index));
parentPort.close();
