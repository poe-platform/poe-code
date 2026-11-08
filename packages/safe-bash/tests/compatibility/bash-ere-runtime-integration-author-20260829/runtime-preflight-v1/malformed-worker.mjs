import { parentPort, workerData } from 'node:worker_threads';
if (!parentPort || workerData?.operation !== 'shell-ere' || workerData?.version !== 1) throw new Error('fixed test role only');
parentPort.postMessage({ version: 1, operation: 'shell-ere', kind: 'ready' });
parentPort.once('message', request => {
  parentPort.postMessage({ version: 1, operation: 'NOT-shell-ere', id: request.id, grantId: request.grantId, kind: 'result', result: { matched: false, groupCount: 0, spans: [null], steps: 0, allocatedUnits: 0 }, usage: { patternBytes: 0, subjectBytes: 0, work: 0, states: 0, allocationUnits: 0, captureBytes: 0, captureSlots: 0 } });
});
