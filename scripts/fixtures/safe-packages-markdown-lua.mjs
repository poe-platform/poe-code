import { convertToOutput, createLuaFilterCapability } from '@poe-platform/safe-bash/commands/pandoc';
import { createMemoryFileSystem } from '@poe-platform/safe-fs/core';

/** A separate request keeps the Markdown qualification's deadline independent
 * of the image, RTF and Shuf workloads. Source and output use fixed windows. */
export async function verifyMarkdownLua({createStorage, bucket}) {
  const namespace = createMemoryFileSystem();
  await namespace.mkdir('/spill');
  const remote = createStorage(namespace, bucket);
  const lua = createLuaFilterCapability({readStream: () => [new TextEncoder().encode('function Str(el) return pandoc.Str(string.upper(el.text)) end')]});
  let streamed = 0, bytes = 0;
  const filters = {
    ...lua,
    async apply() { throw new Error('Markdown used the resident filter path'); },
    async applyJsonStream(...args) {
      if (!remote.events.opened || !remote.events.reads || !remote.events.writes)
        throw new Error('Markdown reader did not spill before Lua');
      streamed++; return lua.applyJsonStream(...args);
    },
  };
  await convertToOutput([{chunks: (async function* () {
    for (let index = 0; index < 64; index++) yield new Uint8Array(1024).fill(97);
  })()}], {from: 'markdown', to: 'plain', filters: [{kind: 'lua', path: '/filter.lua'}]}, {
    filters, workingFiles: {fs: remote.fs, directory: '/spill', cacheBytes: 131072},
    output: {
      async write(chunk) {
        if (chunk.length > 16384) throw new Error('Markdown output window exceeded');
        for (const byte of chunk) {
          if (byte !== (bytes === 65536 ? 10 : 65)) throw new Error('Markdown output bytes differ');
          bytes++;
        }
      },
      async close() {}, async abort() {},
    },
  });
  if (streamed !== 1 || bytes !== 65537) throw new Error('Markdown stream dispatch or output length differs');
  const {opened, closed, reads, writes, largestTransfer} = remote.events;
  if (!opened || !reads || !writes) throw new Error('Markdown did not round trip through external backing');
  if (opened !== closed || (await bucket.list({limit: 1})).objects.length || (await namespace.readdir('/spill')).length)
    throw new Error('Markdown scratch leaked');
  if (largestTransfer > 16384) throw new Error('Markdown backing window exceeded');
  return {markdownLua: true};
}
