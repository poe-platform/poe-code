import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8Codec, pythonCodecs } from 'safe-bash-command-csvkit';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { csvkitCommands } from '../../src/commands/csvkit/index.js';

function dbf(type: string, value: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(67 + value.length); const view = new DataView(bytes.buffer);
  bytes[0] = 131; view.setUint32(4, 1, true); view.setUint16(8, 65, true); view.setUint16(10, value.length + 1, true);
  bytes[32] = 118; bytes[43] = type.charCodeAt(0); bytes[48] = value.length; bytes[64] = 13; bytes[65] = 32;
  bytes.set(value, 66); bytes[bytes.length - 1] = 26; return bytes;
}
const options = {
  codecs: [utf8Codec, ...pythonCodecs], locale: { profile: 'C', timezone: 'UTC', formatNumber: (value: string) => value },
  clock: { now: () => 0 }, terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const cases = [
  { name: 'memo nonbreaking-space byte is not integer whitespace', type: 'M', value: [160,49,32,32,32,32,32,32,32], stdout: '', stderr: "ValueError: Memo index is not an integer: b'\\xa01       '\n", status: 1 },
  { name: 'memo next-line byte is not integer whitespace', type: 'M', value: [133,49,32,32,32,32,32,32,32], stdout: '', stderr: "ValueError: Memo index is not an integer: b'\\x851       '\n", status: 1 },
  { name: 'date nonbreaking-space byte is not integer whitespace', type: 'D', value: [160,50,48,48,49,48,49], stdout: '', stderr: "ValueError: invalid date b'\\xa0200101'\n", status: 1 },
  { name: 'numeric byte file separator is not integer whitespace', type: 'N', value: [28,49], stdout: '', stderr: "ValueError: could not convert string to float: b'\\x1c1'\n", status: 1 },
  { name: 'float byte file separator is not float whitespace', type: 'F', value: [28,49], stdout: '', stderr: "ValueError: could not convert string to float: b'\\x1c1'\n", status: 1 },
  { name: 'memo byte file separator is not integer whitespace', type: 'M', value: [28,49,32,32,32,32,32,32,32], stdout: '', stderr: "ValueError: Memo index is not an integer: b'\\x1c1       '\n", status: 1 },
  { name: 'numeric star padding retains Python integer inference', type: 'N', value: [42,32,49,32,42], stdout: 'v\nTrue\n', stderr: '', status: 0 },
  { name: 'float star padding retains Python float inference', type: 'F', value: [42,32,49,32,42], stdout: 'v\n1.0\n', stderr: '', status: 0 },
  { name: 'numeric underscores accepted by Python bytes integer', type: 'N', value: [49,95,48], stdout: 'v\n10\n', stderr: '', status: 0 },
  { name: 'negative memo index emits null', type: 'M', value: [45,49,32,32,32,32,32,32,32,32], stdout: 'v\n""\n', stderr: '', status: 0 }
];
for (const item of cases) {
  test(`in2csv DBF user scalar reference: ${item.name}`, async () => {
    const fs = new MemoryFileSystem(); const input = dbf(item.type, Uint8Array.from(item.value));
    const memo = new Uint8Array(518); memo.set(new TextEncoder().encode('hello\x1a'), 512);
    await fs.writeFile('/input.dbf', input); await fs.writeFile('/input.dbt', memo);
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    try {
      const result = await shell.exec('in2csv -f dbf /input.dbf');
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
      assert.deepEqual(await fs.readFile('/input.dbf'), input); assert.deepEqual(await fs.readFile('/input.dbt'), memo);
      assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['input.dbf', 'input.dbt']);
    } finally { await shell.dispose(); }
  });
}
