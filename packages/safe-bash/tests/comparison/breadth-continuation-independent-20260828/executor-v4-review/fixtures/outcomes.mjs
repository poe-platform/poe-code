export function execute(mode) {
  if (mode === 'noop') return { exitCode: 0, stdoutBase64: '', stderrBase64: '', files: {} };
  if (mode === 'status23') return { exitCode: 23, stdoutBase64: 'c3RhdHVzLWNvbnRyb2wK', stderrBase64: '', files: {} };
  if (mode === 'partial-effect') return { exitCode: 0, stdoutBase64: '', stderrBase64: '', files: { 'part-aa': { base64: 'YWxwaGEKYmV0YQo=' } } };
  if (mode === 'complete-effects') return {
    exitCode: 0, stdoutBase64: 'YWxwaGEKYmV0YQpnYW1tYQo=', stderrBase64: '',
    files: {
      'part-aa': { base64: 'YWxwaGEKYmV0YQo=' },
      'part-ab': { base64: 'Z2FtbWEK' },
      joined: { base64: 'YWxwaGEKYmV0YQpnYW1tYQo=' }
    }
  };
  throw new Error('Unknown independent fixture mode');
}
