import assert from 'node:assert/strict';

const mode = process.argv[2];
assert(['silent', 'startup-only', 'prefix-stall', 'complete', 'sentinel'].includes(mode));
const held = setInterval(() => {}, 1000);
process.stderr.write('CONTROL_STARTED\n');
if (mode === 'silent' || mode === 'startup-only' || mode === 'sentinel') {
  process.stdin.pause();
} else {
  const input = [];
  let received = 0;
  let prefixWritten = false;
  process.stdin.on('data', bytes => {
    received += bytes.length;
    assert(received <= 9, 'controlled child accepts at most nine bytes');
    input.push(Buffer.from(bytes));
    if (!prefixWritten && received >= 4) {
      assert.equal(Buffer.concat(input).subarray(0, 4).toString('hex'), '666f6f0a');
      prefixWritten = true;
      process.stdout.write('foo\n');
    }
  });
  process.stdin.on('end', () => {
    if (mode === 'complete') {
      assert.equal(Buffer.concat(input).toString('hex'), '666f6f0a000a6e6f0a');
      process.stdout.write('binary file matches (found "\\0" byte around offset 4)\n');
      clearInterval(held);
    }
  });
}
