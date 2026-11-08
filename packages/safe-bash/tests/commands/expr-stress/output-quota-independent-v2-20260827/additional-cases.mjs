export const emergency = 'expr: output bytes limit exceeded\n';
export const cases = [
  ...['zero', 'false', 'null', 'undefined', 'empty', 'quota-error'].map(reason => ({
    id: `v2-stdout-rejection-${reason}`, args: ['1'], cap: 2, mode: 'reject-stdout', reason, rejection: 'sink', stdoutAttempts: 1, stderrAttempts: 0,
  })),
  { id: 'v2-old-stdout-rejection-explicit-identity', supersedesOnlyByProposal: 'stdout-rejection-normal-quota', args: ['1'], cap: 2, mode: 'reject-stdout', reason: 'error', rejection: 'sink', stdoutAttempts: 1, stderrAttempts: 0 },
  { id: 'v2-normal-stderr-rejection-false', args: ['1', 'x'], cap: 44, mode: 'reject-stderr', reason: 'false', rejection: 'sink', stdoutAttempts: 0, stderrAttempts: 1 },
  { id: 'v2-emergency-stderr-rejection-undefined', args: ['1', 'x'], cap: 43, mode: 'reject-stderr', reason: 'undefined', rejection: 'sink', stdoutAttempts: 0, stderrAttempts: 1 },
  { id: 'v2-output-admission-before-throwing-sink', args: ['1'], cap: 1, mode: 'reject-stdout', reason: 'error', status: 3, stderr: emergency, stdoutAttempts: 0, stderrAttempts: 1 },
  { id: 'v2-long-normal-diagnostic-allocation-admission', args: ['1', 'UNTRUSTED_'.repeat(512)], cap: 43, mode: 'allocation', status: 3, stderr: emergency, stdoutAttempts: 0, stderrAttempts: 1 },
  { id: 'v2-nul-normal-diagnostic-admitted', args: ['bad\0token'], cap: 128, status: 2, stderr: 'expr: NUL is not supported in argv\n', stdoutAttempts: 0, stderrAttempts: 1 },
  { id: 'v2-worker-stdout-rejection-false', args: ['a', ':', 'a'], cap: 2, mode: 'reject-stdout', reason: 'false', rejection: 'sink', stdoutAttempts: 1, stderrAttempts: 0, jobs: 1 },
  { id: 'v2-worker-invalid-emergency-rejection-zero', args: ['a', ':', '['], cap: 1, mode: 'reject-stderr', reason: 'zero', rejection: 'sink', stdoutAttempts: 0, stderrAttempts: 1, jobs: 1 },
  ...['false', 'null'].map(reason => ({ id: `v2-worker-caller-abort-${reason}`, args: ['a', ':', '['], cap: 1, mode: 'abort-post', reason, rejection: 'caller', stdoutAttempts: 0, stderrAttempts: 0, jobs: 1 })),
  { id: 'v2-emergency-abort-false-late-rejection', args: ['1', 'x'], cap: 43, mode: 'abort-stderr', reason: 'false', rejection: 'caller', stdoutAttempts: 0, stderrAttempts: 1 },
  { id: 'v2-worker-held-cleanup', args: ['a', ':', 'a'], cap: 1, mode: 'held-close', status: 3, stderr: emergency, stdoutAttempts: 0, stderrAttempts: 1, jobs: 1 },
  { id: 'v2-sink-undefined-precedes-close-error', args: ['a', ':', 'a'], cap: 2, mode: 'reject-stdout', reason: 'undefined', closeReject: true, rejection: 'sink', stdoutAttempts: 1, stderrAttempts: 0, jobs: 1 },
  { id: 'v2-caller-false-precedes-close-error', args: ['a', ':', '['], cap: 1, mode: 'abort-post', reason: 'false', closeReject: true, rejection: 'caller', stdoutAttempts: 0, stderrAttempts: 0, jobs: 1 },
  { id: 'v2-worker-diagnostic-close-error-preserved', args: ['a', ':', '['], cap: 1, closeReject: true, rejection: 'close', stderr: emergency, stdoutAttempts: 0, stderrAttempts: 1, jobs: 1 },
];
