import fs from 'node:fs';
import { requireThat } from './safety.mjs';

const open = fs.openSync.bind(fs);
const close = fs.closeSync.bind(fs);
const read = fs.readSync.bind(fs);
const stat = fs.fstatSync.bind(fs);
const noFollow = fs.constants.O_NOFOLLOW;
export function readRegular(filename, maximum = 64 * 1024 * 1024) {
  const descriptor = open(filename, fs.constants.O_RDONLY | noFollow);
  try {
    const info = stat(descriptor);
    requireThat(info.isFile() && Number.isSafeInteger(info.size) && info.size >= 0 && info.size <= maximum, 'REGULAR_READ_BOUND', filename);
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const amount = read(descriptor, bytes, offset, bytes.length - offset, offset);
      requireThat(amount > 0, 'REGULAR_SHORT_READ', filename);
      offset += amount;
    }
    requireThat(stat(descriptor).size === info.size, 'REGULAR_SIZE_CHANGED', filename);
    return bytes;
  } finally { close(descriptor); }
}
