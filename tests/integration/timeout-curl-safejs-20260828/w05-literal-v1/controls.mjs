import assert from 'node:assert/strict';
import { exact, deniedClosed } from '../predicates.mjs';

export function predicateControls() {
  const expected = { exitCode: 7, stdout: '', stderr: 'curl: (7) Network access denied by host policy\n' };
  const result = { ...expected, stdoutBytes: Buffer.from(''), stderrBytes: Buffer.from(expected.stderr) };
  const traffic = {
    authorization: [{ url: 'https://workflow.invalid/data', attempt: 0 }, { url: 'https://denied.invalid/next', attempt: 0, redirectFrom: 'https://workflow.invalid/data' }],
    requests: [{ url: 'https://workflow.invalid/data' }], dispose: 1, disposeDone: 1,
  };
  exact(result, expected); deniedClosed(traffic);
  const rows = [];
  for (const [id, action, designated] of [
    ['wrong-status', () => exact({ ...result, exitCode: 8 }, expected), 'EXIT_CODE'],
    ['wrong-diagnostic-code', () => exact({ ...result, stderr: 'curl: (8) Network access denied by host policy\n', stderrBytes: Buffer.from('curl: (8) Network access denied by host policy\n') }, expected), 'STDERR'],
    ['missing-prefix', () => exact({ ...result, stderr: 'curl: Network access denied by host policy\n', stderrBytes: Buffer.from('curl: Network access denied by host policy\n') }, expected), 'STDERR'],
    ['extra-request', () => deniedClosed({ ...traffic, requests: [...traffic.requests, { url: 'https://denied.invalid/next' }] }), 'NO_DENIED_TRANSPORT'],
  ]) {
    let caught; try { action(); } catch (error) { caught = error; }
    assert.equal(caught?.code, 'ERR_ASSERTION', 'CONTROL_REJECTION_TYPE');
    assert.ok(caught.message === designated || caught.message.startsWith(designated + '\n'), 'DESIGNATED_COUNTERCONTROL');
    rows.push({ id, designated, qualified: true, error: { code: caught.code, message: caught.message } });
  }
  return rows;
}
