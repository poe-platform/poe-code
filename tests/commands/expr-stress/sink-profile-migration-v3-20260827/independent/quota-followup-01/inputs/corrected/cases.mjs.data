const emergency = 'expr: output bytes limit exceeded\n';
const syntax = "expr: syntax error: unexpected argument 'x'\n";
export const cases = [];
function add(id, argv, cap, expected, extra = {}) {
  cases.push({ id, argv, cap, expected: { status: 3, stdout: '', stderr: emergency, jobs: 0, ...expected }, ...extra });
}
for (const cap of [1, 2, 16, 33, 34, 35, 43, 44, 45]) {
  add(`syntax-cap-${cap}`, ['1', 'x'], cap, cap >= 44 ? { status: 2, stderr: syntax } : {});
}
for (const token of ['ATTACKER_MARKER', "'\\\n\t", '💣', 'x'.repeat(256)]) {
  add(`constant-token-${cases.length}`, ['1', token], 1, {}, { commandName: 'ATTACKER_COMMAND' });
}
add('stdout-cap-one', ['1'], 1, {});
add('stdout-exact-two', ['1'], 2, { status: 0, stdout: '1\n', stderr: '' });
add('stdout-false-exact-two', ['0'], 2, { status: 1, stdout: '0\n', stderr: '' });
for (const option of ['--version', '--help']) add(`${option}-cap-one`, [option], 1, {});
const version = 'expr (virtual-bash)\n';
add('version-exact', ['--version'], Buffer.byteLength(version), { status: 0, stdout: version, stderr: '' });
for (const cap of [1, 22, 23]) {
  add(`division-cap-${cap}`, ['1', '/', '0'], cap, cap >= 23 ? { status: 2, stderr: 'expr: division by zero\n' } : {});
}
add('modulo-cap-one', ['1', '%', '0'], 1, {});
add('noninteger-cap-one', ['bad', '+', '1'], 1, {});
add('nul-cap-one', ['bad\0token'], 1, {});
add('unicode-cap-one', ['\ud800'], 1, {});
add('argument-budget-cap-one', ['abc'], 1, {}, { limits: { maxArgumentBytes: 1 } });
add('work-budget-cap-one', ['1'], 1, {}, { limits: { maxSteps: 1 } });
add('regex-output-cap-one', ['a', ':', 'a'], 1, { jobs: 1 });
add('regex-exact-two', ['a', ':', 'a'], 2, { status: 0, stdout: '1\n', stderr: '', jobs: 1 });
add('regex-invalid-cap-one', ['a', ':', '['], 1, { jobs: 1 });
add('emergency-awaited', ['1', 'x'], 1, {}, { mode: 'held-stderr' });
add('normal-diagnostic-awaited', ['1', 'x'], 44, { status: 2, stderr: syntax }, { mode: 'held-stderr' });
add('stdout-awaited', ['1'], 2, { status: 0, stdout: '1\n', stderr: '' }, { mode: 'held-stdout' });
add('emergency-rejection', ['1', 'x'], 1, { status: null, stderr: '', rejection: 'sink' }, { mode: 'reject-stderr' });
add('normal-diagnostic-rejection', ['1', 'x'], 44, { status: null, stderr: '', rejection: 'sink' }, { mode: 'reject-stderr' });
add('stdout-rejection-normal-quota', ['1'], 2, { status: null, stderr: '', rejection: 'sink' }, { mode: 'reject-stdout' });
add('emergency-abort-late-rejection', ['1', 'x'], 1, { status: null, stderr: '', rejection: 'abort' }, { mode: 'abort-stderr' });
add('stdout-abort-late-rejection', ['1'], 2, { status: null, stdout: '', stderr: '', rejection: 'abort' }, { mode: 'abort-stdout' });
add('preabort-no-output', ['1', 'x'], 1, { status: null, stderr: '', rejection: 'abort' }, { mode: 'preabort' });
add('overlapping-cleanup-emergency', ['1', 'x'], 1, {}, { mode: 'cleanup-stderr' });
add('overlapping-cleanup-worker-emergency', ['a', ':', 'a'], 1, { jobs: 1 }, { mode: 'cleanup-stderr' });
add('worker-emergency-rejection', ['a', ':', 'a'], 1, { status: null, stderr: '', rejection: 'sink', jobs: 1 }, { mode: 'reject-stderr' });
add('worker-post-abort', ['a', ':', 'a'], 2, { status: null, stderr: '', rejection: 'abort', jobs: 1 }, { mode: 'abort-post' });
add('shell-selected-emergency', ['1', 'x'], 1, {}, { shell: true });
add('shell-normal-boundary', ['1', 'x'], 44, { status: 2, stderr: syntax }, { shell: true });
add('shell-division-quota', ['1', '/', '0'], 1, {}, { shell: true });
export const constants = { emergency, syntax, emergencyHex: Buffer.from(emergency).toString('hex'), emergencyBytes: 34, syntaxBytes: 44 };
