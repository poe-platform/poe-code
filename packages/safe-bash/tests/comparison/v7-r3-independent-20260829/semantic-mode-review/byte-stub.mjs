import fs from 'node:fs';
const bytes = Buffer.alloc(65537, 81);
let offset = 0;
while (offset < bytes.length) {
  const count = fs.writeSync(1, bytes, offset, bytes.length - offset);
  if (count <= 0) throw Error('ZERO_WRITE');
  offset += count;
}
