import { expect, it, vi } from 'vitest';
import { discoverImageMagick } from './imagemagick.js';
const b = (s: string) => new TextEncoder().encode(s);

it.each(['list', 'script'])('discovers %s from borrowed chunks without buffered reads', async kind => {
  const content = kind === 'list' ? "'one file.png' two.png\0ignored.png" : '# comment\r\n"one file.png" -write two.png\n';
  const read = vi.fn(() => { throw Error('whole-file read'); });
  const context = {
    read,
    accessible: async () => false,
    isDirectory: async () => false,
    async *readStream() {
      const chunk = new Uint8Array(1);
      for (const byte of b(content)) { chunk[0] = byte; yield chunk; }
    },
  };
  const streamed = await discoverImageMagick('magick', (kind === 'list' ? ['@input', 'out.png'] : ['-script', 'input']).map(b), context);
  const buffered = await discoverImageMagick('magick', (kind === 'list' ? ['@input', 'out.png'] : ['-script', 'input']).map(b), { ...context, readStream: undefined, read: async () => b(content) });
  expect(streamed).toEqual(buffered);
  expect(read).not.toHaveBeenCalled();
});

it.each(['list', 'script'])('bounds %s prediction metadata without rejecting native execution', async kind => {
  let pulls = 0, closed = false;
  const context = {
    accessible: async () => false,
    async *readStream() {
      try {
        const chunk = b('x'.repeat(65536));
        for (let index = 0; index < 4; index++) { pulls++; yield chunk; }
      } finally { closed = true; }
    },
  };
  const result = await discoverImageMagick('magick', (kind === 'list' ? ['@input', 'out.png'] : ['-script', 'input']).map(b), context);
  expect(pulls).toBeLessThanOrEqual(2);
  expect(closed).toBe(true);
  expect(result.deferred.some(entry => entry.reason.includes('prediction budget'))).toBe(true);
  expect(result.resources.some(entry => entry.role === kind && new TextDecoder().decode(entry.path) === 'input')).toBe(true);
});

it('bounds empty-token metadata as well as token bytes', async () => {
  const result = await discoverImageMagick('magick', ['@input', 'out.png'].map(b), {
    accessible: async () => false,
    isDirectory: async () => false,
    async *readStream() { yield b("'' ".repeat(5000)); },
  });
  expect(result.resources.length).toBeLessThanOrEqual(4098);
  expect(result.deferred.some(entry => entry.reason.includes('prediction budget'))).toBe(true);
});
