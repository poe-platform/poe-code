export const scenarios = Object.freeze([
  'captures', 'unicode', 'selection', 'dialects', 'preabort', 'startup-abort',
  'idle-abort', 'paused-abort', 'idle-exit', 'idle-error', 'malformed', 'caps',
  'live-source', 'consumer-return', 'capacity', 'dispose-late',
]);
export const risks = Object.freeze(['risk-default', 'risk-abort']);
export const risk = Object.freeze({ source: '^(a+)+$', text: 'aaaaaaaaaaaaaaaaaaaaaaaa!', bytes: 25 });
export const captures = Object.freeze({
  descriptor: { source: '(q)?(b*)', flags: 'g' },
  input: { text: 'b', all: true },
  expected: [[0, 1, ['b', null, 'b']], [1, 1, ['', null, '']]],
});
export const flags = Object.freeze(['--unhandled-rejections=strict', '--max-old-space-size=64', '--stack-size=2048']);
