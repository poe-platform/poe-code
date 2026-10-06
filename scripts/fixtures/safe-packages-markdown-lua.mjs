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

/** Both operand modes must enter the public streamed Lua path. This is a
 * dispatch/cleanup check; its input size does not establish external scaling. */
export async function verifyMarkdownOperands({createStorage, bucket, fileScope}) {
  const namespace = createMemoryFileSystem();
  await namespace.mkdir('/spill');
  const remote = createStorage(namespace, bucket);
  const lua = createLuaFilterCapability({readStream: () => [new TextEncoder().encode('function Str(el) return pandoc.Str(string.upper(el.text)) end')]});
  let streamed = 0, bytes = 0;
  await convertToOutput([97, 98].map(letter => ({chunks: (async function* () {
    for (let index = 0; index < 8; index++) yield new Uint8Array(1024).fill(letter);
  })()})), {from: 'markdown', to: 'plain', fileScope, filters: [{kind: 'lua', path: '/filter.lua'}]}, {
    filters: {
      ...lua,
      async apply() { throw new Error('Multiple Markdown operands used resident Lua'); },
      async applyJsonStream(...args) { streamed++; return lua.applyJsonStream(...args); },
    },
    workingFiles: {fs: remote.fs, directory: '/spill', cacheBytes: 131072},
    output: {
      async write(chunk) {
        if (chunk.length > 16384) throw new Error('Markdown operand output window exceeded');
        for (const byte of chunk) {
          const expected = bytes < 8192 ? 65 : bytes < 8194 || bytes === 16386 ? 10 : 66;
          if (byte !== expected) throw new Error(`Markdown operand output differs at ${bytes}: ${byte}`);
          bytes++;
        }
      },
      async close() {}, async abort() {},
    },
  });
  const {opened, closed, reads, writes, largestTransfer} = remote.events;
  if (streamed !== 1 || bytes !== 16387 || !opened || !reads || !writes)
    throw new Error('Markdown operand dispatch or external backing differs');
  if (largestTransfer > 16384 || opened !== closed || (await bucket.list({limit: 1})).objects.length || (await namespace.readdir('/spill')).length)
    throw new Error('Markdown operand storage bounds or cleanup differ');
  return {markdownOperands: true, fileScope};
}

/** Frontmatter larger than the cache uses caller-backed YAML and real Lua. */
export async function verifyMarkdownYaml({createStorage, bucket}) {
  const namespace = createMemoryFileSystem();
  await namespace.mkdir('/spill');
  const remote = createStorage(namespace, bucket);
  const encoder = new TextEncoder();
  const lua = createLuaFilterCapability({readStream: () => [encoder.encode(`
function Meta(meta)
  assert(#meta.payload == 262144)
  assert(string.sub(meta.payload, 1, 1) == "a")
  assert(string.sub(meta.payload, -1) == "a")
  assert(meta.nested.list[1] == true)
  assert(meta.nested.list[2] == "12")
  return meta
end
function Str(el) return pandoc.Str(string.upper(el.text)) end`)]});
  let streamed = 0, bytes = 0;
  await convertToOutput([{chunks: (async function* () {
    yield encoder.encode('---\npayload: ');
    for (let index = 0; index < 256; index++) yield new Uint8Array(1024).fill(97);
    yield encoder.encode('\nnested: {list: [true, 12]}\n---\nbody\n');
  })()}], {from: 'markdown', to: 'plain', filters: [{kind: 'lua', path: '/filter.lua'}]}, {
    filters: {
      ...lua,
      async apply() { throw new Error('YAML used resident Lua'); },
      async applyJsonStream(...args) { streamed++; return lua.applyJsonStream(...args); },
    },
    workingFiles: {fs: remote.fs, directory: '/spill', cacheBytes: 131072},
    output: {
      async write(chunk) {
        if (chunk.length > 16384) throw new Error('YAML output window exceeded');
        for (const byte of chunk) if (byte !== [66, 79, 68, 89, 10][bytes++]) throw new Error('YAML body differs');
      },
      async close() {}, async abort() {},
    },
  });
  const {opened, closed, reads, writes, largestTransfer} = remote.events;
  if (streamed !== 1 || bytes !== 5 || !opened || !reads || !writes) throw new Error('YAML stream or storage differs');
  if (largestTransfer > 16384 || opened !== closed || (await bucket.list({limit: 1})).objects.length || (await namespace.readdir('/spill')).length)
    throw new Error('YAML storage bounds or cleanup differ');
  return {markdownYaml: true};
}
