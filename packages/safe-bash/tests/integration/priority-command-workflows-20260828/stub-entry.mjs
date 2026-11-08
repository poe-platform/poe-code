import { parentPort, getEnvironmentData } from 'node:worker_threads';

const configuration = getEnvironmentData('priority-worker-observation-v1');
const dependency = await import('./stub-dependency.mjs').catch(error => {
  if (configuration.stubMode !== 'caught-load') throw error;
  parentPort.postMessage({ caught: String(error) }); parentPort.close(); return null;
});
if (dependency) {
const { marker } = dependency;
if (marker !== 'task-owned-benign-stub-only') throw new Error('STUB_MARKER_DRIFT');
if (configuration.stubMode === 'error') throw new Error('INTENTIONAL_BENIGN_STUB_ERROR');
parentPort.postMessage('stub-ready');
if (configuration.stubMode === 'natural') parentPort.close();
else parentPort.on('message', value => { if (value === 'finish') parentPort.close(); });
}
