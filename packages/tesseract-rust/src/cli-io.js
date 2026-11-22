import { open } from 'node:fs/promises';
import { addAbortSignal } from 'node:stream';

export async function read(path, maxBytes, signal) {
  signal?.throwIfAborted();
  const chunks = [];
  let size = 0;
  const file = path === 'stdin' || path === '-' ? undefined : await open(path, 'r');
  try {
    const input = file ? file.createReadStream({ autoClose: false, signal }) : addAbortSignal(signal, process.stdin);
    for await (const chunk of input) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('OCR input byte limit exceeded');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally { await file?.close(); }
}
