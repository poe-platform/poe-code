export const scenarios = Object.freeze([
  'idle-exit', 'idle-idempotence', 'pending-exit', 'live-feedback',
  'paused-backpressure', 'paused-abort', 'preabort', 'cooperative-pending-abort',
  'late-read-rejection', 'pending-consumer-return', 'awaited-return',
  'read-return-rejection', 'return-rejection', 'node-stream-abort',
  'empty-source', 'explicit-batches',
]);
export const row = Object.freeze({ text: 'r', all: true });
export const expectedHits = Object.freeze([[{ pattern: 0, start: 0, end: 1, captures: ['r'] }]]);
export const flags = Object.freeze(['--unhandled-rejections=strict', '--max-old-space-size=64', '--stack-size=2048']);
