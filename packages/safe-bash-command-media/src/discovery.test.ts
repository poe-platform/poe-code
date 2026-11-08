import { expect, it, vi } from 'vitest';
import { createMemoryFileSystem } from '@poe-code/safe-fs';
import { toByteSource, type CommandContext } from 'safe-bash-contracts';
import { createMediaCommand } from './plugin.js';

const bytes = (value: string) => new TextEncoder().encode(value);

it.each(['list', 'script'])('streams large %s discovery on the exact caller filesystem', async kind => {
  const fs = createMemoryFileSystem();
  const signal = new AbortController().signal;
  const readFile = vi.spyOn(fs, 'readFile').mockRejectedValue(Error('payload-wide read'));
  const writeFile = vi.spyOn(fs, 'writeFile').mockRejectedValue(Error('private spool'));
  let outstanding = 0, maximum = 0, closed = 0;
  const stream = vi.spyOn(fs, 'readStream').mockImplementation(async function* (path, options) {
    expect(path).toBe('/work/input');
    expect(options?.signal).toBe(signal);
    expect(options?.chunkSize).toBe(65536);
    const chunk = new Uint8Array(65536).fill(32);
    if (kind === 'script') { chunk[0] = 35; chunk[chunk.length - 1] = 10; }
    try {
      // Eight MiB of generated input, one reusable chunk, no in-memory file.
      for (let index = 0; index < 128; index++) {
        outstanding += chunk.length; maximum = Math.max(maximum, outstanding);
        yield chunk;
        outstanding -= chunk.length;
      }
      yield bytes(kind === 'script' ? 'large.png -write out.png' : 'large.png');
    } finally { closed++; }
  });
  const execute = vi.fn(async (request) => {
    // A slow remote consumer still receives the original authority/descriptors.
    await new Promise(resolve => setTimeout(resolve, 1));
    expect(request.fs).toBe(fs);
    expect(request.signal).toBe(signal);
    expect(request.stdin).toBe(context.stdin);
    expect(request.stdout).toBe(context.stdout);
    expect(request.discovery.resources.some((resource: { path?: Uint8Array }) =>
      resource.path && new TextDecoder().decode(resource.path) === 'large.png')).toBe(true);
    return { exitCode: 0 };
  });
  const context: CommandContext = {
    command: 'magick', args: kind === 'script' ? ['-script', 'input'] : ['@input', 'out.png'],
    cwd: '/work', env: {}, fs, signal, stdin: toByteSource(''),
    stdout: { async write() {} }, stderr: { async write() {} },
  };
  expect(await createMediaCommand({ engine: { execute } }, 'magick').execute(context)).toEqual({ exitCode: 0 });
  expect(execute).toHaveBeenCalledOnce();
  expect(stream).toHaveBeenCalledOnce();
  expect(maximum).toBe(65536);
  expect(outstanding).toBe(0);
  expect(closed).toBe(1);
  expect(readFile).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
});

it.each(['abort', 'error', 'nul'])('closes discovery streams on %s and preserves remote authority', async failure => {
  const fs = createMemoryFileSystem();
  const controller = new AbortController();
  let closed = 0;
  vi.spyOn(fs, 'readFile').mockRejectedValue(Error('buffered fallback'));
  vi.spyOn(fs, 'readStream').mockImplementation(async function* () {
    try {
      yield bytes(failure === 'nul' ? 'image.png\0' : 'image.png ');
      if (failure === 'abort') controller.abort(Error('cancelled'));
      throw Error('read failure');
    } finally { closed++; }
  });
  const execute = vi.fn(async request => {
    expect(request.fs).toBe(fs);
    expect(request.signal).toBe(controller.signal);
    expect(closed).toBe(1);
    return { exitCode: controller.signal.aborted ? 130 : 0 };
  });
  const context: CommandContext = { command: 'magick', args: ['@input', 'out.png'], cwd: '/', env: {}, fs,
    signal: controller.signal, stdin: toByteSource(''), stdout: { async write() {} }, stderr: { async write() {} } };
  await createMediaCommand({ engine: { execute } }, 'magick').execute(context);
  expect(execute).toHaveBeenCalledOnce();
  expect(fs.readFile).not.toHaveBeenCalled();
});

it('does not read a large media payload during discovery', async () => {
  const fs = createMemoryFileSystem();
  const stat = await fs.stat('/');
  vi.spyOn(fs, 'stat').mockResolvedValue({ ...stat, type: 'file', size: 2 ** 40 });
  vi.spyOn(fs, 'access').mockResolvedValue(undefined);
  const read = vi.spyOn(fs, 'readFile');
  const stream = vi.spyOn(fs, 'readStream');
  const context: CommandContext = { command: 'magick', args: ['large.png', 'out.png'], cwd: '/', env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(''), stdout: { async write() {} }, stderr: { async write() {} } };
  await createMediaCommand({ engine: { async execute(request) {
    expect(request.fs).toBe(fs);
    expect(request.args).toEqual(context.args.map(bytes));
    return { exitCode: 0 };
  } } }, 'magick').execute(context);
  expect(read).not.toHaveBeenCalled();
  expect(stream).not.toHaveBeenCalled();
});
