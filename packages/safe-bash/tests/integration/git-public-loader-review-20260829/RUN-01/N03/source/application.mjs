import { parentPort } from 'node:worker_threads';
parentPort.postMessage('OWNED_OK');
parentPort.close();

