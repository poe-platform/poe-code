import { htmlqCommands, htmlqBytes } from '@poe-platform/safe-bash/commands/htmlq';

// Keep this branch exported and uncalled: eagerly loading core hides the defect.
export const lazy = () => import('@poe-platform/safe-bash/core');

const limits = { inputBytes: 100, decodedBytes: 200, retainedBytes: 100000, outputBytes: 100 };
if (htmlqCommands({ limits }).name !== 'htmlq') throw new Error('htmlq initialization failed');

async function query(input) {
  const source = (async function* () { yield new TextEncoder().encode(input); })();
  let output = '';
  for await (const bytes of htmlqBytes(source, ['p', '-t'], { signal: new AbortController().signal, limits })) {
    output += new TextDecoder().decode(bytes);
  }
  return output;
}

if (await query('<p>bounded</p>') !== 'bounded\n') throw new Error('bounded htmlq query failed');
let rejected = false;
try {
  await query('<p>' + 'x'.repeat(101) + '</p>');
} catch (error) {
  if (error.code !== 'E_LIMIT') throw error;
  rejected = true;
}
if (!rejected) throw new Error('htmlq input limit was lost');
console.log('Mixed static htmlq and lazy core: initialization, bounded query and limit rejection passed');
