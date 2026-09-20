import { expect, it } from 'vitest';
import { createDeviceFileSystem } from '../src/fs/devices/index.js';
import { MemoryFileSystem } from '../src/fs/memory/index.js';

it('closing a canceled unstarted DeviceFS reader never admits backing VFS work', async () => {
  for (const reason of [false, 0, '', null, undefined, NaN]) {
    const backing = new MemoryFileSystem();
    const controller = new AbortController();
    let queries = 0;
    let opens = 0;
    backing.capabilitiesFor = async () => { queries++; return backing.capabilities; };
    backing.readStream = () => { opens++; throw new Error('cleanup opened a reader'); };
    const iterator = createDeviceFileSystem(backing).readStream('/input', { signal: controller.signal })[Symbol.asyncIterator]();
    controller.abort(reason);
    const closing = iterator.return!();
    expect(iterator.return!()).toBe(closing);
    await expect(closing).resolves.toEqual({ done: true, value: undefined });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(queries).toBe(0);
    expect(opens).toBe(0);
  }
});
