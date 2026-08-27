import assert from 'node:assert/strict';

export function evaluate(entry, report) {
  const expected = entry.expected;
  assert.equal(report.id, entry.id);
  assert.equal(report.actualShell, true);
  assert.equal(report.shellDisposed, true);
  assert.equal(report.commandInvocations, 1);
  assert.equal(report.mutations, 0);
  assert.equal(report.unhandled.length, 0);
  assert.equal(Buffer.from(report.stdoutBase64, 'base64').length, report.stdoutBytes);
  assert.equal(Buffer.from(report.stderrBase64, 'base64').length, report.stderrBytes);
  assert.equal(Buffer.from(report.stdoutBase64, 'base64').toString('utf8'), report.stdout);
  assert.equal(Buffer.from(report.stderrBase64, 'base64').toString('utf8'), report.stderr);
  assert.equal(report.stdoutBytes + report.stderrBytes, Buffer.byteLength(report.stdout) + Buffer.byteLength(report.stderr));
  assert(report.stdoutBytes + report.stderrBytes <= entry.limits.maxOutputBytes);
  for (const call of report.calls) {
    assert.equal(call.signalPresent, true, call.method);
    assert.equal(call.signalAbortedAtEntry, false, call.method);
    assert(!['readFile', 'writeFile', 'appendFile'].includes(call.method));
    assert(entry.entries.some(item => item.path === call.path), 'Only presealed fixture paths');
  }
  if (entry.family === 'tree') assert.equal(report.streams.length, 0);
  if (entry.family === 'file' && expected.mode !== 'file-text-admission-limit') {
    assert.equal(report.calls.filter(call => call.method === 'readStream').length, report.streams.length);
    assert.equal(report.calls.filter(call => call.method === 'lstat').length, report.streams.length);
    assert.deepEqual(report.streams.map(stream => stream.path), entry.args.slice(2, 2 + report.streams.length));
  }
  for (const stream of report.streams) {
    assert.equal(stream.start, 0);
    assert.equal(stream.endExclusive, entry.limits.maxSniffBytes);
    assert(Number.isSafeInteger(stream.chunkSize) && stream.chunkSize > 0 && stream.chunkSize <= entry.limits.maxChunkBytes);
    assert(stream.bytes <= 8190);
    assert(stream.returned <= 1);
  }
  if (expected.mode === 'exact-success-with-static-proof') {
    assert.equal(report.rejected, false);
    assert.equal(report.exitCode, expected.exitCode);
    assert.equal(report.stdout, expected.stdout);
    assert.equal(report.stderr, expected.stderr);
    assert.equal(report.calls.filter(call => call.method === 'lstat').length, 65);
    assert.equal(report.calls.filter(call => call.method === 'readdir').length, 1);
  } else if (expected.mode === 'tree-work-rejection') {
    assert.equal(report.rejected, true);
    assert.equal(report.error.code, expected.code);
    assert.equal(report.error.truncated, false);
    assert(report.error.message.includes('tree') && report.error.message.includes('work') && report.error.message.includes('limit'));
    assert.equal(report.stdout, expected.stdout);
    assert.equal(report.stderr, expected.stderr);
    assert.equal(report.calls.filter(call => call.method === 'lstat').length, 1);
    assert.equal(report.calls.filter(call => call.method === 'readdir').length, 1);
  } else if (expected.mode === 'file-json-work-limit') {
    assert.equal(report.rejected, false);
    assert.equal(report.exitCode, expected.exitCode);
    assert(report.stderr.startsWith('file: ') && report.stderr.includes('step') && report.stderr.includes('limit'));
    assert.equal(report.stdout, expected.line);
    assert(report.streams.length >= expected.minimumOpenedFiles && report.streams.length <= expected.maximumOpenedFiles);
    assert(new Set(report.streams.map(stream => stream.path)).size === report.streams.length);
    assert(report.streams.reduce((total, stream) => total + stream.bytes, 0) > 8190);
  } else if (expected.mode === 'bounded-header-characterization') {
    assert.equal(report.rejected, false);
    assert.equal(report.exitCode, 0);
    assert.equal(report.stderr, '');
    assert(report.stdout.endsWith('\n'));
    const lines = report.stdout.slice(0, -1).split('\n');
    assert.equal(lines.length, expected.lines);
    for (const line of lines) {
      const parts = line.split('; charset=');
      assert.equal(parts.length, 2);
      assert(parts[0].includes('/') && !parts[0].includes(' ') && parts[0].length <= 128);
      assert(['binary', 'us-ascii', 'utf-8', 'utf-16le', 'utf-16be'].includes(parts[1]));
    }
    assert.equal(report.streams.length, 32);
    assert.equal(new Set(report.streams.map(stream => stream.path)).size, 32);
    assert.equal(report.streams.reduce((total, stream) => total + stream.bytes, 0), expected.bytesRead);
    for (const stream of report.streams) {
      assert.equal(stream.bytes, 512);
      assert.equal(stream.next, 5);
      assert.equal(stream.returned, 0);
    }
  } else if (expected.mode === 'file-text-admission-limit') {
    assert.equal(report.rejected, false);
    assert.equal(report.exitCode, expected.exitCode);
    assert.equal(report.streams.length, 0);
    const links = report.calls.filter(call => call.method === 'readlink');
    assert.equal(links.length, expected.maximumReadlinks);
    assert.equal(links[0].path, '/link-0000');
    assert(expected.firstLine.startsWith(report.stdout));
    assert(report.stdout.length < expected.firstLine.length);
    assert(report.stderr.startsWith('file: ') && report.stderr.includes('limit'));
    assert(['output', 'metadata', 'text', 'step'].some(word => report.stderr.includes(word)));
  } else throw new Error(`Unknown sealed expectation ${expected.mode}`);
  return { status: 'pass', id: entry.id, qualification: expected.qualification };
}
