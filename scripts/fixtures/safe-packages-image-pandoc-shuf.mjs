import { Shell } from '@poe-platform/safe-bash/core';
import { sipsCommands, createIdentifyCommand } from '@poe-platform/safe-bash/commands/sips';
import { pandocCommands } from '@poe-platform/safe-bash/commands/pandoc';
import { shufCommands } from '@poe-platform/safe-bash/commands/shuf';
import sharp from '@poe-platform/safe-bash/sharp';
import { createMemoryFileSystem } from '@poe-platform/safe-fs/core';

export async function verifyImagePandocShuf() {
  const fs = createMemoryFileSystem();
  const encoder = new TextEncoder();
  await fs.mkdir('/spill');
  await fs.writeFile('/image.png', await sharp({ create: { width: 13, height: 7, channels: 4, background: 'blue' } }).png().toBuffer());
  await fs.writeFile('/input.md', encoder.encode('alpha\n\nbeta\n'));
  await fs.writeFile('/filter.lua', encoder.encode('function Str(el) return pandoc.Str(string.upper(el.text)) end'));
  await fs.writeFile('/entropy', new Uint8Array(128));
  const calls = new Set();
  const filesystem = new Proxy(fs, { get(target, key) {
    if (key === 'readFile' || key === 'writeFile') return () => { throw new Error('Whole-file I/O forbidden'); };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? (...args) => { calls.add(key); return value.apply(target, args); } : value;
  } });
  const shell = new Shell({ fs: filesystem, env: { TMPDIR: '/spill' } })
    .use(sipsCommands()).use(pandocCommands()).use(shufCommands());
  shell.commands.register(createIdentifyCommand());
  try {
    for (const [source, expected] of [
      ['sips -r 90 -s format jpeg /image.png --out /image.jpg && identify -format "%m %wx%h" /image.jpg', 'JPEG 7x13'],
      ['pandoc -f markdown -t plain -L /filter.lua /input.md', 'ALPHA\n\nBETA\n'],
      ['shuf --random-source=/entropy -i7-10 -n3', '7\n8\n9\n'],
    ]) {
      const result = await shell.exec(source);
      if (result.exitCode !== 0 || !result.stdout.endsWith(expected)) throw new Error(source + ': ' + JSON.stringify(result));
    }
    const random = await shell.exec('shuf -i1-100 -n3');
    const selected = random.stdout.trim().split('\n').map(Number);
    if (random.exitCode !== 0 || selected.length !== 3 || new Set(selected).size !== 3 || selected.some(value => value < 1 || value > 100)) throw new Error('Default entropy: ' + JSON.stringify(random));
    const piped = await shell.exec('pandoc -f markdown -t plain -L /filter.lua /input.md | shuf --random-source=/entropy');
    if (piped.exitCode !== 0 || JSON.stringify(piped.stdout.split('\n').filter(Boolean).sort()) !== JSON.stringify(['ALPHA', 'BETA'])) throw new Error('Composed pipeline: ' + JSON.stringify(piped));
    const image = await sharp('/image.jpg', { filesystem }).resize(5, 9).png().toFile('/resized.png');
    if (image.width !== 5 || image.height !== 9) throw new Error('Injected image SDK');
    let rejected = false;
    try { await sharp('/image.jpg').metadata(); } catch { rejected = true; }
    if (!rejected) throw new Error('Ambient path accepted');
    if (!calls.has('readStream') || !calls.has('openReadFile')) throw new Error('Missing injected streaming/range I/O');
    if ((await fs.readdir('/spill')).length !== 0) throw new Error('Working files leaked');
    return { image: true, lua: true, entropy: true };
  } finally { await shell.dispose(); }
}
