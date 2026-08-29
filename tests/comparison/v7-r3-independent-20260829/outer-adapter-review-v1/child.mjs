import { writeSync } from 'node:fs';
import assert from 'node:assert/strict';

const mode = process.argv[2];
assert.ok(['all-caps', 'stderr-over', 'normal'].includes(mode));
const write = (descriptor, bytes) => {
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
};
if (mode === 'all-caps') {
  for (const [descriptor, count, value] of [[1, 65536, 65], [2, 65536, 66], [3, 262144, 67]]) write(descriptor, Buffer.alloc(count, value));
} else if (mode === 'stderr-over') write(2, Buffer.alloc(65537, 68));
else {
  write(1, Buffer.from('outer-ok\n'));
  write(2, Buffer.from('outer-diagnostic\n'));
  write(3, Buffer.from('{"stub":true}\n'));
}
